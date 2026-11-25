"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, ChevronsUpDown, Copy, Music2, SkipForward, Users, Palette, Plus, Pencil, X, Check, TriangleAlert } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  api, type APINowPlaying, type PlayerConfigBody, type JingleConfigBody,
  type APIPlaylist, type APIAutoDJSession, type APIAutoDJTracks,
  type APIAutoDJTrackInfo, type APIListener,
  type UpdateMountMetadataBody,
} from "@/lib/api"

const BITRATE_OPTIONS = ["64k", "96k", "128k", "192k", "256k", "320k"] as const
import { type Mount, adaptApiMount, PulseDot, KBtn } from "../page"
import { SettingsContext } from "@/app/(dashboard)/layout"
import { useI18n, type TFunc } from "@/lib/i18n"

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] uppercase tracking-wider text-ink-500 font-mono font-medium mb-1.5">
      {children}
    </p>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useI18n()
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-ink-800 bg-ink-950/50 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-ink-500 font-mono">{label}</p>
        <p className="truncate font-mono text-[11.5px] text-ink-200">{value}</p>
      </div>
      <KBtn
        title={t("Copy")}
        onClick={() => { navigator.clipboard.writeText(value); toast.success(t("Copied")) }}
      >
        <Copy className="h-3 w-3" />
      </KBtn>
    </div>
  )
}

// Searchable, scrollable playlist picker (replaces Radix Select, which didn't
// scroll reliably with long lists and had no filtering).
function PlaylistCombobox({
  playlists, value, onChange, disabled, placeholder, noneLabel, className,
}: {
  playlists: APIPlaylist[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  placeholder: string
  /** When set, adds a "none" option that clears the selection (value ""). */
  noneLabel?: string
  className?: string
}) {
  const { t, tn } = useI18n()
  const [open, setOpen] = React.useState(false)
  const selected = playlists.find((pl) => pl.id === value)
  const select = (id: string) => { onChange(id); setOpen(false) }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex h-8 w-full items-center justify-between gap-2 border border-ink-800 bg-ink-950 px-2.5 text-left text-[12.5px] text-ink-100 outline-none focus-visible:border-k-500/50 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-ink-500")}>
            {selected ? selected.name : (noneLabel ?? placeholder)}
            {selected && (
              <span className="text-ink-500 ml-1.5 text-xs">
                {tn(selected.track_paths?.length ?? 0, "{n} track", "{n} tracks")}
              </span>
            )}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
        align="start"
        // Keep wheel/touch scrolling inside the list.
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t("Search playlists…")} />
          <CommandList className="max-h-64 overscroll-contain">
            <CommandEmpty>{t("No playlists found.")}</CommandEmpty>
            <CommandGroup>
              {noneLabel && (
                <CommandItem value="__none__" keywords={[noneLabel]} data-checked={value === ""} onSelect={() => select("")}>
                  {noneLabel}
                </CommandItem>
              )}
              {playlists.map((pl) => (
                <CommandItem
                  key={pl.id}
                  value={pl.id}
                  keywords={[pl.name]}
                  data-checked={pl.id === value}
                  onSelect={() => select(pl.id)}
                >
                  <span className="truncate">{pl.name}</span>
                  <span className="text-ink-500 text-xs shrink-0">
                    {tn(pl.track_paths?.length ?? 0, "{n} track", "{n} tracks")}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ── Listener helpers (shared with listeners page) ──

function isPrivate(ip: string): boolean {
  const s = ip.toLowerCase()
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/.test(s)) return true
  if (s === "::1") return true
  if (/^fe[89ab][0-9a-f]:/.test(s)) return true
  if (/^f[cd][0-9a-f]{2}:/.test(s)) return true
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivate(mapped[1])
  return false
}
function countryFlag(code: string): string {
  if (!code || code.length !== 2) return ""
  return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join("")
}
function countryName(code: string, lang: string): string {
  try { return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code } catch { return code }
}
function timeAgo(iso: string, t: TFunc): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 5)  return t("just now")
  if (diff < 60) return t("{n}s ago", { n: diff })
  return t("{n}m ago", { n: Math.floor(diff / 60) })
}

function fmtListeningDuration(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
function parseUA(ua: string): string {
  if (!ua) return "—"
  const s = ua.toLowerCase()
  if (s.includes("vlc"))             return "VLC"
  if (s.includes("mpv"))             return "mpv"
  if (s.includes("lavf"))            return "FFmpeg"
  if (s.includes("liquidsoap"))      return "Liquidsoap"
  if (s.startsWith("curl"))          return "cURL"
  if (s.includes("python-requests")) return "Python"
  if (s.includes("applecoremedia"))  return "AirPlay"
  if (s.includes("itunes"))          return "iTunes"
  if (s.includes("edg/"))            return "Edge"
  if (s.includes("chrome"))          return "Chrome"
  if (s.includes("firefox"))         return "Firefox"
  if (s.includes("safari"))          return "Safari"
  const first = ua.split(/[/ ]/)[0]
  return first.length > 14 ? first.slice(0, 14) + "…" : first
}

function fmtDuration(ms: number): string {
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`
}

// ── Tabs ──

function MountInfoTab({ mount, nowPlaying, onRefreshNowPlaying, history, onUpdated }: {
  mount: Mount; nowPlaying: APINowPlaying; onRefreshNowPlaying: () => void; history: APIAutoDJTrackInfo[]
  onUpdated: (patch: Partial<Mount>) => void
}) {
  const { publicUrl } = React.useContext(SettingsContext)
  const { t } = useI18n()
  const base = (publicUrl || (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:8080` : "")).replace(/\/$/, "")
  const slug = mount.name.replace(/^\/+/, "")

  const [editing, setEditing] = React.useState(false)
  const [saving,  setSaving]  = React.useState(false)

  // Edit field state — reset whenever mount changes or edit is cancelled
  const [desc,     setDesc]     = React.useState(mount.description)
  const [genre,    setGenre]    = React.useState(mount.genre)
  const [website,  setWebsite]  = React.useState(mount.website)
  const [codec,    setCodec]    = React.useState(mount.codec)
  const [bitrate,  setBitrate]  = React.useState(mount.bitrate)
  const [protocol, setProtocol] = React.useState(mount.protocol)

  const openEdit = () => {
    setDesc(mount.description); setGenre(mount.genre); setWebsite(mount.website)
    setCodec(mount.codec); setBitrate(mount.bitrate); setProtocol(mount.protocol)
    setEditing(true)
  }
  const cancelEdit = () => setEditing(false)

  const handleSave = () => {
    setSaving(true)
    const body: UpdateMountMetadataBody = {
      description: desc, genre, website, codec, bitrate, protocol,
    }
    api.mounts.updateMetadata(mount.name, body)
      .then((updated) => {
        toast.success(updated.autodj_restarted ? t("Mount updated — AutoDJ restarted") : t("Mount updated"))
        onUpdated({
          description: updated.description, genre: updated.genre,
          website: updated.website, codec: updated.codec,
          bitrate: updated.bitrate, protocol: updated.protocol,
        })
        setEditing(false)
      })
      .catch((err) => toast.error(t("Save failed: {error}", { error: err.message })))
      .finally(() => setSaving(false))
  }

  const audioChanged = editing && (codec !== mount.codec || bitrate !== mount.bitrate || protocol !== mount.protocol)

  const inputCls = "h-8 w-full bg-ink-950 border border-ink-800 rounded-md px-3 text-[12.5px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none font-mono"

  return (
    <div className="space-y-5">
      {/* Now Playing */}
      <div>
        <SectionLabel>{t("Now Playing")}</SectionLabel>
        <div className="rounded-md border border-ink-800 bg-ink-950/40 px-3 py-3">
          <div className="flex items-center justify-between">
            {nowPlaying ? (
              <div className="flex items-center gap-2 min-w-0">
                <Music2 className="h-3.5 w-3.5 shrink-0 text-k-400" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink-100">{nowPlaying.title || t("Unknown")}</p>
                  <p className="truncate text-[11px] text-ink-500">{nowPlaying.artist || t("Unknown")}</p>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-ink-500">{t("Nothing playing — start AutoDJ")}</p>
            )}
            {nowPlaying && (
              <button
                className="h-7 px-2.5 rounded-md bg-ink-800 hover:bg-ink-700 text-[11.5px] text-ink-200 inline-flex items-center gap-1.5 transition-colors shrink-0 ml-2"
                onClick={() =>
                  api.mounts.skipTrack(mount.name)
                    .then(() => { toast.success(t("Skipped")); setTimeout(onRefreshNowPlaying, 300); setTimeout(onRefreshNowPlaying, 1200) })
                    .catch((err) => toast.error(t("Skip failed: {error}", { error: err.message })))
                }
              >
                <SkipForward className="h-3 w-3" /> {t("Skip")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <SectionLabel>{t("Metadata")}</SectionLabel>
          {!editing ? (
            <button
              onClick={openEdit}
              className="inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-200 transition-colors font-mono"
            >
              <Pencil className="h-3 w-3" /> {t("Edit")}
            </button>
          ) : (
            <button
              onClick={cancelEdit}
              className="inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-200 transition-colors font-mono"
            >
              <X className="h-3 w-3" /> {t("Cancel")}
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            {/* Read-only rows */}
            {[["Name", mount.name], ["Created", mount.created]].map(([k, v]) => (
              <div key={k} className="flex justify-between text-[12px]">
                <span className="text-ink-500">{t(k)}</span>
                <span className="text-ink-200 font-mono truncate max-w-[300px]">{v}</span>
              </div>
            ))}
            <div className="pt-1 space-y-2">
              <div className="space-y-1">
                <p className="text-[10.5px] uppercase tracking-wider text-ink-600 font-mono">{t("Description")}</p>
                <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("Station description")} />
              </div>
              <div className="space-y-1">
                <p className="text-[10.5px] uppercase tracking-wider text-ink-600 font-mono">{t("Genre")}</p>
                <input className={inputCls} value={genre} onChange={(e) => setGenre(e.target.value)} placeholder={t("e.g. Jazz, Electronic…")} />
              </div>
              <div className="space-y-1">
                <p className="text-[10.5px] uppercase tracking-wider text-ink-600 font-mono">{t("Website")}</p>
                <input className={inputCls} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {[
              ["Name", mount.name], ["Description", mount.description || "—"],
              ["Genre", mount.genre || "—"], ["Website", mount.website || "—"],
              ["Created", mount.created],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-[12px]">
                <span className="text-ink-500">{t(k)}</span>
                <span className="text-ink-200 font-mono truncate max-w-[300px]">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-ink-800" />

      {/* Audio */}
      <div>
        <SectionLabel>{t("Audio")}</SectionLabel>
        {editing ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <p className="text-[10.5px] uppercase tracking-wider text-ink-600 font-mono">Codec</p>
              <Select value={codec} onValueChange={setCodec}>
                <SelectTrigger className="bg-ink-950 border-ink-800 text-ink-100 focus:ring-k-500/30 h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AAC">AAC</SelectItem>
                  <SelectItem value="MP3">MP3</SelectItem>
                  <SelectItem value="OPUS">OPUS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-[10.5px] uppercase tracking-wider text-ink-600 font-mono">{t("Bitrate")}</p>
              <Select value={bitrate} onValueChange={setBitrate}>
                <SelectTrigger className="bg-ink-950 border-ink-800 text-ink-100 focus:ring-k-500/30 h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BITRATE_OPTIONS.map((b) => (
                    <SelectItem key={b} value={b}>{b.replace("k", " kbps")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-[10.5px] uppercase tracking-wider text-ink-600 font-mono">{t("Protocol")}</p>
              <Select value={protocol} onValueChange={setProtocol}>
                <SelectTrigger className="bg-ink-950 border-ink-800 text-ink-100 focus:ring-k-500/30 h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HLS">HLS</SelectItem>
                  <SelectItem value="LL-HLS">LL-HLS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {audioChanged && (
              <p className="flex items-center gap-1.5 text-[11px] text-amber-400/80 font-mono">
                <TriangleAlert className="h-3 w-3 shrink-0" />
                {t("Changing the codec, bitrate or protocol restarts AutoDJ.")}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            {[["Codec", mount.codec], ["Bitrate", mount.bitrate], ["Protocol", mount.protocol]].map(([k, v]) => (
              <div key={k} className="flex justify-between text-[12px]">
                <span className="text-ink-500">{t(k)}</span>
                <span className="text-ink-200 font-mono">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <button
          onClick={handleSave} disabled={saving}
          className="w-full h-9 bg-k-500 hover:bg-k-400 disabled:opacity-50 text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors rounded-md"
        >
          <Check className="h-3.5 w-3.5" />
          {saving ? t("Saving…") : t("Save Changes")}
        </button>
      )}

      <div className="border-t border-ink-800" />

      {/* URLs */}
      <div>
        <SectionLabel>{t("Endpoint URLs")}</SectionLabel>
        <div className="space-y-2">
          <CopyRow label={t("Public player")} value={`${typeof window !== "undefined" ? window.location.origin : ""}/listen/${slug}`} />
          <CopyRow label={t("HLS playlist")} value={`${base}/hls/${slug}/index.m3u8`} />
          <CopyRow label={t("Source input")} value={`${base}/source/${slug}`} />
        </div>
      </div>

      {/* Recently Played */}
      {history.length > 0 && (
        <>
          <div className="border-t border-ink-800" />
          <div>
            <SectionLabel>{t("Recently Played")}</SectionLabel>
            <div className="space-y-1">
              {history.map((tr, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-md border border-ink-800 bg-ink-950/30">
                  <span className="text-[11px] font-mono text-ink-600 w-4 shrink-0 text-right">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-ink-200">{tr.title || t("Unknown")}</p>
                    <p className="truncate text-[11px] text-ink-500">{tr.artist || "—"}</p>
                  </div>
                  {tr.duration_ms > 0 && (
                    <span className="text-[10.5px] font-mono text-ink-600 shrink-0">{fmtDuration(tr.duration_ms)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MountListenersTab({ mount }: { mount: Mount }) {
  const [listeners, setListeners] = React.useState<APIListener[] | null>(null)
  const { t, tn, lang } = useI18n()

  React.useEffect(() => {
    const load = () =>
      api.listeners.list()
        .then((all) => setListeners(all.filter((l) => l.mount === mount.name)))
        .catch(() => {})
    load()
    const id = setInterval(load, 5_000)
    return () => clearInterval(id)
  }, [mount.name])

  const count = listeners?.length ?? mount.listeners

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-mono text-ink-300">
          <Users className="h-3.5 w-3.5 text-ink-500" />
          {tn(count, "{n} listener connected", "{n} listeners connected")}
        </span>
      </div>

      {listeners === null ? (
        <div className="py-10 flex items-center justify-center">
          <div className="h-6 w-6 rounded-full border-2 border-ink-800 border-t-k-500 animate-spin" />
        </div>
      ) : listeners.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-ink-500">
          <Users className="h-8 w-8 opacity-20" />
          <p className="text-[12px]">{t("No active listeners on this mount")}</p>
        </div>
      ) : (
        <div className="border-t border-ink-800">
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_80px_60px] gap-3 px-1 py-2 text-[10.5px] uppercase tracking-wider text-ink-500 font-mono border-b border-ink-800">
            <div>IP</div><div>{t("Location")}</div><div>{t("Client")}</div><div className="text-right">{t("Since")}</div>
          </div>
          {listeners.map((l, i) => (
            <div key={`${l.ip}-${i}`}
              className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_80px_60px] gap-3 px-1 py-3 items-center border-b border-ink-800/60 last:border-0">
              <span className="font-mono text-[12.5px] text-ink-100 truncate" title={l.ip}>{l.ip}</span>
              <span className="text-[12px] font-mono truncate">
                {isPrivate(l.ip)
                  ? <span className="text-ink-500">{t("Local")}</span>
                  : l.country_code
                    ? <span className="flex items-center gap-1.5"><span>{countryFlag(l.country_code)}</span><span className="text-ink-300">{countryName(l.country_code, lang)}</span></span>
                    : <span className="text-ink-600">—</span>
                }
              </span>
              <span className="font-mono text-[11.5px] text-ink-400 truncate" title={l.user_agent || undefined}>{parseUA(l.user_agent)}</span>
              <span className="text-right text-[11px] text-ink-500 font-mono">
                {l.connected_at ? fmtListeningDuration(l.connected_at) : timeAgo(l.last_seen, t)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const ACCENT_OPTIONS = [
  { name: "Sunset",    value: "#E85D2F", soft: "rgba(232,93,47,0.16)" },
  { name: "Tangerine", value: "#F0A040", soft: "rgba(240,160,64,0.16)" },
  { name: "Forest",    value: "#3D8B5E", soft: "rgba(61,139,94,0.16)" },
  { name: "Cobalt",    value: "#2B6FE0", soft: "rgba(43,111,224,0.16)" },
  { name: "Violet",    value: "#7B5CC7", soft: "rgba(123,92,199,0.16)" },
  { name: "Magenta",   value: "#D4407C", soft: "rgba(212,64,124,0.16)" },
  { name: "Crimson",   value: "#C13C3C", soft: "rgba(193,60,60,0.16)" },
  { name: "Bone",      value: "#D9D2C6", soft: "rgba(217,210,198,0.16)" },
]

function MountPlayerTab({ mount, onUpdated }: { mount: Mount; onUpdated: (patch: Partial<Mount>) => void }) {
  const [stationName, setStationName]     = React.useState(mount.playerStationName)
  const [accent, setAccent]               = React.useState(mount.playerAccent)
  const [accentSoft, setAccentSoft]       = React.useState(mount.playerAccentSoft)
  const [theme, setTheme]                 = React.useState<"dark" | "light">(mount.playerTheme as "dark" | "light" || "dark")
  const [layout, setLayout]               = React.useState<"split" | "centered">(mount.playerLayout as "split" | "centered" || "split")
  const [ambient, setAmbient]             = React.useState(mount.playerAmbient)
  const [showAbout, setShowAbout]         = React.useState(mount.playerShowAbout)
  const [showHistory, setShowHistory]     = React.useState(mount.playerShowHistory)
  const [showPlaylist, setShowPlaylist]   = React.useState(mount.playerShowPlaylist)
  const [saving, setSaving]               = React.useState(false)
  const { t } = useI18n()

  const slug = mount.name.replace(/^\/+/, "")
  const playerUrl = typeof window !== "undefined" ? `${window.location.origin}/listen/${slug}` : `/listen/${slug}`

  const handleSave = () => {
    setSaving(true)
    const body: PlayerConfigBody = {
      player_station_name: stationName, player_accent: accent, player_accent_soft: accentSoft,
      player_theme: theme, player_layout: layout, player_ambient: ambient,
      player_show_about: showAbout, player_show_history: showHistory, player_show_playlist: showPlaylist,
    }
    api.mounts.updatePlayerConfig(mount.name, body)
      .then(() => {
        toast.success(t("Player settings saved"))
        onUpdated({ playerStationName: stationName, playerAccent: accent, playerAccentSoft: accentSoft,
          playerTheme: theme, playerLayout: layout, playerAmbient: ambient,
          playerShowAbout: showAbout, playerShowHistory: showHistory, playerShowPlaylist: showPlaylist })
      })
      .catch((err) => toast.error(t("Save failed: {error}", { error: err.message })))
      .finally(() => setSaving(false))
  }

  return (
    <div className="space-y-5">
      {/* Player URL */}
      <div className="flex items-center gap-2 rounded-md border border-ink-800 bg-ink-950/40 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-ink-500 font-mono">{t("Player URL")}</p>
          <p className="truncate font-mono text-[11.5px] text-ink-200">{playerUrl}</p>
        </div>
        <button onClick={() => window.open(playerUrl, "_blank")} className="h-7 px-2 rounded-md hover:bg-ink-800 text-[11.5px] text-ink-400 hover:text-ink-200 transition-colors shrink-0">
          {t("Open ↗")}
        </button>
      </div>

      {/* Station name */}
      <div className="space-y-1.5">
        <SectionLabel>{t("Display Name")}</SectionLabel>
        <input
          className="h-8 w-full bg-ink-950 border border-ink-800 rounded-md px-3 text-[12.5px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none"
          placeholder={slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          value={stationName}
          onChange={(e) => setStationName(e.target.value)}
        />
      </div>

      {/* Theme */}
      <div className="space-y-1.5">
        <SectionLabel>{t("Theme")}</SectionLabel>
        <div className="flex gap-2">
          {(["dark", "light"] as const).map((th) => (
            <button key={th} onClick={() => setTheme(th)}
              className={cn("flex-1 rounded-md border py-1.5 text-[12px] transition-colors",
                theme === th ? "border-ink-300 bg-ink-800 text-ink-100 font-medium" : "border-ink-800 text-ink-500 hover:border-ink-700"
              )}>
              {th === "dark" ? t("Dark") : t("Light")}
            </button>
          ))}
        </div>
      </div>

      {/* Layout */}
      <div className="space-y-1.5">
        <SectionLabel>{t("Layout")}</SectionLabel>
        <div className="flex gap-2">
          {(["split", "centered"] as const).map((l) => (
            <button key={l} onClick={() => setLayout(l)}
              className={cn("flex-1 rounded-md border py-1.5 text-[12px] transition-colors",
                layout === l ? "border-ink-300 bg-ink-800 text-ink-100 font-medium" : "border-ink-800 text-ink-500 hover:border-ink-700"
              )}>
              {l === "split" ? t("Split") : t("Centered")}
            </button>
          ))}
        </div>
      </div>

      {/* Accent */}
      <div className="space-y-1.5">
        <SectionLabel>{t("Accent Color")}</SectionLabel>
        <div className="grid grid-cols-8 gap-1.5">
          {ACCENT_OPTIONS.map((c) => (
            <button key={c.value} onClick={() => { setAccent(c.value); setAccentSoft(c.soft) }} title={c.name}
              className="aspect-square rounded-md transition-transform hover:scale-110"
              style={{ background: c.value, outline: accent === c.value ? `2px solid ${c.value}` : "none", outlineOffset: "2px" }}
            />
          ))}
        </div>
        <p className="text-[11px] text-ink-600 font-mono">{accent}</p>
      </div>

      {/* Toggles */}
      <div className="space-y-2">
        <SectionLabel>{t("Options")}</SectionLabel>
        {[
          { label: "Ambient glow",         value: ambient,      set: setAmbient },
          { label: "Show about section",   value: showAbout,    set: setShowAbout },
          { label: "Show recently played", value: showHistory,  set: setShowHistory },
          { label: "Show playlist",        value: showPlaylist, set: setShowPlaylist },
        ].map(({ label, value, set }) => (
          <div key={label} className="flex items-center justify-between rounded-md border border-ink-800 px-3 py-2.5">
            <span className="text-[12.5px] text-ink-200">{t(label)}</span>
            <button onClick={() => set(!value)}
              className={cn("relative h-5 w-9 rounded-full transition-colors", value ? "bg-k-500" : "bg-ink-700")}>
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", value ? "left-[18px]" : "left-0.5")} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave} disabled={saving}
        className="w-full h-9 bg-k-500 hover:bg-k-400 disabled:opacity-50 text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
      >
        <Palette className="h-3.5 w-3.5" />
        {saving ? t("Saving…") : t("Save Player Settings")}
      </button>
    </div>
  )
}

function MountAutoDJTab({ mount }: { mount: Mount }) {
  const [playlists, setPlaylists]               = React.useState<APIPlaylist[]>([])
  const [session, setSession]                   = React.useState<APIAutoDJSession | null>(null)
  const [selectedPlaylist, setSelectedPlaylist] = React.useState("")
  const [mode, setMode]                         = React.useState<"sequential" | "shuffle">("shuffle")
  const [loading, setLoading]                   = React.useState(true)
  const [acting, setActing]                     = React.useState(false)
  const [trackData, setTrackData]               = React.useState<APIAutoDJTracks | null>(null)
  const nowPlayingRowRef                        = React.useRef<HTMLDivElement | null>(null)
  const { t, tn, tx } = useI18n()

  // Jingle/ad insertion. Saved on the mount, applied on next AutoDJ start.
  const [jinglePlaylistId,   setJinglePlaylistId]   = React.useState(mount.jinglePlaylistId)
  const [jingleEveryTracks,  setJingleEveryTracks]  = React.useState(mount.jingleEveryTracks)
  const [jingleEveryMinutes, setJingleEveryMinutes] = React.useState(mount.jingleEveryMinutes)
  const [jingleSaving,       setJingleSaving]       = React.useState(false)
  const jingleDirty =
    jinglePlaylistId   !== mount.jinglePlaylistId   ||
    jingleEveryTracks  !== mount.jingleEveryTracks  ||
    jingleEveryMinutes !== mount.jingleEveryMinutes

  React.useEffect(() => {
    Promise.all([api.playlists.list(), api.mounts.autoDJStatus(mount.name).catch(() => null)])
      .then(([pls, sess]) => {
        setPlaylists(pls)
        setSession(sess)
        if (sess) {
          setSelectedPlaylist(sess.playlist_id)
          // Reflect the running session's mode; otherwise the default
          // "shuffle" would be sent on the next Restart.
          if (sess.mode) setMode(sess.mode)
        }
      })
      .finally(() => setLoading(false))
  }, [mount.name])

  const isRunning      = !!session
  const activePlaylist = playlists.find((p) => p.id === session?.playlist_id)

  React.useEffect(() => {
    if (!isRunning) { setTrackData(null); return }
    const load = () => api.mounts.autoDJTracks(mount.name).then(setTrackData).catch(() => {})
    load()
    const id = setInterval(load, 5_000)
    return () => clearInterval(id)
  }, [isRunning, mount.name])

  React.useEffect(() => {
    if (nowPlayingRowRef.current) {
      nowPlayingRowRef.current.scrollIntoView({ block: "nearest" })
    }
  }, [trackData?.now_playing_id])

  const handleStart = () => {
    if (!selectedPlaylist) return
    setActing(true)
    api.mounts.startAutoDJ(mount.name, { playlist_id: selectedPlaylist, mode })
      .then(() => { setSession({ mount: mount.name, playlist_id: selectedPlaylist, mode }); toast.success(t("AutoDJ started")) })
      .catch((err) => toast.error(t("Failed: {error}", { error: err.message })))
      .finally(() => setActing(false))
  }

  const handleStop = () => {
    setActing(true)
    api.mounts.stopAutoDJ(mount.name)
      .then(() => { setSession(null); toast.success(t("AutoDJ stopped")) })
      .catch((err) => toast.error(t("Failed: {error}", { error: err.message })))
      .finally(() => setActing(false))
  }

  const handleRestart = () => {
    if (!selectedPlaylist) return
    setActing(true)
    api.mounts.stopAutoDJ(mount.name).catch(() => {})
      .then(() => api.mounts.startAutoDJ(mount.name, { playlist_id: selectedPlaylist, mode }))
      .then(() => { setSession({ mount: mount.name, playlist_id: selectedPlaylist, mode }); toast.success(t("AutoDJ restarted")) })
      .catch((err) => toast.error(t("Failed: {error}", { error: err.message })))
      .finally(() => setActing(false))
  }

  const handleJingleSave = () => {
    const body: JingleConfigBody = {
      jingle_playlist_id:   jinglePlaylistId,
      jingle_every_tracks:  Math.max(0, jingleEveryTracks | 0),
      jingle_every_minutes: Math.max(0, jingleEveryMinutes | 0),
    }
    setJingleSaving(true)
    api.mounts.updateJingleConfig(mount.name, body)
      .then(() => {
        mount.jinglePlaylistId   = body.jingle_playlist_id
        mount.jingleEveryTracks  = body.jingle_every_tracks
        mount.jingleEveryMinutes = body.jingle_every_minutes
        const msg = body.jingle_playlist_id && (body.jingle_every_tracks > 0 || body.jingle_every_minutes > 0)
          ? t("Jingle settings saved") : t("Jingles disabled")
        toast.success(isRunning ? t("{message} — restart AutoDJ to apply", { message: msg }) : msg)
      })
      .catch((err) => toast.error(t("Failed: {error}", { error: err.message })))
      .finally(() => setJingleSaving(false))
  }

  const jingleConfigured = !!mount.jinglePlaylistId && (mount.jingleEveryTracks > 0 || mount.jingleEveryMinutes > 0)
  const jingleSummary = jingleConfigured
    ? [
        mount.jingleEveryTracks  > 0 ? tn(mount.jingleEveryTracks, "every {n} track", "every {n} tracks") : null,
        mount.jingleEveryMinutes > 0 ? t("every {n} min", { n: mount.jingleEveryMinutes })              : null,
      ].filter(Boolean).join(t(" or "))
    : ""
  const jinglePlaylistName = playlists.find((p) => p.id === mount.jinglePlaylistId)?.name ?? ""

  if (loading) return (
    <div className="flex items-center justify-center py-12 text-[12px] text-ink-500 font-mono">{t("Loading…")}</div>
  )

  return (
    <div className="space-y-5">
      {/* Status */}
      <div className="flex items-center justify-between rounded-md border border-ink-800 bg-ink-950/40 px-3 py-3">
        <div>
          <p className="text-[10.5px] uppercase tracking-wider text-ink-500 font-mono mb-1">{t("Status")}</p>
          {isRunning && activePlaylist && (
            <p className="text-[12px] text-ink-300">
              {tx("Playing {playlist} · {mode}", {
                playlist: <span className="text-ink-100 font-medium">{activePlaylist.name}</span>,
                mode: mode === "shuffle" ? t("Shuffle") : t("Sequential"),
              })}
            </p>
          )}
          {!isRunning && <p className="text-[12px] text-ink-500">{t("Not running")}</p>}
          {isRunning && jingleConfigured && (
            <p className="mt-0.5 text-[11px] text-ink-500">
              {t("Jingles:")} <span className="text-ink-300">{jinglePlaylistName || "—"}</span> · {jingleSummary}
            </p>
          )}
        </div>
        <span className={cn(
          "text-[11px] font-mono px-2 py-0.5 rounded border",
          isRunning ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-ink-700 text-ink-500"
        )}>
          {isRunning ? t("Running") : t("Stopped")}
        </span>
      </div>

      {/* Playlist browser */}
      {isRunning && trackData && trackData.tracks.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>{tn(trackData.tracks.length, "Playlist ({n} track)", "Playlist ({n} tracks)")}</SectionLabel>
          <div className="rounded-md border border-ink-800 overflow-hidden">
            <div className="max-h-64 overflow-y-auto">
              {trackData.tracks.map((tr, i) => {
                const isNow = tr.id === trackData.now_playing_id
                return (
                  <div
                    key={tr.id + i}
                    ref={isNow ? nowPlayingRowRef : null}
                    className={cn(
                      "group relative flex items-center gap-2 px-3 py-2 border-b border-ink-800/50 last:border-0",
                      isNow ? "bg-k-500/10" : "hover:bg-ink-800/40"
                    )}
                  >
                    <span className={cn("text-[10.5px] font-mono w-5 shrink-0 text-right", isNow ? "text-k-400" : "text-ink-600")}>
                      {isNow ? <Music2 className="h-3 w-3 text-k-400 inline" /> : i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={cn("truncate text-[12px]", isNow ? "text-k-300 font-medium" : "text-ink-200")}>{tr.title || t("Unknown")}</p>
                      <p className="truncate text-[10.5px] text-ink-500">{tr.artist || "—"}</p>
                    </div>
                    {tr.duration_ms > 0 && (
                      <span className="text-[10.5px] font-mono text-ink-600 shrink-0 group-hover:opacity-0 transition-opacity">
                        {fmtDuration(tr.duration_ms)}
                      </span>
                    )}
                    <div className="absolute right-2 inset-y-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        title={t("Jump to this track")}
                        onClick={() =>
                          api.mounts.jumpToTrack(mount.name, i)
                            .then(() => {
                              toast.success(t("Jumping to \"{title}\"", { title: tr.title || t("track") }))
                              setTimeout(() => api.mounts.autoDJTracks(mount.name).then(setTrackData).catch(() => {}), 700)
                            })
                            .catch((err) => toast.error(t("Jump failed: {error}", { error: err.message })))
                        }
                        className="h-6 px-2 rounded bg-ink-700 hover:bg-k-500 text-ink-200 text-[11px] font-mono flex items-center gap-1 transition-colors"
                      >
                        <SkipForward className="h-3 w-3" /> {t("Jump")}
                      </button>
                      <button
                        title={t("Play after current track")}
                        onClick={() =>
                          api.mounts.insertNext(mount.name, tr.id)
                            .then(() => {
                              toast.success(t("Queued \"{title}\"", { title: tr.title || t("track") }))
                              api.mounts.autoDJTracks(mount.name).then(setTrackData).catch(() => {})
                            })
                            .catch((err) => toast.error(t("Queue failed: {error}", { error: err.message })))
                        }
                        className="h-6 px-2 rounded bg-ink-700 hover:bg-ink-600 text-ink-200 text-[11px] font-mono flex items-center gap-1 transition-colors"
                      >
                        <Plus className="h-3 w-3" /> {t("Next")}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* One-shot queue */}
          {trackData.queue.length > 0 && (
            <div className="mt-1">
              <p className="text-[10.5px] uppercase tracking-wider text-ink-500 font-mono mb-1">{t("Up Next (one-shot)")}</p>
              <div className="rounded-md border border-ink-800/60 bg-ink-950/30 divide-y divide-ink-800/40">
                {trackData.queue.map((tr, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2">
                    <span className="text-[10.5px] font-mono text-ink-600 w-4 shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[11.5px] text-ink-300">{tr.title || t("Unknown")}</p>
                      <p className="truncate text-[10.5px] text-ink-500">{tr.artist || "—"}</p>
                    </div>
                    {tr.duration_ms > 0 && (
                      <span className="text-[10.5px] font-mono text-ink-600 shrink-0">{fmtDuration(tr.duration_ms)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Playlist */}
      <div className="space-y-1.5">
        <SectionLabel>{t("Playlist")}</SectionLabel>
        {playlists.length === 0 ? (
          <p className="text-[12px] text-ink-500">{t("No playlists — create one from the Playlists page")}</p>
        ) : (
          <PlaylistCombobox
            playlists={playlists}
            value={selectedPlaylist}
            onChange={setSelectedPlaylist}
            disabled={acting}
            placeholder={t("Select a playlist…")}
            className="h-9"
          />
        )}
      </div>

      {/* Mode */}
      <div className="space-y-1.5">
        <SectionLabel>{t("Mode")}</SectionLabel>
        <div className="flex gap-2">
          {(["shuffle", "sequential"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} disabled={acting}
              className={cn("flex-1 rounded-md border py-1.5 text-[12px] transition-colors",
                mode === m ? "border-ink-300 bg-ink-800 text-ink-100 font-medium" : "border-ink-800 text-ink-500 hover:border-ink-700"
              )}>
              {m === "shuffle" ? t("Shuffle") : t("Sequential")}
            </button>
          ))}
        </div>
      </div>

      {/* Jingles & Ads */}
      <div className="space-y-2.5">
        <SectionLabel>{t("Jingles & Ads")}</SectionLabel>
        <div className="rounded-md border border-ink-800 bg-ink-950/40 p-3 space-y-3">
          <div className="space-y-1">
            <p className="text-[10.5px] uppercase tracking-wider text-ink-500 font-mono">{t("Source playlist")}</p>
            <PlaylistCombobox
              playlists={playlists}
              value={jinglePlaylistId}
              onChange={setJinglePlaylistId}
              disabled={jingleSaving}
              placeholder={t("None — disabled")}
              noneLabel={t("None — disabled")}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-[10.5px] uppercase tracking-wider text-ink-500 font-mono">{t("Every N tracks")}</p>
              <input
                type="number" min={0} max={999}
                value={jingleEveryTracks === 0 ? "" : jingleEveryTracks}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  setJingleEveryTracks(isNaN(n) ? 0 : Math.max(0, n))
                }}
                disabled={jingleSaving || !jinglePlaylistId}
                className="h-8 w-full bg-ink-950 border border-ink-800 px-2 text-[12.5px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none disabled:opacity-50"
                placeholder={t("0 = off")}
              />
            </div>
            <div className="space-y-1">
              <p className="text-[10.5px] uppercase tracking-wider text-ink-500 font-mono">{t("Every N minutes")}</p>
              <input
                type="number" min={0} max={999}
                value={jingleEveryMinutes === 0 ? "" : jingleEveryMinutes}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  setJingleEveryMinutes(isNaN(n) ? 0 : Math.max(0, n))
                }}
                disabled={jingleSaving || !jinglePlaylistId}
                className="h-8 w-full bg-ink-950 border border-ink-800 px-2 text-[12.5px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none disabled:opacity-50"
                placeholder={t("0 = off")}
              />
            </div>
          </div>

          <p className="text-[11px] text-ink-500 leading-relaxed">
            {t("Inserts one track from the source playlist whichever cadence fires first. Both counters reset after every insertion. Changes apply on next AutoDJ start.")}
          </p>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-ink-500">
              {jingleDirty ? t("Unsaved changes") : isRunning && jingleConfigured ? t("Restart AutoDJ to apply") : ""}
            </span>
            <button
              onClick={handleJingleSave}
              disabled={jingleSaving || !jingleDirty}
              className="h-8 px-3 bg-k-500 hover:bg-k-400 disabled:opacity-50 text-white text-[12.5px] font-semibold transition-colors"
            >
              {jingleSaving ? t("Saving…") : t("Save jingle settings")}
            </button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {isRunning ? (
          <>
            <button onClick={handleStop} disabled={acting}
              className="flex-1 h-9 rounded-md border border-ink-800 hover:bg-ink-800 text-ink-200 text-[13px] font-medium transition-colors disabled:opacity-50">
              {t("Stop")}
            </button>
            <button onClick={handleRestart} disabled={acting || !selectedPlaylist}
              className="flex-1 h-9 bg-k-500 hover:bg-k-400 text-white text-[13px] font-semibold transition-colors disabled:opacity-50">
              {acting ? "…" : t("Restart")}
            </button>
          </>
        ) : (
          <button onClick={handleStart} disabled={acting || !selectedPlaylist}
            className="w-full h-9 bg-k-500 hover:bg-k-400 text-white text-[13px] font-semibold transition-colors disabled:opacity-50">
            {acting ? t("Starting…") : t("Start AutoDJ")}
          </button>
        )}
      </div>
    </div>
  )
}

function MountDangerTab({ mount, onDeleted }: { mount: Mount; onDeleted: () => void }) {
  const { t } = useI18n()
  return (
    <div>
      <div className="rounded-md border border-red-500/20 bg-red-500/5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-red-400">{t("Delete Mount")}</p>
            <p className="text-[11.5px] text-ink-500 mt-0.5">{t("Permanently removes mount and disconnects all listeners.")}</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="h-8 px-3 rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-[12.5px] font-medium transition-colors shrink-0">
                {t("Delete")}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("Delete {name}?", { name: mount.name })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("This will permanently remove the mount and disconnect all listeners. Any running AutoDJ session will also be stopped.")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() =>
                  api.mounts.delete(mount.name)
                    .then(() => { toast.success(t("Mount {name} deleted", { name: mount.name })); onDeleted() })
                    .catch((err) => toast.error(t("Delete failed: {error}", { error: err.message })))
                }>{t("Delete")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  )
}

// ── Page ──

export default function MountDetailPage() {
  const params = useParams<{ name: string }>()
  const router = useRouter()
  const mountName = "/" + params.name

  const [mount, setMount]           = React.useState<Mount | null>(null)
  const [nowPlaying, setNowPlaying] = React.useState<APINowPlaying>(null)
  const [history, setHistory]       = React.useState<APIAutoDJTrackInfo[]>([])
  const [loading, setLoading]       = React.useState(true)
  const [error, setError]           = React.useState<string | null>(null)
  const { t } = useI18n()

  React.useEffect(() => {
    api.mounts.get(mountName)
      .then((m) => setMount(adaptApiMount(m)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [mountName])

  React.useEffect(() => {
    if (!mount) return
    const load = () => api.mounts.nowPlaying(mount.name).then(setNowPlaying).catch(() => {})
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [mount?.name])

  React.useEffect(() => {
    if (!mount) return
    const load = () => api.mounts.autoDJHistory(mount.name).then(setHistory).catch(() => {})
    load()
    const id = setInterval(load, 10_000)
    return () => clearInterval(id)
  }, [mount?.name])

  return (
    <div>
      {/* Back nav */}
      <button
        onClick={() => router.push("/mounts")}
        className="mb-6 inline-flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink-200 font-mono transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {t("Mounts")}
      </button>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 rounded-full border-2 border-ink-800 border-t-k-500 animate-spin" />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3 text-[12.5px] text-red-400">
          {error}
        </div>
      )}

      {mount && (
        <>
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-[24px] font-bold tracking-tight text-ink-100 font-mono">{mount.name}</h1>
                <span className={cn(
                  "text-[11px] font-mono px-2 py-0.5 rounded border",
                  mount.status === "live"  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" :
                  mount.status === "error" ? "border-red-500/30 bg-red-500/10 text-red-400" :
                  "border-ink-700 text-ink-500"
                )}>
                  {t(mount.status === "live" ? "Live" : mount.status === "error" ? "Error" : "Idle")}
                </span>
              </div>
              <p className="mt-1 text-[12.5px] text-ink-400 font-mono">
                {mount.protocol} · {mount.codec} · {mount.bitrate}
                {mount.listeners > 0 && <span className="text-emerald-400 ml-3">{t("{n} listening", { n: mount.listeners })}</span>}
              </p>
            </div>
            <PulseDot status={mount.status} />
          </div>

          {/* Tabs */}
          <Tabs defaultValue="info">
            <TabsList variant="line" className="w-full justify-start border-b border-ink-800 bg-transparent mb-6">
              <TabsTrigger value="info">{t("Info")}</TabsTrigger>
              <TabsTrigger value="autodj">AutoDJ</TabsTrigger>
              <TabsTrigger value="player">{t("Player")}</TabsTrigger>
              <TabsTrigger value="listeners">
                {t("Listeners")}
                {mount.listeners > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center h-4 px-1.5 rounded bg-ink-800 text-[10px] font-mono text-ink-300">
                    {mount.listeners}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="danger" className="text-red-400/70 data-[state=active]:text-red-400">{t("Danger")}</TabsTrigger>
            </TabsList>

            <TabsContent value="info">
              <MountInfoTab
                mount={mount}
                nowPlaying={nowPlaying}
                onRefreshNowPlaying={() => api.mounts.nowPlaying(mount.name).then(setNowPlaying).catch(() => {})}
                history={history}
                onUpdated={(patch) => setMount((m) => m ? { ...m, ...patch } : m)}
              />
            </TabsContent>
            <TabsContent value="autodj">
              <MountAutoDJTab mount={mount} />
            </TabsContent>
            <TabsContent value="player">
              <MountPlayerTab
                mount={mount}
                onUpdated={(patch) => setMount((m) => m ? { ...m, ...patch } : m)}
              />
            </TabsContent>
            <TabsContent value="listeners">
              <MountListenersTab mount={mount} />
            </TabsContent>
            <TabsContent value="danger">
              <MountDangerTab mount={mount} onDeleted={() => router.push("/mounts")} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
