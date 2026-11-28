import {
  APP_USER_SECRETS_COLLECTION, APP_USERS_COLLECTION, type AppUserDoc, appApiKey, buildAppUserDoc, errorResponse, firebaseAuth, firestore,
  kastPublicUrl, requireAdmin,
} from "@/lib/firebase-admin"

export const dynamic = "force-dynamic"

export type AppUserRow = { email: string; enabled: boolean; mountId: string; radioName: string; password: string }

/** GET /firebase-api/users — list app users from Firestore `users/{email}`. */
export async function GET(req: Request) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  try {
    const [snap, secrets] = await Promise.all([
      firestore().collection(APP_USERS_COLLECTION).get(),
      firestore().collection(APP_USER_SECRETS_COLLECTION).get(),
    ])
    const passwords = new Map(secrets.docs.map(d => [d.id, d.get("password")]))
    const rows: AppUserRow[] = snap.docs
      .map(d => {
        const data = d.data() as Record<string, unknown>
        return {
          email:     d.id,
          // A few legacy docs store enabled as the string "true"/"false".
          enabled:   data.enabled === true || data.enabled === "true",
          mountId:   typeof data.mountId === "string" ? data.mountId : "",
          radioName: typeof data.radioName === "string" ? data.radioName : "",
          // Users created before passwords were copied have no secret doc.
          password:  typeof passwords.get(d.id) === "string" ? passwords.get(d.id) as string : "",
        }
      })
      .sort((a, b) => a.email.localeCompare(b.email))
    return Response.json(rows)
  } catch (e) {
    return errorResponse(e)
  }
}

/** POST /firebase-api/users — create the Firebase Auth user and its users/{email} doc. */
export async function POST(req: Request) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  const body = (await req.json().catch(() => null)) as
    { email?: string; password?: string; enabled?: boolean; mountId?: string } | null
  const email    = body?.email?.trim().toLowerCase() ?? ""
  const password = body?.password ?? ""
  const mountId  = body?.mountId ?? ""
  if (!email || !password || typeof body?.enabled !== "boolean") {
    return Response.json({ error: "enabled, email and password are required" }, { status: 400 })
  }

  // The mount is optional: without one, radioName/mountId are left out until
  // the user is linked to a mount (mount page → App Users tab).
  let doc: AppUserDoc | Omit<AppUserDoc, "radioName" | "mountId">
  if (mountId) {
    const built = await buildAppUserDoc(req, mountId, body.enabled)
    if (built instanceof Response) return built
    doc = built
  } else {
    try {
      doc = { enabled: body.enabled, apiKey: appApiKey(), kastUrl: kastPublicUrl(req) }
    } catch (e) {
      return errorResponse(e)
    }
  }

  try {
    const ref = firestore().collection(APP_USERS_COLLECTION).doc(email)
    if ((await ref.get()).exists) return Response.json({ error: "E-mail already in use" }, { status: 409 })
    const user = await firebaseAuth().createUser({ email, password })
    try {
      await ref.create(doc) // fails instead of overwriting if the doc appeared meanwhile
    } catch (e) {
      // Don't leave an Auth user without its Firestore record.
      await firebaseAuth().deleteUser(user.uid).catch(() => {})
      throw e
    }
    // Best effort: the login already works, so a failed copy only hides it in the portal.
    await firestore().collection(APP_USER_SECRETS_COLLECTION).doc(email).set({ password })
      .catch(e => console.error("firebase-api: failed to save password copy:", e))
    return Response.json({
      email,
      enabled:   doc.enabled,
      mountId:   "mountId" in doc ? doc.mountId : "",
      radioName: "radioName" in doc ? doc.radioName : "",
      password,
    }, { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}
