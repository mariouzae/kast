import {
  APP_USER_SECRETS_COLLECTION, APP_USERS_COLLECTION, buildAppUserDoc, errorResponse, firebaseAuth, firestore, requireAdmin,
} from "@/lib/firebase-admin"

export const dynamic = "force-dynamic"

/**
 * PATCH /firebase-api/users/{email}
 *   { enabled }           — toggle only
 *   { enabled, mountId }  — link the user to a mount: writes enabled, apiKey,
 *                           radioName, kastUrl and mountId. Other fields on the
 *                           doc (streamUrl, stationId…) are left untouched.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ email: string }> }) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const email = decodeURIComponent((await ctx.params).email)
  const body = (await req.json().catch(() => null)) as { enabled?: unknown; mountId?: unknown } | null
  if (typeof body?.enabled !== "boolean") {
    return Response.json({ error: "enabled (boolean) is required" }, { status: 400 })
  }

  let update: Record<string, unknown> = { enabled: body.enabled }
  if (typeof body.mountId === "string" && body.mountId) {
    const doc = await buildAppUserDoc(req, body.mountId, body.enabled)
    if (doc instanceof Response) return doc
    update = doc
  }

  try {
    await firestore().collection(APP_USERS_COLLECTION).doc(email).update(update)
    return Response.json({
      email,
      enabled:   body.enabled,
      mountId:   (update.mountId as string | undefined) ?? undefined,
      radioName: (update.radioName as string | undefined) ?? undefined,
    })
  } catch (e) {
    return errorResponse(e)
  }
}

/**
 * DELETE /firebase-api/users/{email} — removes the Firebase Auth account and the
 * Firestore `users/{email}` and `appUserSecrets/{email}` docs. Auth goes first; a missing Auth account (legacy
 * docs) is fine, so a retry after a partial failure always finishes the job.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ email: string }> }) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const email = decodeURIComponent((await ctx.params).email)
  try {
    try {
      const user = await firebaseAuth().getUserByEmail(email)
      await firebaseAuth().deleteUser(user.uid)
    } catch (e) {
      if ((e as { code?: string })?.code !== "auth/user-not-found") throw e
    }
    await firestore().collection(APP_USERS_COLLECTION).doc(email).delete()
    await firestore().collection(APP_USER_SECRETS_COLLECTION).doc(email).delete()
    return new Response(null, { status: 204 })
  } catch (e) {
    return errorResponse(e)
  }
}
