// Typed fetch client for the Kast server API.
// Auth is via HttpOnly cookie (set by Go server, forwarded through Next.js proxy).
// All API calls use relative URLs so they go through the Next.js /api/* rewrite.

// ── Error type ───────────────────────────────────────────────────────────────

export class APIError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = "APIError"
  }
}

// ── Core fetch helper ────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "include",
    cache: "no-store",
  })
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login"
    return undefined as T
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new APIError(res.status, text)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ── Response types (mirror Go JSON output) ───────────────────────────────────

export type APIStatus = {
  version:     string
  git_commit:  string
  build_time:  string
  uptime_sec:  number
  go_version:  string
  os_arch:     string
  cpu_percent: number   // -1 = unavailable
  mem_rss_mb:  number   // -1 = unavailable, otherwise RSS in MB
  disk?:       APIDiskUsage | null  // filesystem holding the data dir; null = unavailable
}

export type APIDiskUsage = {
  path:         string
  total_bytes:  number
  used_bytes:   number
  free_bytes:   number   // available to the server process
  used_percent: number
}

/** A mount's Radio Name, falling back to its description when no Radio Name is set. */
export function effectiveRadioName(m: { radio_name?: string; description?: string }): string {
  return (m.radio_name ?? "").trim() || (m.description ?? "").trim()
}

export type APIMount = {
  id:                   string
  name:                 string
  radio_name:           string
  description:          string
  genre:                string
  website:              string
  protocol:             string
  codec:                string
  bitrate:              string
  status:               "idle" | "live" | "error"
  listeners:            number
  created_at:           string
  player_station_name:  string
  player_accent:        string
  player_accent_soft:   string
  player_theme:         string
  player_layout:        string
  player_ambient:       boolean
  player_show_about:    boolean
  player_show_history:  boolean
  player_show_playlist: boolean
  jingle_playlist_id:   string
  jingle_every_tracks:  number
  jingle_every_minutes: number
}

export type PlayerConfigBody = {
  player_station_name:  string
  player_accent:        string
  player_accent_soft:   string
  player_theme:         string
  player_layout:        string
  player_ambient:       boolean
  player_show_about:    boolean
  player_show_history:  boolean
  player_show_playlist: boolean
}

export type JingleConfigBody = {
  jingle_playlist_id:   string
  jingle_every_tracks:  number
  jingle_every_minutes: number
}

export type APITrack = {
  id:              string
  path:            string
  title:           string
  artist:          string
  album:           string
  genre:           string
  duration_ms:     number
  bitrate_kbps:    number
  size_bytes:      number
  folder:          string
  rel_folder?:     string   // folder relative to the library root, "/"-separated; "" = top level
  added_at:        string
  has_override:    boolean
  original_title?:  string
  original_artist?: string
  original_album?:  string
  original_genre?:  string
}

export type APIPlaylist = {
  id:           string
  name:         string
  description:  string
  mode:         string
  crossfade_ms: number
  track_paths:  string[]
  created_at:   string
  updated_at:   string
}

export type APINowPlaying = {
  id:          string
  title:       string
  artist:      string
  album:       string
  duration_ms: number
} | null

// ── File upload ───────────────────────────────────────────────────────────────

/** A file to upload plus its path relative to the library folder. */
export type APIUploadItem = { file: File; path: string }

export type APIUploadResult = {
  uploaded: { name: string; error?: string }[]
}

// ── YouTube import ────────────────────────────────────────────────────────────

export type APIImportItemStatus = "pending" | "downloading" | "done" | "error"

export type APIImportItem = {
  ytid:        string
  title:       string
  artist:      string
  duration_ms: number
  thumbnail:   string
  status:      APIImportItemStatus
  progress:    number
  error?:      string
  path?:       string
}

export type APIPreviewResult = {
  type:  "video" | "playlist"
  title: string
  items: APIImportItem[]
}

export type APIImportJob = {
  id:         string
  status:     APIImportItemStatus
  items:      APIImportItem[]
  created_at: string
}

export type StartImportBody = {
  items: Pick<APIImportItem, "ytid" | "title" | "artist" | "duration_ms" | "thumbnail">[]
}

// ── Request body types ───────────────────────────────────────────────────────

export type CreateMountBody = {
  name:            string
  radio_name?:     string
  description?:    string
  genre?:          string
  website?:        string
  source_password: string
  bitrate?:        string
  codec?:          string
  protocol?:       string
}

export type UpdateMountMetadataBody = {
  radio_name?:  string
  description?: string
  genre?:       string
  website?:     string
  codec?:       string
  bitrate?:     string
  protocol?:    string
}

export type APIUpdateMountResponse = APIMount & { autodj_restarted: boolean }

export type CreatePlaylistBody = {
  name:          string
  description?:  string
  mode?:         string
  crossfade_ms?: number
  track_paths?:  string[]
}

export type UpdatePlaylistBody = {
  name?:         string
  description?:  string
  mode?:         string
  crossfade_ms?: number
  track_paths?:  string[]
}

export type StartAutoDJBody = {
  playlist_id:       string
  mode?:             string
  start_track_path?: string
}

export type APIAutoDJSession = {
  mount:       string
  playlist_id: string
  mode?:       "sequential" | "shuffle"
}

export type APIAutoDJTrackInfo = {
  id:          string
  title:       string
  artist:      string
  album:       string
  duration_ms: number
}

export type APIAutoDJTracks = {
  tracks:         APIAutoDJTrackInfo[]
  now_playing_id: string
  queue:          APIAutoDJTrackInfo[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip the leading slash so "/radio1" becomes "radio1" for URL construction. */
function slug(name: string): string {
  return name.replace(/^\/+/, "")
}

function buildQS(params?: Record<string, string | undefined>): string {
  if (!params) return ""
  const entries = Object.entries(params).filter((e): e is [string, string] => !!e[1])
  if (entries.length === 0) return ""
  return "?" + new URLSearchParams(entries).toString()
}

// ── API object ───────────────────────────────────────────────────────────────

export type APIUser = {
  id:         string
  username:   string
  role:       "admin" | "operator" | "viewer"
  created_at: string
}

export type LoginResponse = {
  user: APIUser
}

export type APISettings = {
  public_url:           string
  http_addr:            string
  cors_origins:         string[]
  trust_proxy:          boolean
  ssl_enabled:          boolean
  ssl_auto_cert:        boolean
  ssl_domains:          string[]
  ssl_cert_file:        string
  ssl_key_file:         string
  hls_segment_duration: number
  hls_playlist_size:    number
  log_level:            "debug" | "info" | "warn" | "error"
  log_format:           "text" | "json"
  timezone:             string
  admin_allowlist:      string[]
}

export type APIKey = {
  id:           string
  name:         string
  prefix:       string
  created_at:   string
  last_used_at: string | null
  expires_at:   string | null
  enabled:      boolean
  ip_allowlist: string[]
}

export type CreateAPIKeyResponse = APIKey & { key: string }

export type CreateAPIKeyBody = {
  name:          string
  expires_at?:   string
  ip_allowlist?: string[]
}

export type UpdateAPIKeyBody = {
  name?:         string
  enabled?:      boolean
  ip_allowlist?: string[]
  expires_at?:   string | null
}

export type APIListener = {
  ip:            string
  mount:         string
  last_seen:     string
  connected_at?: string
  country_code:  string
  user_agent:    string
}

export type APIWebhook = {
  id:         string
  url:        string
  events:     string[]  // empty = all events
  secret?:    string
  enabled:    boolean
  created_at: string
}

export type CreateWebhookBody = {
  url:      string
  events:   string[]
  secret?:  string
  enabled?: boolean
}

export type UpdateWebhookBody = {
  url?:     string
  events?:  string[]
  secret?:  string
  enabled?: boolean
}

export type APISchedule = {
  id:            string
  name:          string
  mount:         string
  playlist_id:   string
  days_mask:     number  // bit 0 = Sun … bit 6 = Sat
  start_minutes: number  // minutes since midnight in server timezone
  end_minutes:   number
  enabled:       boolean
  created_at:    string
}

export type CreateScheduleBody = {
  name:          string
  mount:         string
  playlist_id:   string
  days_mask:     number
  start_minutes: number
  end_minutes:   number
  enabled?:      boolean
}

export type UpdateScheduleBody = {
  name?:          string
  mount?:         string
  playlist_id?:   string
  days_mask?:     number
  start_minutes?: number
  end_minutes?:   number
  enabled?:       boolean
}

export const api = {
  auth: {
    /** POST /api/auth/login — sets HttpOnly cookie on success */
    login: (username: string, password: string) =>
      fetch("/api/auth/login", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ username, password }),
        credentials: "include",
      }).then(async (r) => {
        if (!r.ok) throw new APIError(r.status, "invalid credentials")
        return r.json() as Promise<LoginResponse>
      }),

    /** GET /api/auth/me */
    me: () => apiFetch<APIUser>("/api/auth/me"),
  },

  users: {
    list:   () => apiFetch<APIUser[]>("/api/users"),
    create: (body: { username: string; password: string; role: string }) =>
      apiFetch<APIUser>("/api/users", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: { role?: string; password?: string }) =>
      apiFetch<APIUser>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    delete: (id: string) =>
      apiFetch<void>(`/api/users/${id}`, { method: "DELETE" }),
  },

  /** GET /api/status */
  status: () => apiFetch<APIStatus>("/api/status"),

  /** GET /api/listeners */
  listeners: {
    list: () => apiFetch<APIListener[]>("/api/listeners"),
  },

  /** GET /api/settings — PATCH /api/settings */
  settings: {
    get:    () => apiFetch<APISettings>("/api/settings"),
    update: (body: APISettings) => apiFetch<APISettings>("/api/settings", {
      method: "PATCH", body: JSON.stringify(body),
    }),
  },

  /** POST /api/server/restart — DELETE /api/server/reset */
  server: {
    restart:      () => apiFetch<void>("/api/server/restart", { method: "POST" }),
    factoryReset: () => apiFetch<void>("/api/server/reset",   { method: "DELETE" }),
  },

  /** GET /api/autodj/sessions — all active sessions across mounts */
  autoDJSessions: () => apiFetch<APIAutoDJSession[]>("/api/autodj/sessions"),

  mounts: {
    /** GET /api/mounts */
    list: () => apiFetch<APIMount[]>("/api/mounts"),

    /** GET /api/mounts/{name} */
    get: (name: string) => apiFetch<APIMount>(`/api/mounts/${slug(name)}`),

    /** POST /api/mounts */
    create: (body: CreateMountBody) =>
      apiFetch<APIMount>("/api/mounts", {
        method: "POST",
        body:   JSON.stringify(body),
      }),

    /** DELETE /api/mounts/{name} */
    delete: (name: string) =>
      apiFetch<void>(`/api/mounts/${slug(name)}`, { method: "DELETE" }),

    /** PATCH /api/mounts/{name} — update editable metadata (description, genre, website, codec, bitrate, protocol) */
    updateMetadata: (name: string, body: UpdateMountMetadataBody) =>
      apiFetch<APIUpdateMountResponse>(`/api/mounts/${slug(name)}`, {
        method: "PATCH",
        body:   JSON.stringify(body),
      }),

    /** PUT /api/mounts/{name}/player — update player customisation (admin only) */
    updatePlayerConfig: (name: string, body: PlayerConfigBody) =>
      apiFetch<{ status: string }>(`/api/mounts/${slug(name)}/player`, {
        method: "PUT",
        body:   JSON.stringify(body),
      }),

    /** PUT /api/mounts/{name}/jingles — update jingle/ad insertion rule */
    updateJingleConfig: (name: string, body: JingleConfigBody) =>
      apiFetch<{ status: string }>(`/api/mounts/${slug(name)}/jingles`, {
        method: "PUT",
        body:   JSON.stringify(body),
      }),

    /** POST /api/mounts/{name}/autodj */
    startAutoDJ: (name: string, body: StartAutoDJBody) =>
      apiFetch<void>(`/api/mounts/${slug(name)}/autodj`, {
        method: "POST",
        body:   JSON.stringify(body),
      }),

    /** GET /api/mounts/{name}/autodj */
    autoDJStatus: (name: string) =>
      apiFetch<APIAutoDJSession>(`/api/mounts/${slug(name)}/autodj`),

    /** DELETE /api/mounts/{name}/autodj */
    stopAutoDJ: (name: string) =>
      apiFetch<void>(`/api/mounts/${slug(name)}/autodj`, { method: "DELETE" }),

    /** POST /api/mounts/{name}/autodj/skip */
    skipTrack: (name: string) =>
      apiFetch<{ status: string }>(`/api/mounts/${slug(name)}/autodj/skip`, { method: "POST" }),

    /** GET /api/mounts/{name}/autodj/tracks */
    autoDJTracks: (name: string) =>
      apiFetch<APIAutoDJTracks>(`/api/mounts/${slug(name)}/autodj/tracks`),

    /** GET /api/mounts/{name}/autodj/history */
    autoDJHistory: (name: string) =>
      apiFetch<APIAutoDJTrackInfo[]>(`/api/mounts/${slug(name)}/autodj/history`),

    /** POST /api/mounts/{name}/autodj/jump */
    jumpToTrack: (name: string, index: number) =>
      apiFetch<{ status: string; index: number }>(`/api/mounts/${slug(name)}/autodj/jump`, {
        method: "POST",
        body:   JSON.stringify({ index }),
      }),

    /** POST /api/mounts/{name}/autodj/queue */
    insertNext: (name: string, trackId: string) =>
      apiFetch<{ status: string }>(`/api/mounts/${slug(name)}/autodj/queue`, {
        method: "POST",
        body:   JSON.stringify({ track_id: trackId }),
      }),

    /** GET /api/mounts/{name}/nowplaying */
    nowPlaying: (name: string) =>
      apiFetch<APINowPlaying>(`/api/mounts/${slug(name)}/nowplaying`),
  },

  library: {
    /** GET /api/library[?q=&genre=] */
    list: (params?: { q?: string; genre?: string }) =>
      apiFetch<APITrack[]>("/api/library" + buildQS(params)),

    /** PATCH /api/library/:id — update metadata overrides */
    update: (id: string, body: { title: string; artist: string; album: string; genre: string }) =>
      apiFetch<APITrack>(`/api/library/${id}`, {
        method: "PATCH",
        body:   JSON.stringify(body),
      }),

    /** DELETE /api/library/:id/override — revert to file's ID3 values */
    resetOverride: (id: string) =>
      apiFetch<APITrack>(`/api/library/${id}/override`, { method: "DELETE" }),

    /** POST /api/library/delete — bulk delete of tracks and folders (rel_folder paths) */
    deleteMany: (body: { track_ids: string[]; folders: string[] }) =>
      apiFetch<{
        deleted_tracks: number; deleted_folders: number; playlists_updated: number
        failed: { item: string; error: string }[]
      }>("/api/library/delete", { method: "POST", body: JSON.stringify(body) }),

    /** DELETE /api/library/folder?path= — deletes a folder (rel_folder) with all its files */
    deleteFolder: (relFolder: string) =>
      apiFetch<{ deleted_tracks: number; playlists_updated: number }>(
        `/api/library/folder?path=${encodeURIComponent(relFolder)}`, { method: "DELETE" }),

    /** DELETE /api/library/{id} — deletes the audio file and removes it from all playlists */
    delete: (id: string) =>
      apiFetch<{ deleted: string; playlists_updated: number }>(`/api/library/${id}`, { method: "DELETE" }),

    /** POST /api/library/scan */
    scan: () =>
      apiFetch<{ status: string }>("/api/library/scan", { method: "POST" }),

    /**
     * POST /api/library/upload
     * Uploads audio files via XHR so progress can be tracked.
     * Each item's `path` (e.g. "Album/01 Track.mp3") is recreated under the
     * library folder; a bare file name uploads to the library root.
     * onProgress is called with 0–100 as bytes are sent.
     */
    upload: (items: APIUploadItem[], onProgress?: (pct: number) => void): Promise<APIUploadResult> => {
      return new Promise((resolve, reject) => {
        const fd = new FormData()
        items.forEach(({ file, path }) => {
          fd.append("files", file)
          fd.append("paths", path)
        })

        const xhr = new XMLHttpRequest()
        xhr.open("POST", "/api/library/upload")
        // Cookie is sent automatically for same-origin requests.

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100))
          }
        }

        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText)
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(json as APIUploadResult)
            } else {
              reject(new APIError(xhr.status, json.error ?? xhr.statusText))
            }
          } catch {
            reject(new APIError(xhr.status, xhr.statusText))
          }
        }

        xhr.onerror = () => reject(new Error("Network error during upload"))
        xhr.send(fd)
      })
    },

    /** POST /api/library/import/youtube/preview */
    ytPreview: (url: string) =>
      apiFetch<APIPreviewResult>("/api/library/import/youtube/preview", {
        method: "POST",
        body:   JSON.stringify({ url }),
      }),

    /** POST /api/library/import/youtube */
    ytImport: (body: StartImportBody) =>
      apiFetch<{ job_id: string; created_at: string }>("/api/library/import/youtube", {
        method: "POST",
        body:   JSON.stringify(body),
      }),

    /** GET /api/library/imports */
    importJobs: () =>
      apiFetch<APIImportJob[]>("/api/library/imports"),

    /** GET /api/library/imports/{id} */
    importJob: (id: string) =>
      apiFetch<APIImportJob>(`/api/library/imports/${id}`),
  },

  playlists: {
    /** GET /api/playlists */
    list: () => apiFetch<APIPlaylist[]>("/api/playlists"),

    /** GET /api/playlists/{id} */
    get: (id: string) => apiFetch<APIPlaylist>(`/api/playlists/${id}`),

    /** POST /api/playlists */
    create: (body: CreatePlaylistBody) =>
      apiFetch<APIPlaylist>("/api/playlists", {
        method: "POST",
        body:   JSON.stringify(body),
      }),

    /** PUT /api/playlists/{id} */
    update: (id: string, body: UpdatePlaylistBody) =>
      apiFetch<APIPlaylist>(`/api/playlists/${id}`, {
        method: "PUT",
        body:   JSON.stringify(body),
      }),

    /** DELETE /api/playlists/{id} */
    delete: (id: string) =>
      apiFetch<void>(`/api/playlists/${id}`, { method: "DELETE" }),
  },

  webhooks: {
    /** GET /api/webhooks */
    list: () => apiFetch<APIWebhook[]>("/api/webhooks"),

    /** GET /api/webhooks/{id} */
    get: (id: string) => apiFetch<APIWebhook>(`/api/webhooks/${id}`),

    /** POST /api/webhooks */
    create: (body: CreateWebhookBody) =>
      apiFetch<APIWebhook>("/api/webhooks", {
        method: "POST",
        body:   JSON.stringify(body),
      }),

    /** PATCH /api/webhooks/{id} */
    update: (id: string, body: UpdateWebhookBody) =>
      apiFetch<APIWebhook>(`/api/webhooks/${id}`, {
        method: "PATCH",
        body:   JSON.stringify(body),
      }),

    /** DELETE /api/webhooks/{id} */
    delete: (id: string) =>
      apiFetch<void>(`/api/webhooks/${id}`, { method: "DELETE" }),
  },

  schedules: {
    /** GET /api/schedules */
    list: () => apiFetch<APISchedule[]>("/api/schedules"),

    /** GET /api/schedules/{id} */
    get: (id: string) => apiFetch<APISchedule>(`/api/schedules/${id}`),

    /** POST /api/schedules */
    create: (body: CreateScheduleBody) =>
      apiFetch<APISchedule>("/api/schedules", {
        method: "POST",
        body:   JSON.stringify(body),
      }),

    /** PATCH /api/schedules/{id} */
    update: (id: string, body: UpdateScheduleBody) =>
      apiFetch<APISchedule>(`/api/schedules/${id}`, {
        method: "PATCH",
        body:   JSON.stringify(body),
      }),

    /** DELETE /api/schedules/{id} */
    delete: (id: string) =>
      apiFetch<void>(`/api/schedules/${id}`, { method: "DELETE" }),
  },

  apikeys: {
    /** GET /api/apikeys */
    list: () => apiFetch<APIKey[]>("/api/apikeys"),

    /** POST /api/apikeys — returns plaintext key once */
    create: (body: CreateAPIKeyBody) =>
      apiFetch<CreateAPIKeyResponse>("/api/apikeys", {
        method: "POST",
        body:   JSON.stringify(body),
      }),

    /** PATCH /api/apikeys/{id} */
    update: (id: string, body: UpdateAPIKeyBody) =>
      apiFetch<APIKey>(`/api/apikeys/${id}`, {
        method: "PATCH",
        body:   JSON.stringify(body),
      }),

    /** DELETE /api/apikeys/{id} */
    delete: (id: string) =>
      apiFetch<void>(`/api/apikeys/${id}`, { method: "DELETE" }),
  },

  /** Mobile-app users stored in Firebase (served by the dashboard's own /firebase-api routes). */
  appUsers: {
    list: () => firebaseFetch<AppUser[]>("/firebase-api/users"),
    create: (body: CreateAppUserBody) =>
      firebaseFetch<AppUser>("/firebase-api/users", { method: "POST", body: JSON.stringify(body) }),
    setEnabled: (email: string, enabled: boolean) =>
      firebaseFetch<{ email: string; enabled: boolean }>(`/firebase-api/users/${encodeURIComponent(email)}`, {
        method: "PATCH", body: JSON.stringify({ enabled }),
      }),
    /** Deletes the Firebase Auth account and the Firestore users/{email} doc. */
    delete: (email: string) =>
      firebaseFetch<void>(`/firebase-api/users/${encodeURIComponent(email)}`, { method: "DELETE" }),
    /** Links an existing app user to a mount, rewriting apiKey/radioName/kastUrl/mountId. */
    linkToMount: (email: string, mountId: string, enabled: boolean) =>
      firebaseFetch<AppUser>(`/firebase-api/users/${encodeURIComponent(email)}`, {
        method: "PATCH", body: JSON.stringify({ enabled, mountId }),
      }),
  },
}

export type AppUser = {
  email:     string
  enabled:   boolean
  mountId:   string
  radioName: string
  /** Copy of the password saved at creation; "" for users created before that. */
  password?: string
}

export type CreateAppUserBody = {
  enabled:  boolean
  email:    string
  password: string
  /** Optional — omit to create the user without a mount. */
  mountId?: string
}

/** Like apiFetch, but unwraps the `{ error }` JSON body into the thrown message. */
async function firebaseFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers:     { "Content-Type": "application/json" },
    credentials: "include",
    cache:       "no-store",
  })
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login"
    return undefined as T
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new APIError(res.status, data?.error ?? res.statusText)
  return data as T
}
