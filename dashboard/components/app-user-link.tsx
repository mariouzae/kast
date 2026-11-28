"use client"

// Shared "link an app user to a mount" fields: radio (none / existing / new),
// a searchable picker for existing Firestore users, e-mail + password for a new
// one, and the enabled switch. Used by the mount's App Users tab and by the
// New Mount dialog.

import * as React from "react"
import { ChevronsUpDown } from "lucide-react"
import { api, type AppUser } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { Switch } from "@/components/ui/switch"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"

export type AppUserLinkMode = "none" | "existing" | "new"

export type AppUserLinkValue = {
  mode:     AppUserLinkMode
  selected: string // e-mail of the chosen existing user
  email:    string
  password: string
  enabled:  boolean
}

export const emptyAppUserLink = (mode: AppUserLinkMode = "existing"): AppUserLinkValue =>
  ({ mode, selected: "", email: "", password: "", enabled: true })

/** True when the fields describe a complete action ("none" is always valid). */
export function isAppUserLinkValid(v: AppUserLinkValue, users: AppUser[], mountName?: string): boolean {
  if (v.mode === "none") return true
  if (v.mode === "new") return !!v.email.trim() && v.password.length >= 6
  const u = users.find(x => x.email === v.selected)
  return !!u && u.mountId !== mountName
}

/** Pushes the link to Firebase. Returns a short description for a toast, or null for "none". */
export async function submitAppUserLink(v: AppUserLinkValue, mountName: string): Promise<"linked" | "created" | null> {
  if (v.mode === "existing") {
    await api.appUsers.linkToMount(v.selected, mountName, v.enabled)
    return "linked"
  }
  if (v.mode === "new") {
    await api.appUsers.create({ email: v.email.trim(), password: v.password, enabled: v.enabled, mountId: mountName })
    return "created"
  }
  return null
}

const inputCls = "h-8 w-full bg-ink-950 border border-ink-800 rounded-md px-3 text-[12.5px] text-ink-100 placeholder:text-ink-600 focus:border-k-500/50 focus:outline-none"
const labelCls = "text-[10.5px] uppercase tracking-wider text-ink-500 font-mono font-medium"

export function AppUserLinkFields({
  value, onChange, users, usersLoading, usersError, mountName, allowNone, hideEnabled, idPrefix = "app-user",
}: {
  value:         AppUserLinkValue
  onChange:      (v: AppUserLinkValue) => void
  users:         AppUser[]
  usersLoading?: boolean
  usersError?:   string | null
  /** The mount being linked to, if it already exists (for "already linked"/"moved" hints). */
  mountName?:    string
  /** Adds a "Don't link" option. */
  allowNone?:    boolean
  /**
   * Hides the Enabled switch. `value.enabled` still applies: true for a new
   * user, and the user's current value when an existing one is picked.
   */
  hideEnabled?:  boolean
  idPrefix?:     string
}) {
  const { t } = useI18n()
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const set = (patch: Partial<AppUserLinkValue>) => onChange({ ...value, ...patch })
  const selectedUser = users.find(u => u.email === value.selected)

  const modes: [AppUserLinkMode, string][] = [
    ...(allowNone ? [["none", "Don't link"] as [AppUserLinkMode, string]] : []),
    ["existing", "Select existing user"],
    ["new", "Add new user"],
  ]

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={t("Link a user")} className="flex flex-wrap gap-x-4 gap-y-2">
        {modes.map(([m, label]) => (
          <label key={m} className="flex items-center gap-2 cursor-pointer text-[12.5px] text-ink-200">
            <input
              type="radio"
              name={`${idPrefix}-mode`}
              value={m}
              checked={value.mode === m}
              onChange={() => set({ mode: m, enabled: m === "existing" ? (selectedUser?.enabled ?? true) : true })}
              className="h-3.5 w-3.5 accent-[var(--color-k-500)]"
            />
            {t(label)}
          </label>
        ))}
      </div>

      {value.mode === "existing" && (
        <div className="space-y-1">
          <p className={labelCls}>{t("User")}</p>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                role="combobox"
                aria-expanded={pickerOpen}
                aria-controls={`${idPrefix}-picker`}
                disabled={usersLoading || !!usersError}
                className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-ink-800 bg-ink-950 px-3 text-left text-[12.5px] text-ink-100 outline-none focus-visible:border-k-500/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className={cn("truncate", !selectedUser && "text-ink-500")}>
                  {selectedUser ? selectedUser.email : usersLoading ? t("Loading…") : t("Select a user")}
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-500" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              id={`${idPrefix}-picker`}
              className="w-(--radix-popover-trigger-width) min-w-64 p-0"
              align="start"
              onWheel={e => e.stopPropagation()}
              onTouchMove={e => e.stopPropagation()}
            >
              <Command>
                <CommandInput placeholder={t("Search by e-mail")} />
                <CommandList className="max-h-64 overscroll-contain">
                  <CommandEmpty>{t("No users found")}</CommandEmpty>
                  <CommandGroup>
                    {users.map(u => (
                      <CommandItem
                        key={u.email}
                        value={u.email}
                        data-checked={u.email === value.selected}
                        onSelect={() => { set({ selected: u.email, enabled: u.enabled }); setPickerOpen(false) }}
                      >
                        <span className="truncate">{u.email}</span>
                        <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-500">{u.mountId || "—"}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {usersError && <p className="text-[11.5px] text-red-400">{t(usersError)}</p>}
          {selectedUser && mountName && selectedUser.mountId === mountName && (
            <p className="text-[11.5px] text-ink-500">{t("Already linked to this mount")}</p>
          )}
          {selectedUser && selectedUser.mountId && selectedUser.mountId !== mountName && (
            <p className="text-[11.5px] text-amber-400">
              {t("Currently linked to {mount} — it will be moved to this mount", { mount: selectedUser.mountId })}
            </p>
          )}
        </div>
      )}

      {value.mode === "new" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className={labelCls}>{t("E-mail")}</p>
            <input
              type="email"
              className={inputCls}
              value={value.email}
              onChange={e => set({ email: e.target.value })}
              placeholder="user@example.com"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <p className={labelCls}>{t("Password")}</p>
            <input
              type="password"
              className={inputCls}
              value={value.password}
              onChange={e => set({ password: e.target.value })}
              placeholder={t("Min. 6 characters")}
              autoComplete="new-password"
            />
          </div>
        </div>
      )}

      {value.mode !== "none" && !hideEnabled && (
        <label className="flex items-center gap-2 text-[12.5px] text-ink-200">
          <Switch
            checked={value.enabled}
            onCheckedChange={enabled => set({ enabled })}
            className="data-[state=checked]:bg-k-500"
          />
          {t("Enabled")}
        </label>
      )}
    </div>
  )
}

/** Loads the app-user list once when `active` first becomes true. */
export function useAppUsers(active = true) {
  const [users, setUsers]     = React.useState<AppUser[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError]     = React.useState<string | null>(null)
  const [nonce, setNonce]     = React.useState(0)

  React.useEffect(() => {
    if (!active) return
    let alive = true
    api.appUsers.list()
      .then(list => { if (alive) { setUsers(list); setError(null) } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Failed to load app users") })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [active, nonce])

  const reload = React.useCallback(() => setNonce(n => n + 1), [])
  return { users, setUsers, loading, error, reload }
}
