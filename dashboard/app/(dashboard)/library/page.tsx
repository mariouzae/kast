"use client"

import * as React from "react"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Search,
  FolderOpen,
  Music2,
  Plus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Upload,
  Pencil,
  Trash2,
  Folder,
  Home,
  RotateCcw,
} from "lucide-react"

function YtIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  )
}
import { toast } from "sonner"
import { useI18n } from "@/lib/i18n"
import {
  api,
  type APITrack,
  type APIImportItem,
  type APIImportJob,
  type APIUploadResult,
  type APIUploadItem,
} from "@/lib/api"

// ── Types ──

type Track = {
  id:             string
  path:           string
  title:          string
  artist:         string
  album:          string
  genre:          string
  duration:       string
  durationSec:    number
  bitrate:        string
  size:           string
  folder:         string
  relFolder:      string
  dateAdded:      string
  hasOverride:    boolean
  originalTitle:  string
  originalArtist: string
  originalAlbum:  string
  originalGenre:  string
}

// ── Helpers ──

function formatMs(ms: number): string {
  const sec = Math.round(ms / 1000)
  const m   = Math.floor(sec / 60)
  const s   = sec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024)        return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / 1024 / 1024).toFixed(1) + " MB"
}

function adaptApiTrack(t: APITrack): Track {
  return {
    id:             t.id,
    path:           t.path,
    title:          t.title  || t.path.split("/").pop()?.replace(/\.[^.]+$/, "") || t.path,
    artist:         t.artist || "",
    album:          t.album  || "",
    genre:          t.genre  || "",
    duration:       formatMs(t.duration_ms),
    durationSec:    Math.round(t.duration_ms / 1000),
    bitrate:        t.bitrate_kbps ? `${t.bitrate_kbps} kbps` : "",
    size:           t.size_bytes   ? fmtBytes(t.size_bytes)   : "",
    folder:         t.folder || t.path.split("/").slice(0, -1).join("/"),
    relFolder:      t.rel_folder ?? "",
    dateAdded:      t.added_at.slice(0, 10),
    hasOverride:    !!t.has_override,
    originalTitle:  t.original_title  || "",
    originalArtist: t.original_artist || "",
    originalAlbum:  t.original_album  || "",
    originalGenre:  t.original_genre  || "",
  }
}

// ── File Upload Modal ─────────────────────────────────────────────────────────

const ALLOWED_AUDIO_EXTS = [".mp3", ".flac", ".ogg", ".wav", ".aac", ".m4a", ".opus"]

// The server rejects request bodies over 500 MB, so large selections (e.g. a
// whole folder of FLAC albums) are sent in several requests below this size.
const UPLOAD_BATCH_BYTES = 400 * 1024 * 1024
const UPLOAD_BATCH_FILES = 200

function isAudioFile(name: string) {
  return ALLOWED_AUDIO_EXTS.includes("." + name.split(".").pop()?.toLowerCase())
}

/** Splits items into batches that stay under the server's body size limit. */
function batchUploads(items: APIUploadItem[]): APIUploadItem[][] {
  const batches: APIUploadItem[][] = []
  let cur: APIUploadItem[] = []
  let curBytes = 0
  for (const it of items) {
    if (cur.length && (curBytes + it.file.size > UPLOAD_BATCH_BYTES || cur.length >= UPLOAD_BATCH_FILES)) {
      batches.push(cur); cur = []; curBytes = 0
    }
    cur.push(it); curBytes += it.file.size
  }
  if (cur.length) batches.push(cur)
  return batches
}

// Drag-and-drop folder support: dataTransfer.files does not descend into
// dropped folders, so walk the FileSystemEntry tree instead.
function readDirEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function collectEntry(entry: FileSystemEntry, out: APIUploadItem[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject))
    out.push({ file, path: entry.fullPath.replace(/^\/+/, "") })
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries returns results in chunks; call until it returns none.
    for (let chunk = await readDirEntries(reader); chunk.length; chunk = await readDirEntries(reader)) {
      for (const child of chunk) await collectEntry(child, out)
    }
  }
}

function FileUploadModal({
  open,
  onClose,
  onDone,
}: {
  open:    boolean
  onClose: () => void
  onDone:  () => void
}) {
  const [items, setItems]       = React.useState<APIUploadItem[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [results, setResults]   = React.useState<APIUploadResult["uploaded"] | null>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const folderInputEl = React.useRef<HTMLInputElement | null>(null)
  const { t, tn } = useI18n()

  const reset = () => {
    setItems([])
    setUploading(false)
    setProgress(0)
    setResults(null)
    setDragOver(false)
  }

  const handleClose = () => { reset(); onClose() }

  const addItems = (incoming: APIUploadItem[]) => {
    const filtered = incoming.filter((it) => isAudioFile(it.file.name))
    if (filtered.length === 0) {
      toast.error(t("No supported audio files selected"))
      return
    }
    const skipped = incoming.length - filtered.length
    if (skipped > 0) toast.info(tn(skipped, "Skipped {n} non-audio file", "Skipped {n} non-audio files"))
    setItems((prev) => {
      const seen = new Set(prev.map((it) => it.path + ":" + it.file.size))
      // Keep the queue (and therefore the upload order) sorted by folder/name.
      return [...prev, ...filtered.filter((it) => !seen.has(it.path + ":" + it.file.size))]
        .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }))
    })
    setResults(null)
  }

  // Files from <input>: a folder pick fills webkitRelativePath ("Album/x.mp3").
  const addFileList = (list: FileList) =>
    addItems(Array.from(list).map((file) => ({ file, path: file.webkitRelativePath || file.name })))

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    // Entries must be read synchronously, before the first await.
    const entries = Array.from(e.dataTransfer.items ?? [])
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => !!entry)
    if (entries.length === 0) {
      if (e.dataTransfer.files.length) addFileList(e.dataTransfer.files)
      return
    }
    const collected: APIUploadItem[] = []
    try {
      for (const entry of entries) await collectEntry(entry, collected)
    } catch (err) {
      toast.error(t("Could not read dropped folder: {error}", { error: err instanceof Error ? err.message : String(err) }))
    }
    if (collected.length) addItems(collected)
  }

  const handleUpload = async () => {
    if (!items.length) return
    setUploading(true)
    setProgress(0)
    const batches = batchUploads(items)
    const totalBytes = items.reduce((s, it) => s + it.file.size, 0) || 1
    let doneBytes = 0
    const all: APIUploadResult["uploaded"] = []
    try {
      for (const batch of batches) {
        const batchBytes = batch.reduce((s, it) => s + it.file.size, 0)
        const result = await api.library.upload(batch, (pct) =>
          setProgress(Math.round(((doneBytes + (batchBytes * pct) / 100) / totalBytes) * 100)))
        all.push(...result.uploaded)
        doneBytes += batchBytes
      }
    } catch (err: unknown) {
      toast.error(t("Upload failed: {error}", { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setUploading(false)
    }
    if (all.length) {
      setResults(all)
      const successes = all.filter((r) => !r.error).length
      if (successes > 0) {
        toast.success(tn(successes, "{n} file uploaded", "{n} files uploaded"))
        onDone()
      }
      const failures = all.filter((r) => r.error).length
      if (failures > 0) toast.error(tn(failures, "{n} file failed", "{n} files failed"))
    }
  }

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const folderCount = new Set(
    items.map((it) => it.path.split("/").slice(0, -1).join("/")).filter(Boolean),
  ).size

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t("Upload Audio Files")}
          </DialogTitle>
          <DialogDescription>
            {t("Supported: MP3, FLAC, OGG, WAV, AAC, M4A, Opus. Folders keep their structure in the library.")}
          </DialogDescription>
        </DialogHeader>

        {!results ? (
          <div className="space-y-3 min-w-0">
            {/* Hidden pickers — kept OUTSIDE the drop zone: input.click() dispatches
                a click that bubbles, and the drop zone's own onClick would then open
                the files picker instead of the folder picker. */}
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".mp3,.flac,.ogg,.wav,.aac,.m4a,.opus,audio/*"
              onChange={(e) => { if (e.target.files) addFileList(e.target.files); e.target.value = "" }}
              className="hidden"
            />
            <input
              // `webkitdirectory` isn't in React's input typings; set it on the DOM node.
              ref={(el) => { folderInputEl.current = el; el?.setAttribute("webkitdirectory", "") }}
              type="file"
              multiple
              onChange={(e) => { if (e.target.files) addFileList(e.target.files); e.target.value = "" }}
              className="hidden"
            />

            {/* Drop zone */}
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                dragOver ? "border-primary bg-primary/5" : ""
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">{t("Drop files or folders here")}</p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading}>
                  <Music2 className="mr-1.5 h-3.5 w-3.5" />
                  {t("Choose files")}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => folderInputEl.current?.click()} disabled={uploading}>
                  <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                  {t("Choose folder")}
                </Button>
              </div>
            </div>

            {/* File list */}
            {items.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground">
                  {tn(items.length, "{n} file", "{n} files")}
                  {folderCount > 0 && " " + tn(folderCount, "in {n} folder", "in {n} folders")}
                  {" · "}{fmtBytes(items.reduce((s, it) => s + it.file.size, 0))}
                </p>
                <div className="max-h-48 overflow-y-auto rounded border divide-y text-sm">
                  {items.map((it, i) => {
                    const slash = it.path.lastIndexOf("/")
                    return (
                      <div key={it.path + i} className="flex items-center gap-2 px-3 py-1.5 min-w-0">
                        <Music2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        {/* Folder part shrinks first so the file name stays readable. */}
                        <span className="flex flex-1 min-w-0" title={it.path}>
                          {slash >= 0 && (
                            <span className="truncate min-w-0 text-muted-foreground">{it.path.slice(0, slash + 1)}</span>
                          )}
                          <span className="truncate shrink-0 max-w-[75%]">{it.path.slice(slash + 1)}</span>
                        </span>
                        <span className="text-xs text-muted-foreground flex-shrink-0">{fmtBytes(it.file.size)}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeItem(i) }}
                          className="text-muted-foreground hover:text-destructive flex-shrink-0"
                          disabled={uploading}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* Progress */}
            {uploading && (
              <div className="space-y-1">
                <Progress value={progress} />
                <p className="text-xs text-center text-muted-foreground">
                  {t("Uploading… {pct}%", { pct: progress })}
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Results */
          <div className="max-h-64 overflow-y-auto rounded border divide-y text-sm">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2">
                {r.error
                  ? <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                  : <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />}
                <span className="flex-1 min-w-0 truncate" title={r.name}>{r.name}</span>
                {r.error && (
                  <span className="text-xs text-destructive flex-shrink-0">{r.error}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={uploading}>
            {results ? t("Close") : t("Cancel")}
          </Button>
          {!results && (
            <Button onClick={handleUpload} disabled={!items.length || uploading}>
              {uploading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("Uploading…")}</>
              ) : (
                <><Upload className="mr-2 h-4 w-4" />
                  {items.length > 0 ? tn(items.length, "Upload {n} file", "Upload {n} files") : t("Upload")}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── YouTube Import Modal ──────────────────────────────────────────────────────

type ModalStep = "input" | "preview" | "importing"

function YouTubeImportModal({
  open,
  onClose,
  onImportStarted,
}: {
  open:             boolean
  onClose:          () => void
  onImportStarted:  (jobId: string) => void
}) {
  const [step, setStep]           = React.useState<ModalStep>("input")
  const [url, setUrl]             = React.useState("")
  const [loading, setLoading]     = React.useState(false)
  const [preview, setPreview]     = React.useState<{ type: string; title: string; items: APIImportItem[] } | null>(null)
  const [selected, setSelected]   = React.useState<Set<string>>(new Set())
  const { t, tn, tx } = useI18n()

  const reset = () => {
    setStep("input")
    setUrl("")
    setLoading(false)
    setPreview(null)
    setSelected(new Set())
  }

  const handleClose = () => { reset(); onClose() }

  const handlePreview = async () => {
    if (!url.trim()) return
    setLoading(true)
    try {
      const result = await api.library.ytPreview(url.trim())
      setPreview(result)
      setSelected(new Set(result.items.map((i) => i.ytid)))
      setStep("preview")
    } catch (err: unknown) {
      toast.error(t("Preview failed: {error}", { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    if (!preview) return
    const items = preview.items.filter((i) => selected.has(i.ytid))
    if (items.length === 0) {
      toast.error(t("Select at least one track"))
      return
    }
    setStep("importing")
    try {
      const { job_id } = await api.library.ytImport({ items })
      onImportStarted(job_id)
      handleClose()
      toast.success(tn(items.length, "Importing {n} track…", "Importing {n} tracks…"))
    } catch (err: unknown) {
      toast.error(t("Import failed: {error}", { error: err instanceof Error ? err.message : String(err) }))
      setStep("preview")
    }
  }

  const toggleAll = (checked: boolean) => {
    if (!preview) return
    setSelected(checked ? new Set(preview.items.map((i) => i.ytid)) : new Set())
  }

  const toggleItem = (ytid: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(ytid) ? next.delete(ytid) : next.add(ytid)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className={`${step === "preview" && preview?.type === "playlist" ? "max-w-3xl" : "max-w-2xl"} max-h-[80vh] flex flex-col`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <YtIcon className="h-5 w-5 text-red-500" />
            {t("Import from YouTube")}
          </DialogTitle>
          <DialogDescription>
            {step === "input"
              ? t("Paste a YouTube video or playlist URL")
              : step === "preview"
              ? preview?.type === "playlist"
                ? tn(preview.items.length, "Playlist · {n} track — select which to download", "Playlist · {n} tracks — select which to download")
                : t("Video preview — confirm to download")
              : t("Starting download…")}
          </DialogDescription>
        </DialogHeader>

        {/* ── URL input step ── */}
        {step === "input" && (
          <div className="space-y-3 py-2">
            <Input
              placeholder={t("https://www.youtube.com/watch?v=… or /playlist?list=…")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePreview()}
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {tx("For personal use only. Downloading copyrighted content may violate YouTube's {terms}. Only download content you own or have permission to use.", {
                terms: (
                  <a
                    href="https://www.youtube.com/t/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {t("Terms of Service")}
                  </a>
                ),
              })}
            </p>
          </div>
        )}

        {/* ── Preview step ── */}
        {step === "preview" && preview && (
          <div className="flex flex-col gap-3 overflow-hidden">
            {preview.type === "playlist" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  id="select-all"
                  checked={selected.size === preview.items.length}
                  onCheckedChange={(v) => toggleAll(!!v)}
                />
                <label htmlFor="select-all" className="cursor-pointer">
                  {t("Select all ({selected} / {total})", { selected: selected.size, total: preview.items.length })}
                </label>
              </div>
            )}
            <div className="overflow-y-auto rounded-md border divide-y max-h-[50vh]">
              {preview.items.map((item) => (
                <div key={item.ytid} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50">
                  {preview.type === "playlist" && (
                    <Checkbox
                      checked={selected.has(item.ytid)}
                      onCheckedChange={() => toggleItem(item.ytid)}
                    />
                  )}
                  {item.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnail}
                      alt=""
                      className="h-10 w-16 rounded object-cover flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.artist}</p>
                  </div>
                  {item.duration_ms > 0 && (
                    <span className="text-xs font-mono text-muted-foreground flex-shrink-0">
                      {formatMs(item.duration_ms)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Importing step ── */}
        {step === "importing" && (
          <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{t("Starting download…")}</span>
          </div>
        )}

        <DialogFooter className="mt-auto pt-2">
          <Button variant="ghost" onClick={handleClose} disabled={loading || step === "importing"}>
            {t("Cancel")}
          </Button>
          {step === "input" && (
            <Button onClick={handlePreview} disabled={!url.trim() || loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <YtIcon className="mr-2 h-4 w-4" />}
              {loading ? t("Loading…") : t("Preview")}
            </Button>
          )}
          {step === "preview" && (
            <Button onClick={handleImport} disabled={selected.size === 0}>
              <Plus className="mr-2 h-4 w-4" />
              {tn(selected.size, "Download {n} track", "Download {n} tracks")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit Track Dialog ─────────────────────────────────────────────────────────

function EditTrackDialog({
  track,
  onClose,
  onSaved,
}: {
  track:   Track | null
  onClose: () => void
  onSaved: (updated: Track) => void
}) {
  const [title,  setTitle]  = React.useState("")
  const [artist, setArtist] = React.useState("")
  const [album,  setAlbum]  = React.useState("")
  const [genre,  setGenre]  = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const { t } = useI18n()

  React.useEffect(() => {
    if (track) {
      setTitle(track.title)
      setArtist(track.artist)
      setAlbum(track.album)
      setGenre(track.genre)
    }
  }, [track])

  const handleSave = async () => {
    if (!track) return
    setSaving(true)
    try {
      const updated = await api.library.update(track.id, { title, artist, album, genre })
      onSaved(adaptApiTrack(updated))
      toast.success(t("Track updated"))
      onClose()
    } catch (err: unknown) {
      toast.error(t("Failed to save: {error}", { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!track) return
    setSaving(true)
    try {
      const reverted = await api.library.resetOverride(track.id)
      onSaved(adaptApiTrack(reverted))
      toast.success(t("Reverted to file metadata"))
      onClose()
    } catch (err: unknown) {
      toast.error(t("Failed to reset: {error}", { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault()
      handleSave()
    }
  }

  const fields = [
    { label: "Title",  value: title,  set: setTitle,  original: track?.originalTitle  ?? "" },
    { label: "Artist", value: artist, set: setArtist, original: track?.originalArtist ?? "" },
    { label: "Album",  value: album,  set: setAlbum,  original: track?.originalAlbum  ?? "" },
    { label: "Genre",  value: genre,  set: setGenre,  original: track?.originalGenre  ?? "" },
  ] as const

  return (
    <Dialog open={!!track} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t("Edit Track")}</DialogTitle>
          <DialogDescription className="truncate text-xs font-mono">
            {track?.path.split("/").pop()}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          {fields.map(({ label, value, set, original }) => (
            <div key={label} className="grid gap-1.5">
              <label className="text-xs text-muted-foreground">{t(label)}</label>
              <Input
                value={value}
                onChange={(e) => set(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
              {track?.hasOverride && original && original !== value && (
                <p className="text-[10.5px] text-muted-foreground font-mono truncate">
                  {t("Original: {value}", { value: original })}
                </p>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          {track?.hasOverride && (
            <Button
              variant="ghost"
              onClick={handleReset}
              disabled={saving}
              className="mr-auto"
              title={t("Discard overrides and restore file's ID3 metadata")}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {t("Reset to file")}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={saving}>{t("Cancel")}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("Saving…")}</> : t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Active Jobs Panel ─────────────────────────────────────────────────────────

function JobStatusIcon({ status }: { status: string }) {
  if (status === "done")       return <CheckCircle2 className="h-4 w-4 text-green-500" />
  if (status === "error")      return <XCircle className="h-4 w-4 text-destructive" />
  if (status === "downloading") return <Loader2 className="h-4 w-4 animate-spin text-primary" />
  return <Clock className="h-4 w-4 text-muted-foreground" />
}

function ActiveJobs({ onAllDone }: { onAllDone: () => void }) {
  const [jobs, setJobs] = React.useState<APIImportJob[]>([])
  const hadJobsRef = React.useRef(false)

  React.useEffect(() => {
    const poll = async () => {
      try {
        const all = await api.library.importJobs()
        const active = all.filter((j) => j.status === "downloading" || j.status === "pending")
        setJobs(active)

        if (active.length === 0 && hadJobsRef.current) {
          hadJobsRef.current = false
          onAllDone()
        } else if (active.length > 0) {
          hadJobsRef.current = true
        }
      } catch {
        // ignore poll errors
      }
    }

    poll()
    const timer = setInterval(poll, 1500)
    return () => clearInterval(timer)
  }, [onAllDone])

  if (jobs.length === 0) return null

  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <Card key={job.id} className="border-primary/20 bg-primary/5">
          <CardContent className="p-3 space-y-2">
            {job.items.map((item) => (
              <div key={item.ytid} className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <JobStatusIcon status={item.status} />
                  <span className="flex-1 truncate font-medium">{item.title}</span>
                  {item.status === "downloading" && (
                    <span className="text-muted-foreground">{Math.round(item.progress)}%</span>
                  )}
                </div>
                {item.status === "downloading" && (
                  <Progress value={item.progress} className="h-1" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export default function LibraryPage() {
  const [tracks, setTracks]           = React.useState<Track[]>([])
  const [loading, setLoading]         = React.useState(true)
  const [scanning, setScanning]       = React.useState(false)
  const [search, setSearch]           = React.useState("")
  const [genreFilter, setGenreFilter] = React.useState("all")
  const [page, setPage]               = React.useState(1)
  const [editTrack, setEditTrack]     = React.useState<Track | null>(null)
  const [deleteTrack, setDeleteTrack] = React.useState<Track | null>(null)
  const [currentFolder, setCurrentFolder] = React.useState("") // "" = library root
  const [deleteFolder, setDeleteFolder]   = React.useState<{ name: string; path: string; count: number } | null>(null)
  // Multi-select: keys are "t:<track id>" and "f:<rel folder>".
  const [selection, setSelection]         = React.useState<Set<string>>(new Set())
  const { t, tn, tx } = useI18n()
  // Suffix for delete toasts, e.g. " — removed from 2 playlists".
  const removedFrom = (n: number) =>
    n > 0 ? tn(n, " — removed from {n} playlist", " — removed from {n} playlists") : ""
  const [bulkConfirm, setBulkConfirm]     = React.useState(false)
  const [deleting, setDeleting]       = React.useState(false)
  const [ytOpen, setYtOpen]             = React.useState(false)
  const [uploadOpen, setUploadOpen]     = React.useState(false)

  const genres = React.useMemo(
    () => [...new Set(tracks.map((tk) => tk.genre))].filter(Boolean).sort(),
    [tracks],
  )

  const loadTracks = React.useCallback(() => {
    setLoading(true)
    api.library.list()
      .then((ts) => setTracks(ts.map(adaptApiTrack)))
      .catch((err) => toast.error(t("Failed to load library: {error}", { error: err.message })))
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => { loadTracks() }, [loadTracks])

  const handleDelete = () => {
    if (!deleteTrack) return
    const target = deleteTrack
    setDeleting(true)
    api.library.delete(target.id)
      .then(({ playlists_updated }) => {
        setTracks((prev) => prev.filter((tk) => tk.id !== target.id))
        toast.success(t("Deleted \"{name}\"", { name: target.title }) + removedFrom(playlists_updated))
        setDeleteTrack(null)
      })
      .catch((err) => toast.error(t("Delete failed: {error}", { error: err.message })))
      .finally(() => setDeleting(false))
  }

  const handleBulkDelete = () => {
    const folders  = selectedFolders.map((f) => f.path)
    const trackIds = selectedTracks.map((tk) => tk.id)
    if (!folders.length && !trackIds.length) return
    setDeleting(true)
    api.library.deleteMany({ track_ids: trackIds, folders })
      .then(({ deleted_tracks, deleted_folders, playlists_updated, failed }) => {
        const failedItems = new Set(failed.map((f) => f.item))
        const goneFolders = folders.filter((f) => !failedItems.has(f))
        const goneIds     = new Set(trackIds.filter((id) => !failedItems.has(id)))
        const inGone = (t: Track) => goneFolders.some((f) => t.relFolder === f || t.relFolder.startsWith(f + "/"))
        setTracks((prev) => prev.filter((tk) => !goneIds.has(tk.id) && !inGone(tk)))
        const what = deleted_folders
          ? t("{tracks} and {folders}", {
              tracks:  tn(deleted_tracks, "{n} track", "{n} tracks"),
              folders: tn(deleted_folders, "{n} folder", "{n} folders"),
            })
          : tn(deleted_tracks, "{n} track", "{n} tracks")
        toast.success(t("Deleted {what}", { what }) + removedFrom(playlists_updated))
        if (failed.length) toast.error(tn(failed.length, "{n} item could not be deleted", "{n} items could not be deleted"))
        setSelection(new Set())
        setBulkConfirm(false)
      })
      .catch((err) => toast.error(t("Delete failed: {error}", { error: err.message })))
      .finally(() => setDeleting(false))
  }

  const handleDeleteFolder = () => {
    if (!deleteFolder) return
    const target = deleteFolder
    setDeleting(true)
    api.library.deleteFolder(target.path)
      .then(({ deleted_tracks, playlists_updated }) => {
        const inside = (t: Track) => t.relFolder === target.path || t.relFolder.startsWith(target.path + "/")
        setTracks((prev) => prev.filter((tk) => !inside(tk)))
        toast.success(
          t("Deleted folder \"{name}\" ({tracks})", { name: target.name, tracks: tn(deleted_tracks, "{n} track", "{n} tracks") }) +
          removedFrom(playlists_updated),
        )
        setDeleteFolder(null)
      })
      .catch((err) => toast.error(t("Delete failed: {error}", { error: err.message })))
      .finally(() => setDeleting(false))
  }

  const handleScan = () => {
    setScanning(true)
    api.library.scan()
      .then(() => {
        toast.success(t("Scan started — refreshing in 3s"))
        setTimeout(() => {
          loadTracks()
          setScanning(false)
        }, 3000)
      })
      .catch((err) => {
        toast.error(t("Scan failed: {error}", { error: err.message }))
        setScanning(false)
      })
  }

  const handleImportStarted = () => {
    // ActiveJobs polls automatically — no need to track job IDs manually
  }

  const handleAllJobsDone = React.useCallback(() => {
    setTimeout(() => {
      loadTracks()
    }, 1500)
  }, [loadTracks])

  // ── Folder navigation ──
  // Tracks under the current folder (recursively). Browsing shows only its
  // direct subfolders and tracks; searching/filtering lists every match below it.
  const hasFolders = tracks.some((tk) => tk.relFolder !== "")
  const inScope = (t: Track) =>
    currentFolder === "" || t.relFolder === currentFolder || t.relFolder.startsWith(currentFolder + "/")
  const scoped    = tracks.filter(inScope)
  const filtering = search !== "" || genreFilter !== "all"

  const filtered = scoped.filter((t) => {
    if (search && ![t.title, t.artist, t.album].some((f) => f.toLowerCase().includes(search.toLowerCase()))) return false
    if (genreFilter !== "all" && t.genre !== genreFilter) return false
    return true
  })

  type FolderEntry = { name: string; path: string; count: number; durationSec: number }
  const subfolders: FolderEntry[] = React.useMemo(() => {
    if (filtering) return []
    const byName = new Map<string, FolderEntry>()
    const prefix = currentFolder === "" ? "" : currentFolder + "/"
    for (const t of scoped) {
      if (t.relFolder === currentFolder) continue
      const name = t.relFolder.slice(prefix.length).split("/")[0]
      const e = byName.get(name) ?? { name, path: prefix + name, count: 0, durationSec: 0 }
      e.count++; e.durationSec += t.durationSec
      byName.set(name, e)
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, currentFolder, filtering])

  const listedTracks = filtering ? filtered : filtered.filter((tk) => tk.relFolder === currentFolder)
  type Entry = { kind: "folder"; folder: FolderEntry } | { kind: "track"; track: Track; n: number }
  const entries: Entry[] = [
    ...subfolders.map((folder) => ({ kind: "folder" as const, folder })),
    ...listedTracks.map((track, i) => ({ kind: "track" as const, track, n: i + 1 })),
  ]

  const openFolder = (path: string) => { setCurrentFolder(path); setSearch(""); setGenreFilter("all") }

  // If the current folder disappears (e.g. its last track was deleted), go up.
  React.useEffect(() => {
    if (!loading && currentFolder !== "" && scoped.length === 0) {
      setCurrentFolder(currentFolder.split("/").slice(0, -1).join("/"))
    }
  }, [loading, currentFolder, scoped.length])

  React.useEffect(() => { setPage(1) }, [search, genreFilter, currentFolder])
  // Selection applies to what's on screen; drop it when the view changes.
  React.useEffect(() => { setSelection(new Set()) }, [search, genreFilter, currentFolder])

  const entryKey = (e: Entry) => e.kind === "folder" ? "f:" + e.folder.path : "t:" + e.track.id
  const toggleSelect = (key: string) =>
    setSelection((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  const selectedCount = entries.filter((e) => selection.has(entryKey(e))).length
  const allSelected   = entries.length > 0 && selectedCount === entries.length
  const toggleSelectAll = () =>
    setSelection(allSelected ? new Set() : new Set(entries.map(entryKey)))
  const selectedFolders = subfolders.filter((f) => selection.has("f:" + f.path))
  const selectedTracks  = listedTracks.filter((tk) => selection.has("t:" + tk.id))
  // Tracks that will go: those in selected folders plus individually selected ones.
  const bulkTrackCount  = selectedFolders.reduce((n, f) => n + f.count, 0) + selectedTracks.length

  const totalPages = Math.ceil(entries.length / PAGE_SIZE)
  const paginated  = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const totalDuration = filtered.reduce((sum, t) => sum + t.durationSec, 0)
  const fmtTotal = (sec: number) => {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-ink-100">{t("Library")}</h1>
          <p className="text-[12.5px] text-ink-400 mt-1">{t("Music files available for playlists and AutoDJ")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleScan} disabled={scanning}>
            <FolderOpen className="mr-1.5 h-4 w-4" />
            {scanning ? t("Scanning…") : t("Scan Folder")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="mr-1.5 h-4 w-4" />
                {t("Add Music")}
                <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setUploadOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                {t("Upload Files")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setYtOpen(true)}>
                <YtIcon className="mr-2 h-4 w-4 text-red-500" />
                {t("Import from YouTube")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Active download jobs */}
      <ActiveJobs onAllDone={handleAllJobsDone} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("Search title, artist, album…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={genreFilter} onValueChange={setGenreFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder={t("Genre")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All Genres")}</SelectItem>
            {genres.map((g) => (
              <SelectItem key={g} value={g}>{g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="px-2.5 py-1 text-xs">
          {tn(filtered.length, "{n} track", "{n} tracks")} · {fmtTotal(totalDuration)}
        </Badge>
      </div>

      {/* Bulk actions */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 border border-k-500/30 bg-k-500/5 px-3 py-2 text-[12.5px] -mt-2">
          <span className="text-ink-200 font-medium">
            {t("{n} selected", { n: selectedCount })}
          </span>
          <span className="text-ink-500">
            {selectedFolders.length > 0 && tn(selectedFolders.length, "{n} folder", "{n} folders") + ", "}
            {tn(bulkTrackCount, "{n} track in total", "{n} tracks in total")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelection(new Set())}>
              {t("Clear")}
            </Button>
            <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={() => setBulkConfirm(true)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t("Delete selected")}
            </Button>
          </div>
        </div>
      )}

      {/* Folder breadcrumb */}
      {hasFolders && (
        <nav aria-label={t("Folder")} className="flex flex-wrap items-center gap-1 text-[12.5px] -mt-2">
          <button
            onClick={() => openFolder("")}
            className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 transition-colors ${
              currentFolder === "" ? "text-ink-100 font-medium" : "text-ink-400 hover:text-ink-100"
            }`}
          >
            <Home className="h-3.5 w-3.5" />
            {t("Library")}
          </button>
          {currentFolder !== "" && currentFolder.split("/").map((seg, i, segs) => {
            const path = segs.slice(0, i + 1).join("/")
            const last = i === segs.length - 1
            return (
              <React.Fragment key={path}>
                <ChevronRight className="h-3.5 w-3.5 text-ink-600" />
                <button
                  onClick={() => openFolder(path)}
                  aria-current={last ? "page" : undefined}
                  className={`px-1.5 py-0.5 transition-colors ${
                    last ? "text-ink-100 font-medium" : "text-ink-400 hover:text-ink-100"
                  }`}
                >
                  {seg}
                </button>
              </React.Fragment>
            )
          })}
        </nav>
      )}

      <div className="border-t border-ink-800">
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <Music2 className="h-10 w-10 opacity-20 animate-pulse" />
              <p className="text-sm">{t("Loading library…")}</p>
            </div>
          ) : tracks.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Music2 className="h-12 w-12 opacity-20" />
              <p className="text-sm">{t("No tracks in library")}</p>
              <p className="text-xs text-center">
                {tx("Upload audio files directly, or drop them into {path} and click Scan.", {
                  path: <code className="rounded bg-muted px-1.5 py-0.5">server/data/music/</code>,
                })}
              </p>
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <Button size="sm" onClick={() => setUploadOpen(true)}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  {t("Upload Files")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setYtOpen(true)}>
                  <YtIcon className="mr-1.5 h-3.5 w-3.5" />
                  {t("Import from YouTube")}
                </Button>
                <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning}>
                  <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                  {scanning ? t("Scanning…") : t("Scan Folder")}
                </Button>
              </div>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <Music2 className="h-10 w-10 opacity-20" />
              <p className="text-sm">{filtering ? t("No tracks match your filters") : t("This folder is empty")}</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        aria-label={t("Select all")}
                        checked={allSelected ? true : selectedCount > 0 ? "indeterminate" : false}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>{t("Title")}</TableHead>
                    <TableHead>{t("Artist")}</TableHead>
                    <TableHead>{t("Album")}</TableHead>
                    <TableHead>{t("Genre")}</TableHead>
                    <TableHead>{t("Duration")}</TableHead>
                    <TableHead>{t("Bitrate")}</TableHead>
                    <TableHead>{t("Size")}</TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((entry) => entry.kind === "folder" ? (
                    <TableRow
                      key={"dir:" + entry.folder.path}
                      className="group cursor-pointer"
                      onClick={() => openFolder(entry.folder.path)}
                      data-state={selection.has("f:" + entry.folder.path) ? "selected" : undefined}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={t("Select folder {name}", { name: entry.folder.name })}
                          checked={selection.has("f:" + entry.folder.path)}
                          onCheckedChange={() => toggleSelect("f:" + entry.folder.path)}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <Folder className="h-3.5 w-3.5 text-k-500" />
                      </TableCell>
                      <TableCell className="font-medium max-w-[180px] truncate">
                        <button
                          onClick={(e) => { e.stopPropagation(); openFolder(entry.folder.path) }}
                          className="truncate hover:underline text-left"
                        >
                          {entry.folder.name}
                        </button>
                      </TableCell>
                      <TableCell colSpan={6} className="text-xs text-muted-foreground">
                        {tn(entry.folder.count, "{n} track", "{n} tracks")} · {fmtTotal(entry.folder.durationSec)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteFolder(entry.folder) }}
                            className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-red-400"
                            title={t("Delete folder")}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (() => {
                    const { track, n } = entry
                    return (
                    <TableRow
                      key={track.path}
                      className="group"
                      data-state={selection.has("t:" + track.id) ? "selected" : undefined}
                    >
                      <TableCell>
                        <Checkbox
                          aria-label={t("Select {name}", { name: track.title })}
                          checked={selection.has("t:" + track.id)}
                          onCheckedChange={() => toggleSelect("t:" + track.id)}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{n}</TableCell>
                      <TableCell className="font-medium max-w-[180px]">
                        <div className="truncate">{track.title}</div>
                        {filtering && hasFolders && track.relFolder !== currentFolder && (
                          <div className="truncate text-[11px] font-normal text-muted-foreground" title={track.relFolder}>
                            {track.relFolder.slice(currentFolder ? currentFolder.length + 1 : 0)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate">{track.artist || <span className="text-muted-foreground/40">—</span>}</TableCell>
                      <TableCell className="text-xs max-w-[120px] truncate text-muted-foreground">{track.album || "—"}</TableCell>
                      <TableCell>
                        {track.genre ? <Badge variant="outline" className="text-[10px]">{track.genre}</Badge> : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{track.duration}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{track.bitrate || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{track.size || "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={() => setEditTrack(track)}
                            className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-ink-100"
                            title={t("Edit metadata")}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => setDeleteTrack(track)}
                            className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-red-400"
                            title={t("Delete from library")}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                    )
                  })())}
                </TableBody>
              </Table>
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-ink-800 px-2 py-3">
                  <span className="text-xs text-muted-foreground">
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, entries.length)} / {entries.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setPage((p) => p - 1)}
                      disabled={page === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground tabular-nums px-1">
                      {page} / {totalPages}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page === totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
      </div>

      <FileUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onDone={() => setTimeout(loadTracks, 1500)}
      />

      <YouTubeImportModal
        open={ytOpen}
        onClose={() => setYtOpen(false)}
        onImportStarted={handleImportStarted}
      />

      <EditTrackDialog
        track={editTrack}
        onClose={() => setEditTrack(null)}
        onSaved={(updated) => setTracks((prev) => prev.map((tk) => tk.id === updated.id ? updated : tk))}
      />

      <AlertDialog open={bulkConfirm} onOpenChange={(v) => !v && !deleting && setBulkConfirm(false)}>
        <AlertDialogContent className="bg-ink-950 border-ink-800 text-ink-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px]">{tn(selectedCount, "Delete {n} selected item?", "Delete {n} selected items?")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-ink-400 text-[12.5px] space-y-2">
                <ul className="max-h-40 overflow-y-auto border border-ink-800 divide-y divide-ink-800">
                  {selectedFolders.map((f) => (
                    <li key={"f:" + f.path} className="flex items-center gap-2 px-2 py-1">
                      <Folder className="h-3 w-3 text-k-500 shrink-0" />
                      <span className="truncate text-ink-200">{f.name}</span>
                      <span className="ml-auto shrink-0 text-ink-500">{tn(f.count, "{n} track", "{n} tracks")}</span>
                    </li>
                  ))}
                  {selectedTracks.map((tk) => (
                    <li key={"t:" + tk.id} className="flex items-center gap-2 px-2 py-1">
                      <Music2 className="h-3 w-3 text-ink-500 shrink-0" />
                      <span className="truncate text-ink-200">{tk.title}</span>
                      {tk.artist && <span className="ml-auto shrink-0 truncate max-w-[40%] text-ink-500">{tk.artist}</span>}
                    </li>
                  ))}
                </ul>
                <p>
                  {tn(bulkTrackCount,
                    "{n} track in total will be permanently deleted from the server and removed from every playlist that uses it. This cannot be undone.",
                    "{n} tracks in total will be permanently deleted from the server and removed from every playlist that uses them. This cannot be undone.")}
                  {selectedFolders.length > 0 && " " + t("Selected folders are deleted with everything inside them.")}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="bg-transparent border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-ink-100 text-[12.5px]"
            >
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleBulkDelete() }}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700 text-[12.5px] flex items-center gap-1.5"
            >
              {deleting
                ? <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                : <Trash2 className="h-3.5 w-3.5" />}
              {tn(selectedCount, "Delete {n} item", "Delete {n} items")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteFolder} onOpenChange={(v) => !v && !deleting && setDeleteFolder(null)}>
        <AlertDialogContent className="bg-ink-950 border-ink-800 text-ink-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px]">{t("Delete folder?")}</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-400 text-[12.5px]">
              <span className="font-medium text-ink-200">{deleteFolder?.path}</span>
              <br />
              {tn(deleteFolder?.count ?? 0, "{n} track, including subfolders.", "{n} tracks, including subfolders.")}
              <br /><br />
              {tx("The folder and {everything} (subfolders and any other files, such as cover images) are permanently deleted from the server, and its tracks are removed from every playlist that uses them. This cannot be undone.", {
                everything: <span className="text-ink-200">{t("everything inside it")}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="bg-transparent border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-ink-100 text-[12.5px]"
            >
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteFolder() }}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700 text-[12.5px] flex items-center gap-1.5"
            >
              {deleting
                ? <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                : <Trash2 className="h-3.5 w-3.5" />}
              {t("Delete folder")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTrack} onOpenChange={(v) => !v && !deleting && setDeleteTrack(null)}>
        <AlertDialogContent className="bg-ink-950 border-ink-800 text-ink-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px]">{t("Delete track?")}</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-400 text-[12.5px]">
              <span className="font-medium text-ink-200">{deleteTrack?.title}</span>
              {deleteTrack?.artist && <> — {deleteTrack.artist}</>}
              <br />
              <span className="font-mono text-[11px] text-ink-500 break-all">{deleteTrack?.path}</span>
              <br /><br />
              {t("The audio file is permanently deleted from the server and the track is removed from every playlist that uses it. This cannot be undone.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="bg-transparent border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-ink-100 text-[12.5px]"
            >
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete() }}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700 text-[12.5px] flex items-center gap-1.5"
            >
              {deleting
                ? <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                : <Trash2 className="h-3.5 w-3.5" />}
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
