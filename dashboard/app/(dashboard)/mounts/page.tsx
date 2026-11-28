"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Plus, Search, Copy, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { api, type APIMount } from "@/lib/api"
import { SettingsContext } from "@/app/(dashboard)/layout"
import { useI18n } from "@/lib/i18n"
import {
  AppUserLinkFields, emptyAppUserLink, isAppUserLinkValid, submitAppUserLink, useAppUsers,
} from "@/components/app-user-link"

// ── Types ──

export type Mount = {
  id: string; name: string; protocol: string; codec: string; bitrate: string
  listeners: number; status: "idle" | "live" | "error"; created: string
  radioName: string; description: string; genre: string; website: string
  playerStationName: string; playerAccent: string; playerAccentSoft: string
  playerTheme: string; playerLayout: string; playerAmbient: boolean
  playerShowAbout: boolean; playerShowHistory: boolean; playerShowPlaylist: boolean
  jinglePlaylistId: string; jingleEveryTracks: number; jingleEveryMinutes: number
}

export function adaptApiMount(m: APIMount): Mount {
  return {
    id: m.id, name: m.name, protocol: m.protocol || "HLS",
    codec: m.codec || "AAC", bitrate: m.bitrate || "128k",
    listeners: m.listeners, status: m.status as Mount["status"],
    created: m.created_at.slice(0, 10), radioName: m.radio_name ?? "", description: m.description,
    genre: m.genre, website: m.website,
    playerStationName: m.player_station_name ?? "",
    playerAccent: m.player_accent ?? "#E85D2F",
    playerAccentSoft: m.player_accent_soft ?? "rgba(232,93,47,0.16)",
    playerTheme: m.player_theme ?? "dark",
    playerLayout: m.player_layout ?? "split",
    playerAmbient: m.player_ambient ?? true,
    playerShowAbout: m.player_show_about ?? true,
    playerShowHistory: m.player_show_history ?? true,
    playerShowPlaylist: m.player_show_playlist ?? true,
    jinglePlaylistId: m.jingle_playlist_id ?? "",
    jingleEveryTracks: m.jingle_every_tracks ?? 0,
    jingleEveryMinutes: m.jingle_every_minutes ?? 0,
  }
}

// ── Design primitives ──

export function PulseDot({ status }: { status: Mount["status"] }) {
  return (
    <span className={cn(
      "inline-block w-1.5 h-1.5 rounded-full shrink-0",
      status === "live"  ? "bg-emerald-500 pulse-dot" :
      status === "error" ? "bg-red-500" : "bg-ink-600"
    )} />
  )
}

export function KBtn({
  onClick, title, children, className,
}: { onClick?: React.MouseEventHandler<HTMLButtonElement>; title?: string; children: React.ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn("h-7 w-7 rounded-md hover:bg-ink-800 text-ink-400 hover:text-ink-200 flex items-center justify-center transition-colors shrink-0", className)}
    >
      {children}
    </button>
  )
}

// ── Create Mount Dialog ──

// The Source Password field is hidden from the dashboard, but the server still
// requires one (min 8 chars), so each new mount gets a random 32-char hex value.
function generateSourcePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")
}

function CreateMountDialog({ onCreated }: { onCreated: (m: Mount) => void }) {
  const [open, setOpen]                     = React.useState(false)
  const [name, setName]                     = React.useState("")
  const [radioName, setRadioName]           = React.useState("")
  const [bitrate, setBitrate]               = React.useState("64k")
  const [codec, setCodec]                   = React.useState("MP3")
  const [protocol, setProtocol]             = React.useState("HLS")
  const [description, setDescription]       = React.useState("")
  const [genre, setGenre]                   = React.useState("")
  const [loading, setLoading]               = React.useState(false)
  const [link, setLink]                     = React.useState(() => emptyAppUserLink("existing"))
  const appUsers = useAppUsers(open)
  const { t } = useI18n()

  const linkValid = isAppUserLinkValid(link, appUsers.users)
  const reset = () => { setLink(emptyAppUserLink("existing")); setName(""); setRadioName(""); setDescription(""); setGenre(""); setBitrate("64k"); setCodec("MP3"); setProtocol("HLS") }

  const handleCreate = () => {
    if (!name.trim() || !radioName.trim() || !linkValid) return
    setLoading(true)
    const normalized = name.startsWith("/") ? name : "/" + name
    api.mounts.create({ name: normalized, radio_name: radioName.trim(), source_password: generateSourcePassword(), bitrate, codec, protocol, description, genre })
      .then(async (m) => {
        // A new mount must always have an app user. If linking fails, remove the
        // mount again and keep the dialog open so the admin can fix and retry.
        try {
          const result = await submitAppUserLink(link, m.name)
          onCreated(adaptApiMount(m))
          toast.success(t("Mount {name} created", { name: normalized }))
          if (result === "created") toast.success(t("App user created"))
          if (result === "linked") toast.success(t("User linked to {mount}", { mount: m.name }))
          setOpen(false); reset()
        } catch (e: unknown) {
          const error = e instanceof Error ? t(e.message) : String(e)
          await api.mounts.delete(m.name)
            .then(() => toast.error(t("Linking the app user failed, so the mount was not created: {error}", { error })))
            .catch(() => {
              onCreated(adaptApiMount(m))
              toast.error(t("Mount created, but linking the app user failed: {error}", { error }))
            })
        }
      })
      .catch((err) => toast.error(t("Create failed: {error}", { error: err.message })))
      .finally(() => setLoading(false))
  }

  const inputCls = "h-8 w-full bg-ink-950 border border-ink-800 rounded-md px-3 text-[12.5px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none"

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="h-9 px-3.5 bg-k-500 hover:bg-k-400 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors">
        <Plus className="h-3.5 w-3.5" /> {t("New Mount")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) { setOpen(false); reset() } }}>
          <div className="w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border border-ink-800 bg-ink-900 p-5 space-y-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink-100">{t("New Mount")}</h2>
              <p className="text-[12px] text-ink-500 mt-0.5">{t("Create a new stream endpoint")}</p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wider text-ink-500 font-mono">{t("Mount Name *")}</label>
                <input className={cn(inputCls, "font-mono")} placeholder="/radio1" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wider text-ink-500 font-mono">{t("Radio Name *")}</label>
                <input className={inputCls} placeholder={t("e.g. Rádio WorkPlay")} value={radioName} onChange={(e) => setRadioName(e.target.value)} />
              </div>
              <div className="space-y-2 rounded-md border border-ink-800 bg-ink-950/40 p-3">
                <label className="text-[11px] uppercase tracking-wider text-ink-500 font-mono">{t("App user *")}</label>
                <AppUserLinkFields
                  value={link}
                  onChange={setLink}
                  users={appUsers.users}
                  usersLoading={appUsers.loading}
                  usersError={appUsers.error}
                  hideEnabled
                  idPrefix="new-mount-app-user"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wider text-ink-500 font-mono">Codec</label>
                  <Select value={codec} onValueChange={setCodec}>
                    <SelectTrigger className="h-8 bg-ink-950 border-ink-800 text-ink-100"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="AAC">AAC</SelectItem><SelectItem value="MP3">MP3</SelectItem><SelectItem value="OPUS">OPUS</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wider text-ink-500 font-mono">{t("Bitrate")}</label>
                  <Select value={bitrate} onValueChange={setBitrate}>
                    <SelectTrigger className="h-8 bg-ink-950 border-ink-800 text-ink-100"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["64k","96k","128k","192k","256k"].map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wider text-ink-500 font-mono">{t("Protocol")}</label>
                <Select value={protocol} onValueChange={setProtocol}>
                  <SelectTrigger className="h-8 bg-ink-950 border-ink-800 text-ink-100"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HLS">{t("HLS — standard latency (6–15s)")}</SelectItem>
                    <SelectItem value="LL-HLS">{t("LL-HLS — low latency (1–3s)")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wider text-ink-500 font-mono">{t("Description")}</label>
                <input className={inputCls} placeholder={t("Optional")} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wider text-ink-500 font-mono">{t("Genre")}</label>
                <input className={inputCls} placeholder={t("Optional")} value={genre} onChange={(e) => setGenre(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => { setOpen(false); reset() }} className="h-9 px-4 rounded-md border border-ink-800 hover:bg-ink-800 text-[13px] text-ink-200 transition-colors">{t("Cancel")}</button>
              <button onClick={handleCreate} disabled={!name || !radioName.trim() || !linkValid || loading}
                className="h-9 px-4 bg-k-500 hover:bg-k-400 disabled:opacity-50 text-white text-[13px] font-semibold transition-colors">
                {loading ? t("Creating…") : t("Create")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Sparkline ──

function Sparkline({ data }: { data: number[] }) {
  const w = 100, h = 24, pad = 2
  const hasSignal = data.some((v) => v > 0)
  if (data.length < 2) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-6">
        <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} stroke="var(--color-ink-700, #3a3a40)" strokeWidth="1" />
      </svg>
    )
  }
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (w - pad * 2) + pad
    const y = h - pad - ((v - min) / range) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const color = hasSignal ? "#fb7314" : "var(--color-ink-700, #3a3a40)"
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-6">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

// ── Page ──

const POLL_INTERVAL = 5_000

export default function MountsPage() {
  const router = useRouter()
  const { publicUrl } = React.useContext(SettingsContext)
  const { t, tn } = useI18n()
  const [mounts, setMounts]             = React.useState<Mount[]>([])
  const [loading, setLoading]           = React.useState(true)
  const [search, setSearch]             = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<"all" | "live" | "idle">("all")
  const [mountHistory, setMountHistory] = React.useState<Record<string, number[]>>({})

  React.useEffect(() => {
    const load = () =>
      api.mounts.list()
        .then((ms) => {
          const adapted = ms.map(adaptApiMount)
          setMounts(adapted)
          setMountHistory((prev) => {
            const next = { ...prev }
            for (const m of adapted) {
              const hist = next[m.id] ?? []
              next[m.id] = [...hist.slice(-19), m.listeners]
            }
            return next
          })
        })
        .catch((err) => toast.error(t("Failed to load mounts: {error}", { error: err.message })))
        .finally(() => setLoading(false))
    load()
    const id = setInterval(load, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [])

  const filtered = mounts.filter((m) => {
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false
    if (statusFilter !== "all" && m.status !== statusFilter) return false
    return true
  })

  const liveCount = mounts.filter((m) => m.status === "live").length
  const idleCount = mounts.filter((m) => m.status !== "live").length

  const toSlug = (name: string) => name.replace(/^\/+/, "")

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-ink-100">{t("Mounts")}</h1>
          <p className="mt-1 text-[12.5px] text-ink-400">
            {tn(mounts.length, "{n} mount", "{n} mounts")} · {t("{n} live", { n: liveCount })} · {t("stream endpoints & source connections")}
          </p>
        </div>
        <CreateMountDialog onCreated={(m) => setMounts((prev) => [m, ...prev])} />
      </div>

      {/* Filters */}
      <div className="mt-6 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500 h-3.5 w-3.5" />
          <input
            className="h-8 w-full bg-transparent border border-ink-800 rounded-md pl-8 pr-3 text-[12px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none"
            placeholder={t("Search mounts…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex bg-ink-900 border border-ink-800 rounded-md p-0.5 text-[12px]">
          {(["all", "live", "idle"] as const).map((f) => {
            const count = f === "all" ? mounts.length : f === "live" ? liveCount : idleCount
            return (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={cn("px-2.5 py-1 rounded capitalize transition-colors",
                  statusFilter === f ? "bg-ink-800 text-ink-100 font-medium" : "text-ink-400 hover:text-ink-200"
                )}>
                {t(f === "all" ? "All" : f === "live" ? "Live" : "Idle")} <span className="text-ink-500 ml-1">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Table */}
      <div className="mt-5 border-t border-ink-800">
        <div className="grid grid-cols-[minmax(0,1.4fr)_80px_140px_minmax(0,1fr)_60px_64px] gap-3 px-1 py-2 text-[10.5px] uppercase tracking-wider text-ink-500 font-mono border-b border-ink-800">
          <div>{t("Mount")}</div><div>{t("Protocol")}</div><div>{t("Codec / Bitrate")}</div>
          <div>{t("Activity")}</div><div className="text-right">{t("Lsnr")}</div><div />
        </div>

        {loading ? (
          <div className="py-16 flex flex-col items-center gap-2 text-ink-500">
            <div className="h-8 w-8 rounded-full border-2 border-ink-800 border-t-k-500 animate-spin" />
            <p className="text-[12px] font-mono mt-1">{t("Loading mounts…")}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-ink-500">
            <p className="text-[12.5px]">{mounts.length === 0 ? t("No mounts yet — click \"New Mount\" above") : t("No mounts match your filters")}</p>
          </div>
        ) : (
          filtered.map((mount) => (
            <div
              key={mount.id}
              className="kast-row grid grid-cols-[minmax(0,1.4fr)_80px_140px_minmax(0,1fr)_60px_64px] gap-3 px-1 py-3 items-center border-b border-ink-800/60 cursor-pointer"
              onClick={() => router.push(`/mounts/${toSlug(mount.name)}`)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <PulseDot status={mount.status} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[13.5px] text-ink-100 truncate">{mount.name}</span>
                    {mount.protocol === "LL-HLS" && (
                      <span className="text-[9.5px] px-1.5 py-px rounded bg-k-500/10 border border-k-500/30 text-k-300 font-mono shrink-0">{t("low-latency")}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-ink-500 font-mono mt-0.5">{t("created {date}", { date: mount.created })}</div>
                </div>
              </div>
              <span className={cn("text-[11px] font-mono", mount.protocol === "LL-HLS" ? "text-k-400" : "text-ink-300")}>
                {mount.protocol}
              </span>
              <span className="text-[12px] font-mono text-ink-300">
                {[mount.codec, mount.bitrate].filter(Boolean).join(" · ") || "—"}
              </span>
              <Sparkline data={mountHistory[mount.id] ?? [mount.listeners]} />
              <span className="text-right text-[12.5px] font-mono text-ink-100">{mount.listeners}</span>
              <div className="row-actions flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                <KBtn title={t("Copy HLS URL")} onClick={() => {
                  const base = (publicUrl || `${window.location.protocol}//${window.location.hostname}:8080`).replace(/\/$/, "")
                  navigator.clipboard.writeText(`${base}/hls/${toSlug(mount.name)}/index.m3u8`)
                  toast.success(t("Copied"))
                }}>
                  <Copy className="h-3 w-3" />
                </KBtn>
                <KBtn onClick={() => router.push(`/mounts/${toSlug(mount.name)}`)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </KBtn>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
