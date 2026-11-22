"use client"

import * as React from "react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Plus, ListMusic, Trash2, Search, Check, Play, GripVertical,
  Loader2, CheckCircle2, XCircle,
  ChevronRight, ChevronDown, Folder, FolderOpen, Minus, Music,
} from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import {
  api, type APIPlaylist, type APIMount, type APITrack, type APIAutoDJSession,
  type APIImportItem, type APIImportJob,
} from "@/lib/api"

// ── Types ──

type PlayMode = "sequential" | "shuffle"

type Track = {
  path: string; title: string; artist: string; album: string
  genre: string; duration: string; durationSec: number; folder: string
  relFolder: string // folder relative to the library root, "" = top level
}

type Playlist = {
  id: string; name: string; mode: PlayMode; assignedMount: string
  autoDJ: boolean; crossfade: number; trackPaths: string[]
}

// ── Helpers ──

function formatMs(ms: number): string {
  const sec = Math.round(ms / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`
}

function totalDurationLabel(paths: string[], byPath: Map<string, Track>): string {
  const sec = paths.reduce((sum, p) => sum + (byPath.get(p)?.durationSec ?? 0), 0)
  if (sec === 0) return ""
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}`
}

function adaptApiTrack(t: APITrack): Track {
  return {
    path: t.path,
    title: t.title || t.path.split("/").pop()?.replace(/\.[^.]+$/, "") || t.path,
    artist: t.artist || "Unknown",
    album: t.album || "",
    genre: t.genre || "",
    duration: formatMs(t.duration_ms),
    durationSec: Math.round(t.duration_ms / 1000),
    folder: t.folder || "",
    relFolder: t.rel_folder ?? "",
  }
}

function adaptApiPlaylist(p: APIPlaylist): Playlist {
  return {
    id: p.id, name: p.name,
    mode: p.mode === "shuffle" ? "shuffle" : "sequential",
    assignedMount: "", autoDJ: false,
    crossfade: p.crossfade_ms,
    trackPaths: p.track_paths ?? [],
  }
}

function applySessionsToPlaylists(playlists: Playlist[], sessions: APIAutoDJSession[]): Playlist[] {
  const activeMap = new Map(sessions.map((s) => [s.playlist_id, s.mount]))
  return playlists.map((pl) => {
    const mount = activeMap.get(pl.id)
    if (mount) return { ...pl, assignedMount: mount, autoDJ: true }
    if (pl.autoDJ && pl.assignedMount) return { ...pl, autoDJ: false }
    return pl
  })
}

// ── Folder tree helpers ──

type FolderNode = {
  name: string
  fullPath: string
  children: FolderNode[]
  directTracks: Track[]
  allTracks: Track[]   // recursive
}

// buildFolderTree returns a single root node for the library folder (e.g.
// "music") holding its subfolders and top-level tracks. Folders come from the
// server's rel_folder (path relative to the library root), so top-level tracks
// and a lone top folder are never dropped. Node fullPath = rel path ("" = root).
function buildFolderTree(tracks: Track[]): FolderNode[] {
  if (tracks.length === 0) return []

  // Name the root after the library folder: a track's absolute folder minus
  // its rel_folder suffix is the library root path.
  const sample   = tracks[0]
  const rootAbs  = sample.relFolder && sample.folder.endsWith("/" + sample.relFolder)
    ? sample.folder.slice(0, -(sample.relFolder.length + 1))
    : sample.folder
  const rootName = rootAbs.split("/").filter(Boolean).pop() || "Library"

  const root: FolderNode = { name: rootName, fullPath: "", children: [], directTracks: [], allTracks: [] }
  const nodes = new Map<string, FolderNode>([["", root]])

  const getOrCreate = (rel: string): FolderNode => {
    const hit = nodes.get(rel)
    if (hit) return hit
    const slash  = rel.lastIndexOf("/")
    const parent = getOrCreate(slash > 0 ? rel.slice(0, slash) : "")
    const node: FolderNode = { name: rel.slice(slash + 1), fullPath: rel, children: [], directTracks: [], allTracks: [] }
    parent.children.push(node)
    nodes.set(rel, node)
    return node
  }

  for (const track of tracks) getOrCreate(track.relFolder).directTracks.push(track)

  const computeAll = (node: FolderNode): Track[] => {
    node.allTracks = [...node.directTracks]
    for (const c of node.children) node.allTracks.push(...computeAll(c))
    return node.allTracks
  }
  const sortNode = (node: FolderNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }))
    node.directTracks.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }))
    node.children.forEach(sortNode)
  }
  computeAll(root)
  sortNode(root)
  return [root]
}

// ── Tree row components ──

// Checkbox used by the Add Tracks tree. "locked" = already in the playlist.
function CheckBox({ state }: { state: "none" | "some" | "all" | "locked" }) {
  return (
    <div className={cn(
      "flex h-4 w-4 shrink-0 items-center justify-center border transition-colors",
      state === "all"    ? "border-k-500 bg-k-500" :
      state === "some"   ? "border-k-500/60 bg-k-500/20" :
      state === "locked" ? "border-ink-600 bg-ink-700" :
      "border-ink-700",
    )}>
      {(state === "all" || state === "locked") && <Check className={cn("h-2.5 w-2.5", state === "all" ? "text-white" : "text-ink-400")} />}
      {state === "some" && <Minus className="h-2.5 w-2.5 text-k-400" />}
    </div>
  )
}

function TrackLeaf({ track, selected, inPlaylist, onToggle, depth }: {
  track: Track; selected: boolean; inPlaylist: boolean; onToggle: () => void; depth: number
}) {
  const { t } = useI18n()
  return (
    <div
      onClick={inPlaylist ? undefined : onToggle}
      className={cn(
        "flex items-center gap-2 py-1.5 pr-3 transition-colors",
        inPlaylist ? "cursor-default" : "cursor-pointer hover:bg-ink-100/[0.03]",
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      title={inPlaylist ? t("Already in this playlist") : undefined}
    >
      <div className="h-4 w-4 shrink-0" /> {/* align with folder expand btn */}
      <CheckBox state={inPlaylist ? "locked" : selected ? "all" : "none"} />
      <Music className="h-3 w-3 text-ink-700 shrink-0" />
      <div className="min-w-0 flex-1 flex items-baseline gap-2">
        <span className={cn("text-[12.5px] truncate", inPlaylist ? "text-ink-500" : "text-ink-200")}>{track.title}</span>
        <span className="text-[11px] text-ink-600 truncate max-w-[100px] shrink-0">{track.artist}</span>
        {inPlaylist && <span className="text-[10.5px] font-mono text-ink-600 shrink-0">{t("in playlist")}</span>}
      </div>
      <span className="font-mono text-[11px] text-ink-600 shrink-0">{track.duration}</span>
    </div>
  )
}

function FolderRow({ node, selected, existing, expanded, onToggleExpand, onToggleFolder, onToggleTrack, depth }: {
  node: FolderNode
  selected: Set<string>; existing: Set<string>; expanded: Set<string>
  onToggleExpand: (p: string) => void
  onToggleFolder: (n: FolderNode) => void
  onToggleTrack:  (p: string) => void
  depth: number
}) {
  const isExpanded = expanded.has(node.fullPath)
  const { t } = useI18n()
  const addable     = node.allTracks.filter((t) => !existing.has(t.path))
  const selCount    = addable.filter((t) => selected.has(t.path)).length
  const checkState  =
    addable.length === 0          ? "locked" :
    selCount === 0                ? "none"   :
    selCount === addable.length   ? "all"    : "some"

  return (
    <>
      <div
        className="flex items-center gap-2 py-1.5 pr-3 hover:bg-ink-100/[0.03] transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Expand toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand(node.fullPath) }}
          className="h-4 w-4 shrink-0 flex items-center justify-center text-ink-600 hover:text-ink-400 transition-colors"
        >
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>

        {/* Tri-state checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFolder(node) }}
          disabled={checkState === "locked"}
          title={checkState === "locked" ? t("All tracks already in this playlist") : undefined}
          className="shrink-0 disabled:cursor-default"
        >
          <CheckBox state={checkState} />
        </button>

        {/* Folder icon + name + count — click expands */}
        <button
          onClick={() => onToggleExpand(node.fullPath)}
          className="flex items-center gap-2 min-w-0 flex-1"
        >
          {isExpanded
            ? <FolderOpen className="h-3.5 w-3.5 text-ink-500 shrink-0" />
            : <Folder     className="h-3.5 w-3.5 text-ink-600 shrink-0" />
          }
          <span className="text-[13px] text-ink-100 font-medium truncate text-left flex-1">{node.name}</span>
          <span className="font-mono text-[11px] text-ink-600 shrink-0">
            {addable.length < node.allTracks.length
              ? t("{have}/{total} in playlist", { have: node.allTracks.length - addable.length, total: node.allTracks.length })
              : node.allTracks.length}
          </span>
        </button>
      </div>

      {isExpanded && (
        <>
          {node.children.map((child) => (
            <FolderRow key={child.fullPath} node={child}
              selected={selected} existing={existing} expanded={expanded}
              onToggleExpand={onToggleExpand}
              onToggleFolder={onToggleFolder}
              onToggleTrack={onToggleTrack}
              depth={depth + 1}
            />
          ))}
          {node.directTracks.map((track) => (
            <TrackLeaf key={track.path} track={track}
              selected={selected.has(track.path)}
              inPlaylist={existing.has(track.path)}
              onToggle={() => onToggleTrack(track.path)}
              depth={depth + 1}
            />
          ))}
        </>
      )}
    </>
  )
}

// ── Add Tracks Dialog ──

function AddTracksDialog({ open, onOpenChange, library, existingPaths, onAdd }: {
  open: boolean; onOpenChange: (v: boolean) => void
  library: Track[]; existingPaths: string[]; onAdd: (paths: string[]) => void
}) {
  const [search, setSearch]   = React.useState("")
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const { t, tn } = useI18n()

  // Show the whole library; tracks already in the playlist are marked and
  // can't be selected (hiding them made the library look incomplete).
  const existing = React.useMemo(() => new Set(existingPaths), [existingPaths])
  const tree = React.useMemo(() => buildFolderTree(library), [library])

  // Expand the library root when the tree is first built so its folders show.
  React.useEffect(() => {
    setExpanded(new Set(tree.map((n) => n.fullPath)))
  }, [tree])

  // Flat search results (null = no search active)
  const searchResult = React.useMemo(() => {
    if (!search) return null
    const q = search.toLowerCase()
    return library.filter((t) =>
      [t.title, t.artist, t.album].some((f) => f.toLowerCase().includes(q))
    )
  }, [library, search])

  const toggleTrack  = (path: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n })

  const toggleFolder = (node: FolderNode) =>
    setSelected((prev) => {
      const n = new Set(prev)
      const addable = node.allTracks.filter((t) => !existing.has(t.path))
      const allSel  = addable.every((t) => n.has(t.path))
      allSel ? addable.forEach((t) => n.delete(t.path)) : addable.forEach((t) => n.add(t.path))
      return n
    })

  const toggleExpand = (path: string) =>
    setExpanded((prev) => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n })

  const searchAddable = searchResult?.filter((t) => !existing.has(t.path)) ?? []
  const searchAllSel  = searchAddable.length > 0 && searchAddable.every((t) => selected.has(t.path))
  const toggleSearchAll = () =>
    setSelected((prev) => {
      const n = new Set(prev)
      searchAllSel ? searchAddable.forEach((t) => n.delete(t.path)) : searchAddable.forEach((t) => n.add(t.path))
      return n
    })

  const handleAdd = () => {
    // Add in library order (folder, then file name — sorted by the server),
    // not in the order the boxes were clicked, so sequential playback follows
    // the file-system order.
    const paths = library.filter((t) => selected.has(t.path)).map((t) => t.path)
    onAdd(paths); setSelected(new Set()); setSearch(""); onOpenChange(false)
    toast.success(tn(paths.length, "{n} track added", "{n} tracks added"))
  }
  const handleClose = () => { setSelected(new Set()); setSearch(""); onOpenChange(false) }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 bg-ink-900 border-ink-800 flex flex-col overflow-hidden max-h-[82vh]">

        {/* Header */}
        <DialogHeader className="shrink-0 px-5 pt-5 pb-4 border-b border-ink-800">
          <DialogTitle className="text-ink-100">{t("Add Tracks")}</DialogTitle>
          <DialogDescription className="text-ink-500">
            {selected.size > 0
              ? tn(selected.size, "{n} track selected", "{n} tracks selected")
              : existing.size > 0
                ? t("Select folders or tracks to add. {n} already in this playlist.", { n: existing.size })
                : t("Select folders or individual tracks to add.")}
          </DialogDescription>
        </DialogHeader>

        {/* Search bar */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-ink-800">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500 h-3.5 w-3.5" />
            <input
              className="h-8 w-full bg-ink-950 border border-ink-800 pl-8 pr-3 text-[12px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none"
              placeholder={t("Search tracks…")}
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {searchAddable.length > 0 && (
            <button
              onClick={toggleSearchAll}
              className="flex items-center gap-1.5 shrink-0 text-[12px] text-ink-400 hover:text-ink-200 transition-colors"
            >
              <div className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center border",
                searchAllSel ? "border-k-500 bg-k-500" : "border-ink-700",
              )}>
                {searchAllSel && <Check className="h-2.5 w-2.5 text-white" />}
              </div>
              <span>{t("All")}</span>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {library.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-ink-500">{t("Library is empty. Scan from the Library page first.")}</p>
          ) : searchResult !== null ? (
            searchResult.length === 0 ? (
              <p className="py-8 text-center text-[12px] text-ink-500">{t("No tracks found")}</p>
            ) : (
              searchResult.map((track) => {
                const inPlaylist = existing.has(track.path)
                return (
                <div key={track.path} onClick={inPlaylist ? undefined : () => toggleTrack(track.path)}
                  title={inPlaylist ? t("Already in this playlist") : undefined}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 border-b border-ink-800/60 last:border-0 transition-colors",
                    inPlaylist ? "cursor-default" : "cursor-pointer hover:bg-ink-100/[0.03]",
                  )}
                >
                  <CheckBox state={inPlaylist ? "locked" : selected.has(track.path) ? "all" : "none"} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[12.5px] truncate font-medium", inPlaylist ? "text-ink-500" : "text-ink-100")}>{track.title}</p>
                    <p className="text-[11px] text-ink-500 truncate">
                      {track.artist}
                      {track.relFolder && <span className="text-ink-600"> · {track.relFolder}</span>}
                      {inPlaylist && <span className="font-mono text-ink-600"> · {t("in playlist")}</span>}
                    </p>
                  </div>
                  <span className="text-[11px] text-ink-500 font-mono shrink-0">{track.duration}</span>
                </div>
                )
              })
            )
          ) : tree.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-ink-500">{t("No tracks available")}</p>
          ) : (
            tree.map((node) => (
              <FolderRow key={node.fullPath} node={node}
                selected={selected} existing={existing} expanded={expanded}
                onToggleExpand={toggleExpand}
                onToggleFolder={toggleFolder}
                onToggleTrack={toggleTrack}
                depth={0}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="shrink-0 px-5 py-4 border-t border-ink-800">
          <button onClick={handleClose}
            className="h-9 px-4 border border-ink-800 hover:bg-ink-800 text-[13px] text-ink-200 transition-colors">
            {t("Cancel")}
          </button>
          <button onClick={handleAdd} disabled={selected.size === 0}
            className="h-9 px-4 bg-k-500 hover:bg-k-400 disabled:opacity-50 text-white text-[13px] font-semibold transition-colors">
            {selected.size > 0 ? t("Add ({n})", { n: selected.size }) : t("Add")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Track Row ──

function TrackRow({ track, index, onRemove, selected, onToggleSelect,
  isDragging, isDragOver, onDragStart, onDragEnd, onDragOver, onDrop,
}: {
  track: Track; index: number
  onRemove: () => void
  selected: boolean; onToggleSelect: (shiftKey: boolean) => void
  isDragging: boolean; isDragOver: boolean
  onDragStart: () => void; onDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void; onDrop: () => void
}) {
  const [hovered, setHovered] = React.useState(false)
  const { t } = useI18n()

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart() }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(e) }}
      onDrop={(e) => { e.preventDefault(); onDrop() }}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "grid items-center gap-3 border-b border-ink-800/60 last:border-0 px-1 py-2.5 cursor-grab select-none transition-colors",
        isDragOver && "border-t-2 border-t-k-500 bg-ink-900/60",
        isDragging ? "opacity-30" : selected ? "bg-k-500/[0.06]" : "hover:bg-ink-100/[0.025]",
      )}
      style={{ gridTemplateColumns: "20px 20px 20px 1fr 55px 52px" }}
    >
      {/* Select */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={t("Select {name}", { name: track.title })}
        onClick={(e) => { e.stopPropagation(); onToggleSelect(e.shiftKey) }}
        onMouseDown={(e) => e.stopPropagation()}
        draggable={false}
        className="flex justify-center cursor-pointer"
      >
        <CheckBox state={selected ? "all" : "none"} />
      </button>

      {/* Grip */}
      <div className="flex justify-center text-ink-700">
        <GripVertical className="h-3.5 w-3.5" />
      </div>

      {/* Index */}
      <div className="flex justify-center">
        {hovered
          ? <Play className="h-3 w-3 fill-current text-ink-400" />
          : <span className="font-mono text-[11px] text-ink-600">{index + 1}</span>
        }
      </div>

      {/* Title + Artist */}
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-100 font-medium">{track.title}</span>
        <span className="max-w-[120px] shrink-0 truncate text-[11px] text-ink-500">{track.artist}</span>
      </div>

      {/* Duration */}
      <div className="text-right font-mono text-[12px] text-ink-500">{track.duration}</div>

      {/* Remove */}
      <div className={cn("flex items-center justify-end transition-opacity", hovered ? "opacity-100" : "opacity-0")}>
        <button onClick={onRemove}
          className="flex h-6 w-6 items-center justify-center text-ink-500 hover:bg-ink-800 hover:text-red-400 transition-colors">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

// ── Playlist Detail ──

function PlaylistDetail({ playlist, library, onChange, onDelete }: {
  playlist: Playlist; library: Track[]
  onChange: (updated: Playlist) => void; onDelete: () => void
}) {
  const [addOpen, setAddOpen]         = React.useState(false)
  const [nameEdit, setNameEdit]       = React.useState(false)
  const [nameValue, setNameValue]     = React.useState(playlist.name)
  const [trackFilter, setTrackFilter] = React.useState("")
  const [dragIndex, setDragIndex]     = React.useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null)
  const [selection, setSelection]     = React.useState<Set<string>>(new Set())
  const lastToggled                   = React.useRef<number | null>(null) // index in visibleTracks, for shift-click
  // Latest playlist for the Undo action (which may fire after other edits).
  const playlistRef = React.useRef(playlist)
  const { t, tn } = useI18n()
  playlistRef.current = playlist

  const tracksByPath = React.useMemo(() => new Map(library.map((t) => [t.path, t])), [library])
  const tracks = playlist.trackPaths.map((p) => tracksByPath.get(p)).filter((t): t is Track => t !== undefined)
  const visibleTracks = trackFilter
    ? tracks.filter((t) => t.title.toLowerCase().includes(trackFilter.toLowerCase()) || t.artist.toLowerCase().includes(trackFilter.toLowerCase()))
    : tracks
  const missingCount = playlist.trackPaths.length - tracks.length
  const totalDur = totalDurationLabel(playlist.trackPaths, tracksByPath)

  const handleDrop = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null); setDragOverIndex(null); return
    }
    const next = [...playlist.trackPaths]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(targetIndex, 0, moved)
    onChange({ ...playlist, trackPaths: next })
    setDragIndex(null); setDragOverIndex(null)
  }

  const removeTrack = (path: string) => {
    onChange({ ...playlist, trackPaths: playlist.trackPaths.filter((p) => p !== path) })
    setSelection((prev) => { const n = new Set(prev); n.delete(path); return n })
    toast.success(t("Track removed"))
  }

  // ── Multi-select ──
  // Selection follows what's visible: reset on playlist switch or filter change.
  React.useEffect(() => { setSelection(new Set()); lastToggled.current = null }, [playlist.id, trackFilter])

  const toggleSelect = (index: number, shiftKey: boolean) => {
    // Read the anchor now: the state updater runs later, after the ref changes.
    const anchor = shiftKey ? lastToggled.current : null
    const from   = anchor !== null ? Math.min(anchor, index) : index
    const to     = anchor !== null ? Math.max(anchor, index) : index
    const paths  = visibleTracks.slice(from, to + 1).map((t) => t.path)
    const turnOn = !selection.has(visibleTracks[index].path)
    // Shift-click applies the clicked row's new on/off state to the whole range.
    setSelection((prev) => {
      const n = new Set(prev)
      for (const p of paths) turnOn ? n.add(p) : n.delete(p)
      return n
    })
    lastToggled.current = index
  }
  const selectedCount = visibleTracks.filter((t) => selection.has(t.path)).length
  const selectState: "none" | "some" | "all" =
    selectedCount === 0 ? "none" : selectedCount === visibleTracks.length ? "all" : "some"
  const toggleSelectAll = () =>
    setSelection(selectState === "all" ? new Set() : new Set(visibleTracks.map((t) => t.path)))

  const removeSelected = () => {
    const before = playlist.trackPaths
    const after  = before.filter((p) => !selection.has(p))
    const removed = before.length - after.length
    if (removed === 0) return
    onChange({ ...playlist, trackPaths: after })
    setSelection(new Set())
    lastToggled.current = null
    toast.success(tn(removed, "Removed {n} track from \"{name}\"", "Removed {n} tracks from \"{name}\"", { name: playlist.name }), {
      action: {
        label: t("Undo"),
        onClick: () => onChange({ ...playlistRef.current, trackPaths: before }),
      },
    })
  }

  const saveName = () => {
    if (nameValue.trim()) { onChange({ ...playlist, name: nameValue.trim() }); toast.success(t("Renamed")) }
    setNameEdit(false)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-ink-800 px-8 pb-6 pt-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {nameEdit ? (
              <div className="flex items-center gap-2">
                <input
                  className="border-b border-ink-600 bg-transparent text-[22px] font-bold tracking-tight text-ink-100 focus:border-k-500 focus:outline-none"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setNameEdit(false); setNameValue(playlist.name) } }}
                  autoFocus
                />
                <button onClick={saveName} className="h-7 px-3 bg-k-500 hover:bg-k-400 text-white text-[12px] font-semibold">{t("Save")}</button>
                <button onClick={() => { setNameEdit(false); setNameValue(playlist.name) }} className="h-7 px-3 border border-ink-800 hover:bg-ink-800 text-[12px] text-ink-400">{t("Cancel")}</button>
              </div>
            ) : (
              <h1 className="cursor-text truncate text-[22px] font-bold tracking-tight text-ink-100 hover:opacity-80 transition-opacity"
                onClick={() => setNameEdit(true)} title={t("Click to rename")}>
                {playlist.name}
              </h1>
            )}
            <p className="mt-1 font-mono text-[11px] text-ink-500">
              {tn(tracks.length, "{n} track", "{n} tracks")}
              {totalDur ? ` · ${totalDur}` : ""}
              {missingCount > 0 && <span className="ml-2 text-amber-500">· {t("{n} missing", { n: missingCount })}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium bg-k-500 text-white hover:bg-k-600 transition-colors">
              <Plus className="h-3 w-3" /> {t("Add tracks")}
            </button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="h-8 w-8 flex items-center justify-center border border-ink-800 hover:bg-red-500/10 hover:border-red-500/30 text-ink-500 hover:text-red-400 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("Delete \"{name}\"?", { name: playlist.name })}</AlertDialogTitle>
                  <AlertDialogDescription>{t("Permanently removed. Library tracks are not affected.")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={onDelete}>{t("Delete")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

      </div>

      {/* Track list */}
      <div className="flex-1 overflow-y-auto">
        {tracks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-ink-500">
            <ListMusic className="h-10 w-10 opacity-20" />
            <p className="text-[12.5px]">{t("Playlist is empty")}</p>
            <button onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium bg-k-500 text-white hover:bg-k-600 transition-colors">
              <Plus className="h-3 w-3" /> {t("Add tracks")}
            </button>
          </div>
        ) : (
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3 px-1">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selectState === "all" ? true : selectState === "some" ? "mixed" : false}
                  aria-label={t("Select all tracks")}
                  onClick={toggleSelectAll}
                  disabled={visibleTracks.length === 0}
                  className="flex w-5 justify-center"
                >
                  <CheckBox state={selectState} />
                </button>
                {selectedCount > 0 ? (
                  <div className="flex min-w-0 items-center gap-3 text-[12px]">
                    <span className="font-medium text-ink-200 whitespace-nowrap">{t("{n} selected", { n: selectedCount })}</span>
                    <button onClick={() => setSelection(new Set())} className="text-ink-500 hover:text-ink-200 transition-colors">
                      {t("Clear")}
                    </button>
                    <button
                      onClick={removeSelected}
                      className="flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[12px] font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                      {t("Remove from playlist")}
                    </button>
                  </div>
                ) : (
                  <span className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-ink-500">
                    {t("Tracks")}
                  </span>
                )}
              </div>
              <div className="relative w-48">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500 h-3 w-3" />
                <input
                  className="h-7 w-full bg-transparent border border-ink-800 pl-7 pr-2 text-[12px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none"
                  placeholder={t("Filter…")} value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)}
                />
              </div>
            </div>
            <div className="border-t border-ink-800">
              {visibleTracks.map((track, i) => {
                const realIndex = playlist.trackPaths.indexOf(track.path)
                return (
                  <TrackRow
                    key={track.path}
                    track={track}
                    index={i}
                    onRemove={() => removeTrack(track.path)}
                    selected={selection.has(track.path)}
                    onToggleSelect={(shift) => toggleSelect(i, shift)}
                    isDragging={dragIndex === realIndex}
                    isDragOver={dragOverIndex === realIndex}
                    onDragStart={() => setDragIndex(realIndex)}
                    onDragEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
                    onDragOver={() => setDragOverIndex(realIndex)}
                    onDrop={() => handleDrop(realIndex)}
                  />
                )
              })}
              <button type="button"
                className="grid w-full items-center gap-3 px-1 py-3 text-left text-ink-600 hover:text-ink-300 transition-colors"
                style={{ gridTemplateColumns: "20px 20px 20px 1fr" }}
                onClick={() => setAddOpen(true)}>
                <div /><div /><div className="flex justify-center"><Plus className="h-3.5 w-3.5" /></div>
                <span className="text-[12.5px]">{t("Add track…")}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <AddTracksDialog open={addOpen} onOpenChange={setAddOpen} library={library}
        existingPaths={playlist.trackPaths}
        onAdd={(paths) => onChange({ ...playlist, trackPaths: [...playlist.trackPaths, ...paths] })}
      />
    </div>
  )
}

// ── YouTube icon ──

function YtIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  )
}

// ── YouTube → Playlist Dialog ──

type YTStep = "input" | "preview" | "downloading"

function YouTubeToPlaylistDialog({ open, onOpenChange, onCreated }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (playlist: Playlist) => void
}) {
  const [step, setStep]                 = React.useState<YTStep>("input")
  const [url, setUrl]                   = React.useState("")
  const [playlistName, setPlaylistName] = React.useState("")
  const [previewing, setPreviewing]     = React.useState(false)
  const [preview, setPreview]           = React.useState<{ type: string; title: string; items: APIImportItem[] } | null>(null)
  const [selected, setSelected]         = React.useState<Set<string>>(new Set())
  const [jobId, setJobId]               = React.useState<string | null>(null)
  const [jobItems, setJobItems]         = React.useState<APIImportItem[]>([])
  const [creating, setCreating]         = React.useState(false)
  const { t, tn } = useI18n()

  const reset = () => {
    setStep("input"); setUrl(""); setPlaylistName(""); setPreviewing(false)
    setPreview(null); setSelected(new Set()); setJobId(null); setJobItems([]); setCreating(false)
  }

  const handleClose = () => { reset(); onOpenChange(false) }

  const handlePreview = async () => {
    if (!url.trim()) return
    setPreviewing(true)
    try {
      const result = await api.library.ytPreview(url.trim())
      setPreview(result)
      setSelected(new Set(result.items.map((i) => i.ytid)))
      if (result.title && !playlistName.trim()) setPlaylistName(result.title)
      setStep("preview")
    } catch (err: unknown) {
      toast.error(t("Preview failed: {error}", { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setPreviewing(false)
    }
  }

  const handleStartDownload = async () => {
    if (!preview) return
    const items = preview.items.filter((i) => selected.has(i.ytid))
    if (items.length === 0) { toast.error(t("Select at least one track")); return }
    if (!playlistName.trim()) { toast.error(t("Playlist name is required")); return }
    setStep("downloading")
    try {
      const { job_id } = await api.library.ytImport({ items })
      setJobId(job_id)
    } catch (err: unknown) {
      toast.error(t("Failed to start: {error}", { error: err instanceof Error ? err.message : String(err) }))
      setStep("preview")
    }
  }

  // Poll job status and create playlist when done
  React.useEffect(() => {
    if (!jobId) return
    const capturedName = playlistName.trim() || "YouTube Import"
    let handled = false

    const finish = async (j: APIImportJob) => {
      if (handled) return
      handled = true

      setCreating(true)
      await new Promise((r) => setTimeout(r, 3000))

      const paths = j.items
        .filter((i) => i.status === "done" && i.path)
        .map((i) => i.path as string)

      if (paths.length === 0) {
        toast.error(t("No tracks were downloaded successfully — check that yt-dlp is installed"))
        setCreating(false)
        setStep("preview")
        return
      }

      const failedCount = j.items.filter((i) => i.status === "error").length

      try {
        const pl = await api.playlists.create({
          name: capturedName,
          mode: "sequential",
          crossfade_ms: 2000,
          track_paths: paths,
        })
        onCreated(adaptApiPlaylist(pl))
        const label = failedCount > 0
          ? t("{tracks} ({n} failed)", { tracks: tn(paths.length, "{n} track", "{n} tracks"), n: failedCount })
          : tn(paths.length, "{n} track", "{n} tracks")
        toast.success(t("\"{name}\" created with {label}", { name: capturedName, label }))
        reset()
        onOpenChange(false)
      } catch (err: unknown) {
        toast.error(t("Create playlist failed: {error}", { error: err instanceof Error ? err.message : String(err) }))
        setCreating(false)
      }
    }

    const poll = async () => {
      try {
        const j = await api.library.importJob(jobId)
        setJobItems(j.items)
        if (j.status === "done" || j.status === "error") {
          clearInterval(timer)
          finish(j)
        }
      } catch { /* ignore */ }
    }

    const timer = setInterval(poll, 1500)
    poll()
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  const toggleAll = () => {
    if (!preview) return
    const allSel = selected.size === preview.items.length
    setSelected(allSel ? new Set() : new Set(preview.items.map((i) => i.ytid)))
  }

  const toggleItem = (ytid: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(ytid) ? next.delete(ytid) : next.add(ytid)
      return next
    })

  const doneCount    = jobItems.filter((i) => i.status === "done").length
  const failCount    = jobItems.filter((i) => i.status === "error").length
  const activeCount  = jobItems.filter((i) => i.status === "pending" || i.status === "downloading").length
  const overallPct   = jobItems.length > 0 ? Math.round((doneCount / jobItems.length) * 100) : 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="p-0 sm:max-w-[580px] max-h-[88vh] flex flex-col gap-0 bg-ink-900 border-ink-800 overflow-hidden">

        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-4 pr-12 border-b border-ink-800">
          <div className="flex items-center gap-2.5">
            <YtIcon className="h-4 w-4 text-red-500 shrink-0" />
            <span className="text-[14px] font-semibold text-ink-100">{t("Import from YouTube")}</span>
          </div>
          <p className="mt-1 text-[12px] text-ink-500 leading-relaxed">
            {step === "input"       && t("Paste a YouTube video or playlist URL to download audio and create a playlist.")}
            {step === "preview"     && (preview?.type === "playlist"
              ? tn(preview.items.length, "{n} track found — select which to download", "{n} tracks found — select which to download")
              : t("Video found — confirm to download"))}
            {step === "downloading" && (creating ? t("Creating playlist…") : t("Downloading… {done} / {total} done", { done: doneCount, total: jobItems.length }))}
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

          {/* Step 1: URL + name */}
          {step === "input" && (
            <div className="px-5 py-5 space-y-4 overflow-y-auto">
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">{t("YouTube URL")}</p>
                <input
                  className="h-9 w-full bg-ink-950 border border-ink-800 px-3 text-[13px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none"
                  placeholder={t("https://www.youtube.com/watch?v=… or /playlist?list=…")}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handlePreview()}
                  autoFocus
                />
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">
                  {t("Playlist Name")} <span className="normal-case text-ink-700">{t("(optional)")}</span>
                </p>
                <input
                  className="h-9 w-full bg-ink-950 border border-ink-800 px-3 text-[13px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none"
                  placeholder={t("Auto-filled from YouTube title")}
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-ink-700 leading-relaxed">
                {t("Downloads audio as MP3. Only download content you own or have permission to use.")}
              </p>
            </div>
          )}

          {/* Step 2: Preview */}
          {step === "preview" && preview && (
            <>
              {/* Fixed controls */}
              <div className="shrink-0 px-5 py-4 space-y-3 border-b border-ink-800 bg-ink-900">
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">{t("Playlist Name")}</p>
                  <input
                    className="h-9 w-full bg-ink-950 border border-ink-800 px-3 text-[13px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none"
                    value={playlistName}
                    onChange={(e) => setPlaylistName(e.target.value)}
                    placeholder={t("Playlist name")}
                  />
                </div>
                {preview.type === "playlist" && (
                  <button
                    className="flex items-center gap-2.5 text-[12px] text-ink-400 hover:text-ink-200 transition-colors"
                    onClick={toggleAll}
                  >
                    <div className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center border",
                      selected.size === preview.items.length ? "border-k-500 bg-k-500" : "border-ink-700"
                    )}>
                      {selected.size === preview.items.length && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                    <span>{t("{selected} / {total} selected", { selected: selected.size, total: preview.items.length })}</span>
                  </button>
                )}
              </div>

              {/* Scrollable track list */}
              <div className="flex-1 overflow-y-auto">
                {preview.items.map((item, idx) => {
                  const isSel = selected.has(item.ytid)
                  return (
                    <div
                      key={item.ytid}
                      className="flex items-center gap-3 px-5 py-2.5 border-b border-ink-800/50 last:border-0 cursor-pointer hover:bg-ink-100/[0.03] transition-colors"
                      onClick={() => toggleItem(item.ytid)}
                    >
                      <div className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center border",
                        isSel ? "border-k-500 bg-k-500" : "border-ink-700"
                      )}>
                        {isSel && <Check className="h-2.5 w-2.5 text-white" />}
                      </div>
                      <span className="font-mono text-[11px] text-ink-700 w-6 shrink-0 text-right tabular-nums">{idx + 1}</span>
                      {item.thumbnail
                        ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.thumbnail} alt="" className="h-9 w-16 shrink-0 object-cover" />
                        ) : (
                          <div className="h-9 w-16 shrink-0 bg-ink-800 flex items-center justify-center">
                            <YtIcon className="h-3.5 w-3.5 text-ink-600" />
                          </div>
                        )
                      }
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-ink-100 font-medium truncate">{item.title}</p>
                        {item.artist && <p className="text-[11px] text-ink-500 truncate">{item.artist}</p>}
                      </div>
                      {item.duration_ms > 0 && (
                        <span className="text-[11px] text-ink-500 font-mono shrink-0 tabular-nums">{formatMs(item.duration_ms)}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Step 3: Downloading */}
          {step === "downloading" && (
            <>
              {/* Overall progress bar */}
              {jobItems.length > 0 && (
                <div className="shrink-0 px-5 py-3 border-b border-ink-800">
                  <div className="flex items-center justify-between mb-2 text-[11.5px]">
                    <span className="text-ink-500">
                      {t("{n} done", { n: doneCount })}{failCount > 0 ? " · " + t("{n} failed", { n: failCount }) : ""}{activeCount > 0 ? " · " + t("{n} remaining", { n: activeCount }) : ""}
                    </span>
                    <span className="font-mono text-ink-500 tabular-nums">{overallPct}%</span>
                  </div>
                  <div className="h-0.5 bg-ink-800 overflow-hidden">
                    <div className="h-full bg-k-500 transition-all duration-500" style={{ width: `${overallPct}%` }} />
                  </div>
                </div>
              )}

              {/* Scrollable item list */}
              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-0.5">
                {jobItems.length === 0 ? (
                  <div className="flex items-center gap-2.5 py-6 text-ink-500">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span className="text-[12.5px]">{t("Starting download…")}</span>
                  </div>
                ) : (
                  jobItems.map((item) => (
                    <div key={item.ytid} className="py-2">
                      <div className="flex items-center gap-2.5">
                        {item.status === "done"        && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                        {item.status === "error"       && <XCircle      className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                        {item.status === "downloading" && <Loader2      className="h-3.5 w-3.5 animate-spin text-k-500 shrink-0" />}
                        {item.status === "pending"     && <div className="h-3.5 w-3.5 shrink-0 rounded-full border border-ink-700" />}
                        <span className={cn(
                          "flex-1 truncate text-[12.5px]",
                          item.status === "done"  ? "text-ink-400" :
                          item.status === "error" ? "text-red-400" : "text-ink-200"
                        )}>
                          {item.title}
                        </span>
                        {item.status === "downloading" && (
                          <span className="font-mono text-[11px] text-k-400 shrink-0 tabular-nums">{Math.round(item.progress)}%</span>
                        )}
                      </div>
                      {item.status === "downloading" && (
                        <div className="mt-1.5 ml-6 h-0.5 overflow-hidden bg-ink-800">
                          <div className="h-full bg-k-500 transition-all duration-300" style={{ width: `${item.progress}%` }} />
                        </div>
                      )}
                    </div>
                  ))
                )}
                {creating && (
                  <div className="flex items-center gap-2.5 border-t border-ink-800 pt-3 mt-2 text-ink-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    <span className="text-[12px]">{t("Creating playlist…")}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between gap-2 px-5 py-4 border-t border-ink-800">
          <button
            onClick={handleClose}
            disabled={step === "downloading"}
            className="h-9 px-4 border border-ink-800 hover:bg-ink-800 text-[13px] text-ink-200 transition-colors disabled:opacity-40"
          >
            {step === "downloading" ? t("Running…") : t("Cancel")}
          </button>
          <div className="flex items-center gap-2">
            {step === "preview" && (
              <button
                onClick={() => setStep("input")}
                className="h-9 px-3 border border-ink-800 hover:bg-ink-800 text-[12.5px] text-ink-400 transition-colors"
              >
                {t("← Back")}
              </button>
            )}
            {step === "input" && (
              <button
                onClick={handlePreview}
                disabled={!url.trim() || previewing}
                className="h-9 px-4 bg-k-500 hover:bg-k-400 disabled:opacity-50 text-white text-[13px] font-semibold transition-colors inline-flex items-center gap-2"
              >
                {previewing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {previewing ? t("Loading…") : t("Preview →")}
              </button>
            )}
            {step === "preview" && (
              <button
                onClick={handleStartDownload}
                disabled={selected.size === 0 || !playlistName.trim()}
                className="h-9 px-4 bg-k-500 hover:bg-k-400 disabled:opacity-50 text-white text-[13px] font-semibold transition-colors"
              >
                {selected.size > 0 ? tn(selected.size, "Download {n} track", "Download {n} tracks") : t("Download")}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── New Playlist Dialog ──

function NewPlaylistDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated: (name: string) => void
}) {
  const [name, setName] = React.useState("")
  const { t } = useI18n()
  const handleCreate = () => {
    if (!name.trim()) { toast.error(t("Name is required")); return }
    onCreated(name.trim()); setName(""); onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs bg-ink-900 border-ink-800">
        <DialogHeader>
          <DialogTitle className="text-ink-100">{t("New Playlist")}</DialogTitle>
          <DialogDescription className="text-ink-500">{t("Give your playlist a name to get started.")}</DialogDescription>
        </DialogHeader>
        <input
          className="h-9 w-full bg-ink-950 border border-ink-800 px-3 text-[13px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none"
          placeholder={t("e.g. Morning Mix")} value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate() }} autoFocus
        />
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="h-9 px-4 border border-ink-800 hover:bg-ink-800 text-[13px] text-ink-200 transition-colors">{t("Cancel")}</button>
          <button onClick={handleCreate} className="h-9 px-4 bg-k-500 hover:bg-k-400 text-white text-[13px] font-semibold transition-colors">{t("Create")}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Page ──

export default function PlaylistsPage() {
  const [playlists, setPlaylists]   = React.useState<Playlist[]>([])
  const [library, setLibrary]       = React.useState<Track[]>([])
  const [mounts, setMounts]         = React.useState<APIMount[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [loading, setLoading]       = React.useState(true)
  const [dirtyIds, setDirtyIds]     = React.useState<Set<string>>(new Set())
  const [newOpen, setNewOpen]       = React.useState(false)
  const [ytOpen, setYtOpen]         = React.useState(false)
  const { t, tn } = useI18n()

  const tracksByPath = React.useMemo(() => new Map(library.map((t) => [t.path, t])), [library])

  React.useEffect(() => {
    Promise.all([
      api.playlists.list().catch((): APIPlaylist[] => []),
      api.library.list().catch(() => []),
      api.mounts.list().catch((): APIMount[] => []),
      api.autoDJSessions().catch((): APIAutoDJSession[] => []),
    ]).then(([pls, tracks, ms, sessions]) => {
      const adapted = applySessionsToPlaylists(pls.map(adaptApiPlaylist), sessions)
      setPlaylists(adapted); setLibrary(tracks.map(adaptApiTrack)); setMounts(ms)
      if (adapted.length > 0) setSelectedId(adapted[0].id)
      setLoading(false)
    })
  }, [])

  React.useEffect(() => {
    const id = setInterval(() => {
      api.autoDJSessions()
        .then((sessions) => setPlaylists((prev) => applySessionsToPlaylists(prev, sessions)))
        .catch(() => {})
    }, 5000)
    return () => clearInterval(id)
  }, [])

  const selected = playlists.find((p) => p.id === selectedId) ?? null

  const updatePlaylist = (updated: Playlist) => {
    const prev = playlists.find((p) => p.id === updated.id)
    const changed = prev && (JSON.stringify(prev.trackPaths) !== JSON.stringify(updated.trackPaths) || prev.mode !== updated.mode)
    setPlaylists((ps) => ps.map((p) => p.id === updated.id ? updated : p))
    if (updated.autoDJ && updated.assignedMount && changed) {
      setDirtyIds((d) => new Set([...d, updated.id]))
    }
    api.playlists.update(updated.id, { name: updated.name, mode: updated.mode, crossfade_ms: updated.crossfade, track_paths: updated.trackPaths })
      .catch((err) => toast.error(t("Save failed: {error}", { error: err.message })))
  }

  const deletePlaylist = (id: string) => {
    api.playlists.delete(id)
      .then(() => {
        setPlaylists((prev) => prev.filter((p) => p.id !== id))
        setDirtyIds((d) => { const n = new Set(d); n.delete(id); return n })
        if (selectedId === id) setSelectedId(playlists.find((p) => p.id !== id)?.id ?? null)
        toast.success(t("Playlist deleted"))
      })
      .catch((err) => toast.error(t("Delete failed: {error}", { error: err.message })))
  }

  const createPlaylist = (name: string) => {
    api.playlists.create({ name, mode: "sequential", crossfade_ms: 2000, track_paths: [] })
      .then((p) => {
        const newPl = adaptApiPlaylist(p)
        setPlaylists((prev) => [newPl, ...prev]); setSelectedId(newPl.id)
        toast.success(t("Playlist \"{name}\" created", { name }))
      })
      .catch((err) => toast.error(t("Create failed: {error}", { error: err.message })))
  }

  const handleAutoDJStart = async (mountName: string, pl: Playlist, startTrackPath?: string) => {
    await api.mounts.startAutoDJ(mountName, { playlist_id: pl.id, mode: pl.mode, start_track_path: startTrackPath })
    setPlaylists((prev) => prev.map((p) => p.id === pl.id ? { ...p, autoDJ: true, assignedMount: mountName } : p))
    setDirtyIds((d) => { const n = new Set(d); n.delete(pl.id); return n })
    toast.success(startTrackPath ? t("AutoDJ jumping to track…") : t("AutoDJ started on {mount}", { mount: mountName }))
  }

  const handleAutoDJStop = async (mountName: string, pl: Playlist) => {
    await api.mounts.stopAutoDJ(mountName)
    setPlaylists((prev) => prev.map((p) => p.id === pl.id ? { ...p, autoDJ: false } : p))
    setDirtyIds((d) => { const n = new Set(d); n.delete(pl.id); return n })
    toast.success(t("AutoDJ stopped"))
  }

  const handleAutoDJRestart = async (mountName: string, pl: Playlist) => {
    try {
      await api.mounts.stopAutoDJ(mountName).catch(() => {})
      await api.mounts.startAutoDJ(mountName, { playlist_id: pl.id, mode: pl.mode })
      setPlaylists((prev) => prev.map((p) => p.id === pl.id ? { ...p, autoDJ: true, assignedMount: mountName } : p))
      setDirtyIds((d) => { const n = new Set(d); n.delete(pl.id); return n })
      toast.success(t("AutoDJ restarted"))
    } catch (err: unknown) {
      toast.error(t("Restart failed: {error}", { error: err instanceof Error ? err.message : String(err) })); throw err
    }
  }

  const handlePlayFrom = async (pl: Playlist, trackPath: string) => {
    if (!pl.assignedMount) { toast.error(t("No mount assigned")); return }
    try {
      await api.mounts.stopAutoDJ(pl.assignedMount).catch(() => {})
      await handleAutoDJStart(pl.assignedMount, pl, trackPath)
    } catch (err: unknown) {
      toast.error(t("Failed: {error}", { error: err instanceof Error ? err.message : String(err) }))
    }
  }

  return (
    <div className="-mx-8 -my-10 flex overflow-hidden" style={{ height: "calc(100vh - 56px)" }}>

      {/* Playlist rail */}
      <aside className="w-60 shrink-0 flex flex-col border-r border-ink-800 bg-ink-900">
        <div className="flex shrink-0 items-center justify-between border-b border-ink-800 px-4 py-4">
          <h2 className="text-[13px] font-semibold text-ink-100">{t("Playlists")}</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setYtOpen(true)} title={t("Import from YouTube")}
              className="h-7 w-7 flex items-center justify-center border border-ink-800 hover:bg-ink-800 text-red-600/60 hover:text-red-500 transition-colors">
              <YtIcon className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setNewOpen(true)} title={t("New playlist")}
              className="h-7 w-7 flex items-center justify-center border border-ink-800 hover:bg-ink-800 text-ink-400 hover:text-ink-200 transition-colors">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-12 text-ink-500">
              <ListMusic className="h-7 w-7 opacity-20 animate-pulse" />
              <p className="text-[12px] font-mono">{t("Loading…")}</p>
            </div>
          ) : playlists.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-ink-500">
              <ListMusic className="h-7 w-7 opacity-20" />
              <p className="text-[12px]">{t("No playlists yet")}</p>
              <button onClick={() => setNewOpen(true)} className="text-[11.5px] text-k-400 hover:text-k-300 transition-colors">{t("Create one →")}</button>
            </div>
          ) : (
            playlists.map((pl) => {
              const trackCount = pl.trackPaths.length
              const dur = totalDurationLabel(pl.trackPaths, tracksByPath)
              const isActive = selectedId === pl.id
              return (
                <button key={pl.id} type="button" onClick={() => setSelectedId(pl.id)}
                  className={cn("w-full px-3 py-2.5 text-left transition-colors",
                    isActive ? "bg-ink-800 border border-ink-700" : "border border-transparent hover:bg-ink-800/50"
                  )}>
                  <span className={cn("truncate text-[13px] font-medium", isActive ? "text-ink-100" : "text-ink-300")}>
                    {pl.name}
                  </span>
                  <div className="mt-0.5 font-mono text-[11px] text-ink-500">
                    {trackCount > 0
                      ? tn(trackCount, "{n} track", "{n} tracks") + (dur ? ` · ${dur}` : "")
                      : t("Empty")
                    }
                  </div>
                </button>
              )
            })
          )}
        </div>
      </aside>

      {/* Detail panel */}
      <main className="flex flex-1 flex-col overflow-hidden bg-ink-950">
        {selected ? (
          <PlaylistDetail
            key={selected.id} playlist={selected} library={library}
            onChange={updatePlaylist} onDelete={() => deletePlaylist(selected.id)}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-ink-500">
            <ListMusic className="h-12 w-12 opacity-20" />
            <p className="text-[13px]">
              {loading ? t("Loading…") : playlists.length === 0 ? t("Create a playlist to get started") : t("Select a playlist to edit")}
            </p>
            {!loading && playlists.length === 0 && (
              <button onClick={() => setNewOpen(true)} className="text-[12px] text-k-400 hover:text-k-300 transition-colors">
                {t("New Playlist →")}
              </button>
            )}
          </div>
        )}
      </main>

      <NewPlaylistDialog open={newOpen} onOpenChange={setNewOpen} onCreated={createPlaylist} />

      <YouTubeToPlaylistDialog
        open={ytOpen}
        onOpenChange={setYtOpen}
        onCreated={(pl) => {
          setPlaylists((prev) => [pl, ...prev])
          setSelectedId(pl.id)
          // Reload library so newly downloaded tracks resolve in the detail panel
          api.library.list()
            .then((ts) => setLibrary(ts.map(adaptApiTrack)))
            .catch(() => {})
        }}
      />
    </div>
  )
}
