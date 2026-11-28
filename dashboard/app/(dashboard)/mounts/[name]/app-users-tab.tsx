"use client"

import * as React from "react"
import { TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { api, type AppUser } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AppUserLinkFields, emptyAppUserLink, isAppUserLinkValid, submitAppUserLink, useAppUsers,
} from "@/components/app-user-link"
import { type Mount } from "../page"

const labelCls = "text-[10.5px] uppercase tracking-wider text-ink-500 font-mono font-medium"

/** Mobile-app users (Firestore `users/{email}`) linked to this mount. */
export function MountAppUsersTab({ mount }: { mount: Mount }) {
  const { t } = useI18n()
  const { users, setUsers, loading, error, reload } = useAppUsers()
  const [link, setLink]     = React.useState(() => emptyAppUserLink())
  const [saving, setSaving] = React.useState(false)

  const linked       = users.filter(u => u.mountId === mount.name)
  const hasRadioName = !!mount.radioName
  const valid        = hasRadioName && isAppUserLinkValid(link, users, mount.name)

  async function handleSubmit() {
    if (!valid) return
    setSaving(true)
    try {
      const result = await submitAppUserLink(link, mount.name)
      toast.success(result === "created" ? t("App user created") : t("User linked to {mount}", { mount: mount.name }))
      setLink(emptyAppUserLink(link.mode))
      reload()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? t(e.message) : t("Failed to link user"))
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(u: AppUser) {
    setUsers(list => list.map(x => x.email === u.email ? { ...x, enabled: !u.enabled } : x))
    try {
      await api.appUsers.setEnabled(u.email, !u.enabled)
    } catch (e: unknown) {
      setUsers(list => list.map(x => x.email === u.email ? { ...x, enabled: u.enabled } : x))
      toast.error(e instanceof Error ? t(e.message) : t("Failed to update app user"))
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Linked users ─────────────────────────────────────────────────── */}
      <div>
        <p className={cn(labelCls, "mb-1.5")}>{t("Users linked to this mount")}</p>
        <div className="rounded-md border border-ink-800 bg-ink-950/40">
          {loading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : error ? (
            <p className="px-3 py-6 text-center text-[12px] text-red-400">{t(error)}</p>
          ) : linked.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-ink-500">{t("No users linked to this mount yet")}</p>
          ) : (
            <div className="max-h-[260px] overflow-y-auto divide-y divide-ink-800">
              {linked.map(u => (
                <div key={u.email} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate text-[12.5px] text-ink-100">{u.email}</span>
                  <Switch
                    checked={u.enabled}
                    onCheckedChange={() => handleToggle(u)}
                    aria-label={t("Enabled")}
                    className="data-[state=checked]:bg-k-500"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Link form ────────────────────────────────────────────────────── */}
      <div className="rounded-md border border-ink-800 bg-ink-950/40 p-4 space-y-4">
        <p className="text-[13px] font-medium text-ink-100">{t("Link a user")}</p>

        {!hasRadioName && (
          <p className="flex items-start gap-2 text-[11.5px] text-amber-400">
            <TriangleAlert className="h-3.5 w-3.5 mt-px shrink-0" />
            {t("Set a Radio Name for this mount (Info → Edit) before linking app users.")}
          </p>
        )}

        <AppUserLinkFields
          value={link}
          onChange={setLink}
          users={users}
          usersLoading={loading}
          usersError={error}
          mountName={mount.name}
          hideEnabled
          idPrefix="mount-tab-app-user"
        />

        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={!valid || saving}
            className="h-8 px-4 bg-k-500 hover:bg-k-400 disabled:opacity-50 text-white text-[12.5px] font-semibold transition-colors"
          >
            {saving
              ? (link.mode === "existing" ? t("Linking…") : t("Creating…"))
              : (link.mode === "existing" ? t("Link User") : t("Create User"))}
          </button>
        </div>
      </div>
    </div>
  )
}
