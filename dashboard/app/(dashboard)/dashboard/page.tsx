"use client"

import * as React from "react"
import Link from "next/link"
import { api, type APIStatus, type APIMount } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"

const FE_COMMIT  = process.env.NEXT_PUBLIC_GIT_COMMIT ?? "unknown"
const FE_VERSION = process.env.NEXT_PUBLIC_VERSION    ?? "dev"

// ── Helpers ──

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n >= 100 || i === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`
}

function usageColor(pct: number, text = true): string {
  if (pct < 70) return text ? "text-emerald-400" : "bg-emerald-500"
  if (pct < 90) return text ? "text-amber-400"   : "bg-amber-500"
  return text ? "text-red-400" : "bg-red-500"
}

function PulseDot({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block w-1.5 h-1.5 rounded-full pulse-dot shrink-0", className)}
    />
  )
}

// ── Build info ──

function BuildInfo({ status }: { status: APIStatus }) {
  const { t, tx } = useI18n()
  const serverCommit  = status.git_commit ?? "unknown"
  const match = serverCommit !== "unknown" && FE_COMMIT !== "unknown" && serverCommit === FE_COMMIT

  const rows = [
    { label: t("server"),   value: `${status.version} · ${serverCommit}` },
    { label: t("dashboard"), value: `${FE_VERSION} · ${FE_COMMIT}` },
    { label: t("runtime"),  value: status.go_version },
    { label: t("uptime"),   value: formatUptime(status.uptime_sec) },
    { label: t("platform"), value: status.os_arch },
  ]

  return (
    <div className="border-t border-ink-800 text-[12.5px] font-mono">
      {/* Commit match banner */}
      <div className={cn(
        "flex items-center gap-2 py-2 border-b border-ink-800/60",
        match ? "text-emerald-400" : "text-amber-400"
      )}>
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", match ? "bg-emerald-500" : "bg-amber-400")} />
        {match
          ? <span>{tx("Server and dashboard are in sync {commit}", { commit: <span className="text-ink-600">({serverCommit})</span> })}</span>
          : <span>{tx("Version mismatch — server {server} · dashboard {dashboard}", {
              server:    <span className="text-ink-300">{serverCommit}</span>,
              dashboard: <span className="text-ink-300">{FE_COMMIT}</span>,
            })}</span>
        }
      </div>

      {rows.map((r, i) => (
        <div key={r.label} className={cn(
          "grid grid-cols-[90px_minmax(0,1fr)] gap-4 py-2",
          i < rows.length - 1 && "border-b border-ink-800/60"
        )}>
          <span className="text-ink-500">{r.label}</span>
          <span className="text-ink-300">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Page ──

export default function OverviewPage() {
  const [apiStatus, setApiStatus] = React.useState<APIStatus | null>(null)
  const [apiMounts, setApiMounts] = React.useState<APIMount[] | null>(null)
  const [error, setError]         = React.useState<string | null>(null)
  const { t } = useI18n()

  React.useEffect(() => {
    let alive = true
    const load = () => {
      Promise.all([api.status(), api.mounts.list()])
        .then(([s, ms]) => {
          if (!alive) return
          setApiStatus(s); setApiMounts(ms); setError(null)
        })
        .catch((err) => { if (alive) setError(err.message) })
    }
    load()
    const id = setInterval(load, 10_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const liveMounts     = apiMounts?.filter((m) => m.status === "live") ?? []
  const totalListeners = apiMounts?.reduce((s, m) => s + m.listeners, 0) ?? 0

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[24px] font-bold tracking-tight text-ink-100">{t("Overview")}</h1>
        <p className="text-[12.5px] text-ink-400 mt-1">{t("Server status and active streams")}</p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 flex items-center gap-3 py-3 px-4 rounded-md border border-red-500/20 bg-red-500/5 text-[12.5px]">
          <span className="text-red-400">{t("Could not reach server:")}</span>
          <span className="text-ink-300">{error}</span>
          <span className="ml-auto text-ink-500">{t("Check API URL/key in Settings")}</span>
        </div>
      )}

      {/* Stat strip */}
      <div className="mt-8 grid grid-cols-3 gap-px bg-ink-800 border border-ink-800 rounded-lg overflow-hidden">
        <div className="bg-ink-950 px-5 py-4">
          <div className="text-[11px] text-ink-500 font-mono uppercase tracking-wider">{t("Active mounts")}</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-[22px] font-bold text-ink-100">
              {apiMounts !== null ? liveMounts.length : "—"}
            </span>
            {apiMounts !== null && (
              <span className="text-[11px] text-ink-500 font-mono">{t("of {n}", { n: apiMounts.length })}</span>
            )}
          </div>
        </div>
        <div className="bg-ink-950 px-5 py-4">
          <div className="text-[11px] text-ink-500 font-mono uppercase tracking-wider">{t("Total listeners")}</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-[22px] font-bold text-ink-100">
              {apiMounts !== null ? totalListeners : "—"}
            </span>
            {totalListeners > 0 && (
              <span className="text-[11px] text-emerald-400 font-mono">{t("live")}</span>
            )}
          </div>
        </div>
        <div className="bg-ink-950 px-5 py-4">
          <div className="text-[11px] text-ink-500 font-mono uppercase tracking-wider">{t("Uptime")}</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-[22px] font-bold text-ink-100">
              {apiStatus ? formatUptime(apiStatus.uptime_sec) : "—"}
            </span>
            {apiStatus && (
              <span className="text-[11px] text-ink-500 font-mono">{apiStatus.version}</span>
            )}
          </div>
        </div>
        {/* CPU */}
        <div className="bg-ink-950 px-5 py-4">
          <div className="text-[11px] text-ink-500 font-mono uppercase tracking-wider">CPU</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className={cn(
              "text-[22px] font-bold",
              apiStatus?.cpu_percent != null && apiStatus.cpu_percent >= 0
                ? apiStatus.cpu_percent < 50
                  ? "text-emerald-400"
                  : apiStatus.cpu_percent < 80
                    ? "text-amber-400"
                    : "text-red-400"
                : "text-ink-100"
            )}>
              {apiStatus?.cpu_percent != null && apiStatus.cpu_percent >= 0
                ? apiStatus.cpu_percent.toFixed(1) + "%"
                : "—"}
            </span>
          </div>
        </div>
        {/* Memory */}
        <div className="bg-ink-950 px-5 py-4">
          <div className="text-[11px] text-ink-500 font-mono uppercase tracking-wider">{t("Memory")}</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-[22px] font-bold text-ink-100">
              {apiStatus?.mem_rss_mb != null && apiStatus.mem_rss_mb >= 0
                ? apiStatus.mem_rss_mb + " MB"
                : "—"}
            </span>
          </div>
        </div>
        {/* Disk — filesystem holding the data folder */}
        <div className="bg-ink-950 px-5 py-4" title={apiStatus?.disk ? t("Filesystem of {path}", { path: apiStatus.disk.path }) : undefined}>
          <div className="text-[11px] text-ink-500 font-mono uppercase tracking-wider">{t("Disk")}</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className={cn("text-[22px] font-bold", apiStatus?.disk ? usageColor(apiStatus.disk.used_percent) : "text-ink-100")}>
              {apiStatus?.disk ? apiStatus.disk.used_percent.toFixed(0) + "%" : "—"}
            </span>
            {apiStatus?.disk && (
              <span className="text-[11px] text-ink-500 font-mono">
                {formatBytes(apiStatus.disk.used_bytes)} / {formatBytes(apiStatus.disk.total_bytes)}
              </span>
            )}
          </div>
          {apiStatus?.disk && (
            <>
              <div className="mt-2 h-1 w-full bg-ink-800 overflow-hidden">
                <div
                  className={cn("h-full", usageColor(apiStatus.disk.used_percent, false))}
                  style={{ width: `${Math.min(100, apiStatus.disk.used_percent)}%` }}
                />
              </div>
              <div className="mt-1.5 text-[11px] text-ink-500 font-mono">
                {t("{size} free", { size: formatBytes(apiStatus.disk.free_bytes) })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mounts */}
      <div className="mt-9">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[11px] font-medium text-ink-500 uppercase tracking-wider font-mono">{t("Mounts")}</h2>
          <Link href="/mounts" className="text-[12px] text-k-400 hover:text-k-300 font-medium transition-colors">
            {t("View all →")}
          </Link>
        </div>

        {apiMounts === null ? (
          <div className="border-t border-ink-800 py-8 flex items-center justify-center text-[12px] text-ink-500 font-mono">
            {t("Loading…")}
          </div>
        ) : apiMounts.length === 0 ? (
          <div className="border-t border-ink-800 py-8 flex flex-col items-center gap-2">
            <p className="text-[12.5px] text-ink-500">{t("No mounts yet")}</p>
            <Link href="/mounts" className="text-[12px] text-k-400 hover:text-k-300 transition-colors">
              {t("Create your first mount →")}
            </Link>
          </div>
        ) : (
          <div className="border-t border-ink-800">
            {/* Column headers */}
            <div className="grid grid-cols-[minmax(0,1.4fr)_80px_130px_60px_28px] gap-3 px-1 py-2 text-[10.5px] uppercase tracking-wider text-ink-500 font-mono border-b border-ink-800">
              <div>{t("Mount")}</div>
              <div>{t("Protocol")}</div>
              <div>{t("Codec / Bitrate")}</div>
              <div className="text-right">{t("Lsnr")}</div>
              <div />
            </div>
            {apiMounts.map((mount, i) => (
              <div
                key={mount.id}
                className={cn(
                  "kast-row grid grid-cols-[minmax(0,1.4fr)_80px_130px_60px_28px] gap-3 px-1 py-2.5 items-center",
                  i < apiMounts.length - 1 && "border-b border-ink-800/60"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <PulseDot
                    className={
                      mount.status === "live" ? "bg-emerald-500" :
                      mount.status === "error" ? "bg-red-500" :
                      "bg-ink-600"
                    }
                  />
                  <span className="font-mono text-[13px] text-ink-100 truncate">{mount.name}</span>
                </div>
                <span className={cn(
                  "text-[11px] font-mono",
                  mount.protocol === "LL-HLS" ? "text-k-400" : "text-ink-400"
                )}>
                  {mount.protocol || "HLS"}
                </span>
                <span className="text-[12px] font-mono text-ink-400">
                  {[mount.codec, mount.bitrate].filter(Boolean).join(" · ") || "—"}
                </span>
                <span className="text-right text-[12px] font-mono text-ink-100">{mount.listeners}</span>
                <div className="row-actions flex items-center justify-end">
                  <Link href="/mounts">
                    <button className="h-7 w-7 rounded-md hover:bg-ink-800 text-ink-400 flex items-center justify-center transition-colors">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                        <path d="M7 17 17 7"/><path d="M7 7h10v10"/>
                      </svg>
                    </button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Build info */}
      {apiStatus && (
        <div className="mt-9">
          <h2 className="text-[11px] font-medium text-ink-500 uppercase tracking-wider font-mono mb-3">{t("Build")}</h2>
          <BuildInfo status={apiStatus} />
        </div>
      )}
    </div>
  )
}
