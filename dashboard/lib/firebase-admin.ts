// Server-only Firebase Admin helpers for the "Usuário do Aplicativo" feature.
// Imported exclusively by route handlers under app/firebase-api — never by
// client components, so the service account and app API key stay on the server.
import { cert, getApps, initializeApp, type App } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"

// Existing app data lives in `users/{email}` — the document id is the user's
// e-mail (lower-case, as Firebase Auth normalises it), not the Auth uid.
export const APP_USERS_COLLECTION = "users"

/** Shape written to Firestore `users/{email}`. Older docs may lack some fields. */
export type AppUserDoc = {
  enabled:   boolean
  apiKey:    string
  radioName: string
  kastUrl:   string
  mountId:   string
}

export class ConfigError extends Error {}

/**
 * Credentials come from either:
 *   FIREBASE_SERVICE_ACCOUNT  — the whole service-account JSON (raw or base64), or
 *   FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 */
function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim()
  if (raw) {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")
    const sa = JSON.parse(json) as { project_id: string; client_email: string; private_key: string }
    return { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }
  }
  const projectId   = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  // .env files usually store the PEM with literal "\n" sequences.
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (!projectId || !clientEmail || !privateKey) {
    throw new ConfigError("Firebase is not configured (set FIREBASE_SERVICE_ACCOUNT)")
  }
  return { projectId, clientEmail, privateKey }
}

function app(): App {
  const existing = getApps().find(a => a.name === "kast-app-users")
  if (existing) return existing
  return initializeApp({ credential: cert(loadCredentials()) }, "kast-app-users")
}

export const firebaseAuth = () => getAuth(app())
export const firestore    = () => getFirestore(app())

export function appApiKey(): string {
  const key = process.env.KAST_API_KEY?.trim()
  if (!key) throw new ConfigError("KAST_API_KEY is not configured")
  return key
}

// ── Kast backend helpers ──────────────────────────────────────────────────────

const backend = () => (process.env.API_URL || "http://localhost:8080").replace(/\/$/, "")

/** Calls the Kast server with the caller's session cookie. */
export function kastFetch(req: Request, path: string): Promise<Response> {
  return fetch(`${backend()}${path}`, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache:   "no-store",
  })
}

/** Returns null when the caller is a logged-in Kast admin, else an error Response. */
export async function requireAdmin(req: Request): Promise<Response | null> {
  const res = await kastFetch(req, "/api/auth/me").catch(() => null)
  if (!res || !res.ok) return Response.json({ error: "unauthorized" }, { status: 401 })
  const me = (await res.json()) as { role?: string }
  if (me.role !== "admin") return Response.json({ error: "admin role required" }, { status: 403 })
  return null
}

/**
 * Public Kast API URL saved as `kastUrl`, built from KAST_API_DOMAIN
 * (e.g. "workplay-srv-01-api.mafitech.com.br" → "https://workplay-srv-01-api.mafitech.com.br/").
 * If it is unset, falls back to the dashboard's own host with "dashboard" replaced by "api".
 */
export function kastPublicUrl(req: Request): string {
  const domain = process.env.KAST_API_DOMAIN?.trim().replace(/\/+$/, "")
  if (domain) return `${/^https?:\/\//.test(domain) ? domain : `https://${domain}`}/`
  const host  = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")
  return `${proto}://${host.split(",")[0].trim().replace("dashboard", "api")}/`
}

/**
 * Builds the full Firestore payload for a user linked to `mountId`. The mount is
 * resolved on the Kast server so radioName comes from the DB, not the client.
 * Returns an error Response when the mount is missing or has no Radio Name.
 */
export async function buildAppUserDoc(req: Request, mountId: string, enabled: boolean): Promise<AppUserDoc | Response> {
  const mountRes = await kastFetch(req, `/api/mounts/${encodeURIComponent(mountId.replace(/^\/+/, ""))}`)
  if (!mountRes.ok) return Response.json({ error: "Mount not found" }, { status: 400 })
  const mount = (await mountRes.json()) as { name: string; radio_name?: string }
  if (!mount.radio_name) {
    return Response.json({ error: "This mount has no Radio Name — set it on the mount first" }, { status: 400 })
  }
  try {
    return {
      enabled,
      apiKey:    appApiKey(),
      radioName: mount.radio_name,
      kastUrl:   kastPublicUrl(req),
      mountId:   mount.name,
    }
  } catch (e) {
    return errorResponse(e)
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ConfigError) return Response.json({ error: e.message }, { status: 500 })
  const code = (e as { code?: string })?.code ?? ""
  const messages: Record<string, [number, string]> = {
    "auth/email-already-exists": [409, "E-mail already in use"],
    "auth/invalid-email":        [400, "Invalid e-mail"],
    "auth/invalid-password":     [400, "Password must be at least 6 characters"],
  }
  // Firestore gRPC status 6 = ALREADY_EXISTS (doc().create() on an existing id).
  if ((e as { code?: unknown })?.code === 6) return Response.json({ error: "E-mail already in use" }, { status: 409 })
  // Firestore gRPC status 5 = NOT_FOUND (doc().update() on a missing id).
  if ((e as { code?: unknown })?.code === 5) return Response.json({ error: "App user not found" }, { status: 404 })
  const known = messages[code]
  if (known) return Response.json({ error: known[1] }, { status: known[0] })
  console.error("firebase-api:", e)
  return Response.json({ error: e instanceof Error ? e.message : "internal error" }, { status: 500 })
}
