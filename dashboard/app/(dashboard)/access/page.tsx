"use client"

import * as React from "react"
import { Plus, MoreHorizontal, Copy, Check, Trash2, Search } from "lucide-react"
import { toast } from "sonner"
import { useI18n, type TFunc } from "@/lib/i18n"
import { api, type APIUser, type APIKey, type CreateAPIKeyResponse, type APIMount, type AppUser, effectiveRadioName } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

// ── Types & helpers ───────────────────────────────────────────────────────────

type Role = "admin" | "operator" | "viewer"

const NO_MOUNT = "__none__"

function relativeTime(dateStr: string | null, t: TFunc): string {
  if (!dateStr) return t("never")
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return t("just now")
  if (min < 60) return t("{n}m ago", { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t("{n}h ago", { n: hr })
  return t("{n}d ago", { n: Math.floor(hr / 24) })
}

function formatExpiry(dateStr: string | null, t: TFunc, lang: string): string {
  if (!dateStr) return t("never")
  const d = new Date(dateStr)
  if (d < new Date()) return t("expired")
  return d.toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" })
}

const ROLE_STYLES: Record<Role, string> = {
  admin:    "bg-violet-500/15 text-violet-400 border-violet-500/25",
  operator: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  viewer:   "bg-ink-700 text-ink-400 border-ink-600",
}

function RoleBadge({ role }: { role: Role }) {
  const { t } = useI18n()
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-mono border ${ROLE_STYLES[role]}`}>
      {t(role)}
    </span>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AccessPage() {
  const [users, setUsers] = React.useState<APIUser[]>([])
  const [me, setMe] = React.useState<APIUser | null>(null)
  const [usersLoading, setUsersLoading] = React.useState(true)

  const [apiKeys, setApiKeys] = React.useState<APIKey[]>([])
  const [keysLoading, setKeysLoading] = React.useState(true)

  // Add user dialog
  const [addOpen, setAddOpen] = React.useState(false)
  const [addForm, setAddForm] = React.useState({ username: "", password: "", role: "viewer" as Role })
  const [addSaving, setAddSaving] = React.useState(false)

  // Change password dialog
  const [pwTarget, setPwTarget] = React.useState<APIUser | null>(null)
  const [pwForm, setPwForm] = React.useState({ password: "", confirm: "" })
  const [pwSaving, setPwSaving] = React.useState(false)

  // Delete user confirm
  const [deleteTarget, setDeleteTarget] = React.useState<APIUser | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  // Create API key dialog
  type KeyDialogMode = "form" | "reveal"
  const [keyDialogOpen, setKeyDialogOpen] = React.useState(false)
  const [keyDialogMode, setKeyDialogMode] = React.useState<KeyDialogMode>("form")
  const [keyForm, setKeyForm] = React.useState({ name: "", expiresAt: "", ipAllowlist: "" })
  const [keySaving, setKeySaving] = React.useState(false)
  const [createdKey, setCreatedKey] = React.useState<CreateAPIKeyResponse | null>(null)
  const [keyCopied, setKeyCopied] = React.useState(false)

  // Delete API key confirm
  const [deleteKeyTarget, setDeleteKeyTarget] = React.useState<APIKey | null>(null)
  const [deletingKey, setDeletingKey] = React.useState(false)

  // App users (Firebase)
  const [appUsers, setAppUsers] = React.useState<AppUser[]>([])
  const [appUsersLoading, setAppUsersLoading] = React.useState(true)
  const [appUsersError, setAppUsersError] = React.useState<string | null>(null)
  const [appSearch, setAppSearch] = React.useState("")
  const [deleteAppTarget, setDeleteAppTarget] = React.useState<AppUser | null>(null)
  const [deletingApp, setDeletingApp] = React.useState(false)
  const [mounts, setMounts] = React.useState<APIMount[]>([])
  const emptyAppForm = { enabled: true, email: "", password: "", mountId: "" }
  const [appOpen, setAppOpen] = React.useState(false)
  const [appForm, setAppForm] = React.useState(emptyAppForm)
  const [appSaving, setAppSaving] = React.useState(false)
  const { t, tn, tx, lang } = useI18n()

  async function loadUsers() {
    try {
      const [userList, currentUser] = await Promise.all([api.users.list(), api.auth.me()])
      setUsers(userList)
      setMe(currentUser)
    } catch {
      toast.error(t("Failed to load users"))
    } finally {
      setUsersLoading(false)
    }
  }

  async function loadKeys() {
    try {
      const keys = await api.apikeys.list()
      setApiKeys(keys ?? [])
    } catch {
      toast.error(t("Failed to load API keys"))
    } finally {
      setKeysLoading(false)
    }
  }

  async function loadAppUsers() {
    try {
      setAppUsers(await api.appUsers.list())
      setAppUsersError(null)
    } catch (e: unknown) {
      setAppUsersError(e instanceof Error ? e.message : t("Failed to load app users"))
    } finally {
      setAppUsersLoading(false)
    }
  }

  async function loadMounts() {
    try {
      setMounts(await api.mounts.list() ?? [])
    } catch {
      // The mount select just stays empty; the create dialog explains why.
    }
  }

  React.useEffect(() => {
    loadUsers()
    loadKeys()
    loadAppUsers()
    loadMounts()
  }, [])

  // ── User handlers ──────────────────────────────────────────────────────────

  async function handleAddUser() {
    if (!addForm.username || !addForm.password) return
    setAddSaving(true)
    try {
      await api.users.create(addForm)
      toast.success(t("User created"))
      setAddOpen(false)
      setAddForm({ username: "", password: "", role: "viewer" })
      await loadUsers()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? t(e.message) : t("Failed to create user"))
    } finally {
      setAddSaving(false)
    }
  }

  async function handleChangeRole(user: APIUser, role: Role) {
    try {
      await api.users.update(user.id, { role })
      toast.success(t("Role changed to {role}", { role: t(role) }))
      await loadUsers()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("Failed to update role"))
    }
  }

  async function handleChangePassword() {
    if (!pwTarget) return
    if (pwForm.password !== pwForm.confirm) { toast.error(t("Passwords do not match")); return }
    if (pwForm.password.length < 8) { toast.error(t("Password must be at least 8 characters")); return }
    setPwSaving(true)
    try {
      await api.users.update(pwTarget.id, { password: pwForm.password })
      toast.success(t("Password updated"))
      setPwTarget(null)
      setPwForm({ password: "", confirm: "" })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? t(e.message) : t("Failed to update password"))
    } finally {
      setPwSaving(false)
    }
  }

  async function handleDeleteUser() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.users.delete(deleteTarget.id)
      toast.success(t("User deleted"))
      setDeleteTarget(null)
      await loadUsers()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("Failed to delete user"))
    } finally {
      setDeleting(false)
    }
  }

  // ── API key handlers ───────────────────────────────────────────────────────

  function openKeyDialog() {
    setKeyForm({ name: "", expiresAt: "", ipAllowlist: "" })
    setKeyDialogMode("form")
    setCreatedKey(null)
    setKeyCopied(false)
    setKeyDialogOpen(true)
  }

  function closeKeyDialog() {
    setKeyDialogOpen(false)
    if (keyDialogMode === "reveal") loadKeys()
  }

  async function handleCreateKey() {
    if (!keyForm.name.trim()) return
    setKeySaving(true)
    try {
      const ipList = keyForm.ipAllowlist
        .split(/[\n,]+/)
        .map(s => s.trim())
        .filter(Boolean)
      const body: Parameters<typeof api.apikeys.create>[0] = { name: keyForm.name.trim() }
      if (keyForm.expiresAt) body.expires_at = keyForm.expiresAt
      if (ipList.length > 0) body.ip_allowlist = ipList
      const result = await api.apikeys.create(body)
      setCreatedKey(result)
      setKeyDialogMode("reveal")
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("Failed to create API key"))
    } finally {
      setKeySaving(false)
    }
  }

  async function handleCopyKey() {
    if (!createdKey) return
    await navigator.clipboard.writeText(createdKey.key)
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 2000)
  }

  async function handleToggleKey(k: APIKey) {
    try {
      await api.apikeys.update(k.id, { enabled: !k.enabled })
      await loadKeys()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("Failed to update key"))
    }
  }

  async function handleDeleteKey() {
    if (!deleteKeyTarget) return
    setDeletingKey(true)
    try {
      await api.apikeys.delete(deleteKeyTarget.id)
      toast.success(t("API key revoked"))
      setDeleteKeyTarget(null)
      await loadKeys()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("Failed to delete API key"))
    } finally {
      setDeletingKey(false)
    }
  }

  // ── App user handlers ──────────────────────────────────────────────────────

  const appQuery = appSearch.trim().toLowerCase()
  const filteredAppUsers = appQuery ? appUsers.filter(u => u.email.toLowerCase().includes(appQuery)) : appUsers

  const selectedMount = mounts.find(m => m.name === appForm.mountId)
  // Mount is optional, but a chosen mount must have a Radio Name (or a description to fall back on).
  const appFormValid = !!appForm.email.trim() && appForm.password.length >= 6 &&
    (!appForm.mountId || (!!selectedMount && !!effectiveRadioName(selectedMount)))

  function openAppDialog() {
    setAppForm(emptyAppForm)
    setAppOpen(true)
    loadMounts()
  }

  async function handleCreateAppUser() {
    if (!appFormValid) return
    setAppSaving(true)
    try {
      await api.appUsers.create({
        enabled:  appForm.enabled,
        email:    appForm.email.trim(),
        password: appForm.password,
        ...(appForm.mountId ? { mountId: appForm.mountId } : {}),
      })
      toast.success(t("App user created"))
      setAppOpen(false)
      await loadAppUsers()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? t(e.message) : t("Failed to create app user"))
    } finally {
      setAppSaving(false)
    }
  }

  async function handleToggleAppUser(u: AppUser) {
    setAppUsers(list => list.map(x => x.email === u.email ? { ...x, enabled: !u.enabled } : x))
    try {
      await api.appUsers.setEnabled(u.email, !u.enabled)
    } catch (e: unknown) {
      setAppUsers(list => list.map(x => x.email === u.email ? { ...x, enabled: u.enabled } : x))
      toast.error(e instanceof Error ? t(e.message) : t("Failed to update app user"))
    }
  }

  async function handleDeleteAppUser() {
    if (!deleteAppTarget) return
    setDeletingApp(true)
    try {
      await api.appUsers.delete(deleteAppTarget.email)
      setAppUsers(list => list.filter(x => x.email !== deleteAppTarget.email))
      toast.success(t("App user deleted"))
      setDeleteAppTarget(null)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? t(e.message) : t("Failed to delete app user"))
    } finally {
      setDeletingApp(false)
    }
  }

  const isSelf = (u: APIUser) => me?.id === u.id

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-ink-100">{t("Access & Auth")}</h1>
        <p className="text-[12.5px] text-ink-400 mt-1">{t("Manage users and API credentials")}</p>
      </div>

      {/* ── Users table ─────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-ink-800 bg-ink-900">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-800">
          <h2 className="text-[13px] font-semibold text-ink-100">{t("Users")}</h2>
          <button onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium bg-k-500 text-white hover:bg-k-600 transition-colors">
            <Plus className="h-3.5 w-3.5" />
            {t("Add User")}
          </button>
        </div>

        <div className="divide-y divide-ink-800">
          <div className="grid grid-cols-[1fr_120px_110px_36px] gap-3 px-4 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("Username")}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("Role")}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("Added")}</span>
            <span />
          </div>

          {usersLoading ? (
            [0, 1].map(i => (
              <div key={i} className="grid grid-cols-[1fr_120px_110px_36px] gap-3 px-4 py-3 items-center">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-6 rounded" />
              </div>
            ))
          ) : users.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12.5px] text-ink-500">{t("No users found")}</div>
          ) : (
            users.map(user => (
              <div key={user.id} className="grid grid-cols-[1fr_120px_110px_36px] gap-3 px-4 py-3 items-center">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-ink-100 font-medium">{user.username}</span>
                  {isSelf(user) && (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-k-500/15 text-k-400 border border-k-500/25">
                      {t("you")}
                    </span>
                  )}
                </div>
                <RoleBadge role={user.role} />
                <span className="text-[12px] text-ink-500">{relativeTime(user.created_at, t)}</span>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-ink-400 hover:text-ink-100">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="text-xs">{t("Change Role")}</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {(["admin", "operator", "viewer"] as Role[]).map(role => (
                          <DropdownMenuItem
                            key={role}
                            className="text-xs"
                            disabled={user.role === role}
                            onClick={() => handleChangeRole(user, role)}
                          >
                            {t(role === "admin" ? "Admin" : role === "operator" ? "Operator" : "Viewer")}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem
                      className="text-xs"
                      onClick={() => { setPwTarget(user); setPwForm({ password: "", confirm: "" }) }}
                    >
                      {t("Change Password")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-xs text-red-400 focus:text-red-400 focus:bg-red-500/10"
                      disabled={isSelf(user)}
                      onClick={() => setDeleteTarget(user)}
                    >
                      {t("Delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── API Keys table ───────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-ink-800 bg-ink-900">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-800">
          <h2 className="text-[13px] font-semibold text-ink-100">{t("API Keys")}</h2>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={openKeyDialog}>
            <Plus className="h-3.5 w-3.5" />
            {t("Create Key")}
          </Button>
        </div>

        <div className="divide-y divide-ink-800">
          <div className="grid grid-cols-[1fr_90px_100px_90px_90px_44px_36px] gap-3 px-4 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("Name")}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("Prefix")}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("IP Allowlist")}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("Last used")}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("Expires")}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("On")}</span>
            <span />
          </div>

          {keysLoading ? (
            [0, 1].map(i => (
              <div key={i} className="grid grid-cols-[1fr_90px_100px_90px_90px_44px_36px] gap-3 px-4 py-3 items-center">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-8 rounded-full" />
                <Skeleton className="h-6 w-6 rounded" />
              </div>
            ))
          ) : apiKeys.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12.5px] text-ink-500">
              {t("No API keys — create one to enable programmatic access")}
            </div>
          ) : (
            apiKeys.map(k => (
              <div key={k.id} className="grid grid-cols-[1fr_90px_100px_90px_90px_44px_36px] gap-3 px-4 py-3 items-center">
                <span className="text-[13px] text-ink-100 font-medium truncate">{k.name}</span>
                <code className="text-[11px] text-ink-400 font-mono">{k.prefix}…</code>
                <span className="text-[12px] text-ink-500">
                  {k.ip_allowlist.length === 0
                    ? <span className="text-ink-600">{t("any")}</span>
                    : <span title={k.ip_allowlist.join("\n")}>{tn(k.ip_allowlist.length, "{n} IP", "{n} IPs")}</span>
                  }
                </span>
                <span className="text-[12px] text-ink-500">{relativeTime(k.last_used_at, t)}</span>
                <span className={`text-[12px] ${k.expires_at && new Date(k.expires_at) < new Date() ? "text-red-400" : "text-ink-500"}`}>
                  {formatExpiry(k.expires_at, t, lang)}
                </span>
                <Switch
                  checked={k.enabled}
                  onCheckedChange={() => handleToggleKey(k)}
                  className="data-[state=checked]:bg-k-500"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-ink-500 hover:text-red-400"
                  onClick={() => setDeleteKeyTarget(k)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── App users table (Firebase) ───────────────────────────────────────── */}
      <div className="rounded-lg border border-ink-800 bg-ink-900">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-800">
          <h2 className="text-[13px] font-semibold text-ink-100">{t("App Users")}</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
              <Input
                type="search"
                value={appSearch}
                onChange={e => setAppSearch(e.target.value)}
                placeholder={t("Search by e-mail")}
                aria-label={t("Search by e-mail")}
                className="h-7 w-48 sm:w-60 pl-7 text-xs"
              />
            </div>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={openAppDialog}>
              <Plus className="h-3.5 w-3.5" />
              {t("Add new user")}
            </Button>
          </div>
        </div>

        <div className="divide-y divide-ink-800">
          <div className="grid grid-cols-[1fr_140px_1fr_44px_36px] gap-3 px-4 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("E-mail")}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("Mount")}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("Radio Name")}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t("On")}</span>
            <span />
          </div>

          {/* Rows scroll inside the box so a long list doesn't stretch the page. */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-ink-800">
          {appUsersLoading ? (
            [0, 1].map(i => (
              <div key={i} className="grid grid-cols-[1fr_140px_1fr_44px_36px] gap-3 px-4 py-3 items-center">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-8 rounded-full" />
                <Skeleton className="h-6 w-6 rounded" />
              </div>
            ))
          ) : appUsersError ? (
            <div className="px-4 py-10 text-center text-[12.5px] text-red-400">{t(appUsersError)}</div>
          ) : appUsers.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12.5px] text-ink-500">{t("No app users yet")}</div>
          ) : filteredAppUsers.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12.5px] text-ink-500">{t("No users match \"{query}\"", { query: appSearch.trim() })}</div>
          ) : (
            filteredAppUsers.map(u => (
              <div key={u.email} className="grid grid-cols-[1fr_140px_1fr_44px_36px] gap-3 px-4 py-3 items-center">
                <span className="text-[13px] text-ink-100 font-medium truncate">{u.email}</span>
                <code className="text-[11.5px] text-ink-400 font-mono truncate">{u.mountId || "—"}</code>
                <span className="text-[12px] text-ink-400 truncate">{u.radioName || "—"}</span>
                <Switch
                  checked={u.enabled}
                  onCheckedChange={() => handleToggleAppUser(u)}
                  className="data-[state=checked]:bg-k-500"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-ink-500 hover:text-red-400"
                  aria-label={t("Delete")}
                  onClick={() => setDeleteAppTarget(u)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
          </div>
        </div>
      </div>

      {/* ── Delete App User AlertDialog ───────────────────────────────────────── */}
      <AlertDialog open={!!deleteAppTarget} onOpenChange={open => { if (!open && !deletingApp) setDeleteAppTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete \"{name}\"?", { name: deleteAppTarget?.email ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("This removes the Firebase login and the app user's data. The user will no longer be able to sign in to the app. This cannot be undone.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingApp}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deletingApp}
              onClick={e => { e.preventDefault(); handleDeleteAppUser() }}
            >
              {deletingApp ? t("Deleting…") : t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Add App User Dialog ──────────────────────────────────────────────── */}
      <Dialog open={appOpen} onOpenChange={open => { if (!appSaving) setAppOpen(open) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("Add new user")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t("Enabled")}</Label>
              <Switch
                checked={appForm.enabled}
                onCheckedChange={v => setAppForm(f => ({ ...f, enabled: v }))}
                className="data-[state=checked]:bg-k-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("E-mail")}</Label>
              <Input
                type="email"
                value={appForm.email}
                onChange={e => setAppForm(f => ({ ...f, email: e.target.value }))}
                placeholder="user@example.com"
                autoComplete="off"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Password")}</Label>
              <Input
                type="password"
                value={appForm.password}
                onChange={e => setAppForm(f => ({ ...f, password: e.target.value }))}
                placeholder={t("Min. 6 characters")}
                autoComplete="new-password"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Mount")} <span className="text-ink-500 font-normal">{t("(optional)")}</span></Label>
              {/* Radix Select can't use "" as an item value, so "No mount" maps to a sentinel. */}
              <Select
                value={appForm.mountId || NO_MOUNT}
                onValueChange={v => setAppForm(f => ({ ...f, mountId: v === NO_MOUNT ? "" : v }))}
              >
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MOUNT}><span className="text-ink-400">{t("No mount")}</span></SelectItem>
                  {mounts.map(m => (
                    <SelectItem key={m.id} value={m.name}>
                      <span className="font-mono">{m.name}</span>
                      {effectiveRadioName(m) && <span className="text-ink-500"> — {effectiveRadioName(m)}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedMount && !effectiveRadioName(selectedMount) && (
                <p className="text-[11.5px] text-amber-400">
                  {t("This mount has no Radio Name — set it on the mount first")}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAppOpen(false)} disabled={appSaving}>{t("Cancel")}</Button>
            <Button size="sm" onClick={handleCreateAppUser} disabled={appSaving || !appFormValid}>
              {appSaving ? t("Creating…") : t("Create User")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add User Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("Add User")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Username")}</Label>
              <Input
                value={addForm.username}
                onChange={e => setAddForm(f => ({ ...f, username: e.target.value }))}
                placeholder="alice"
                autoComplete="off"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Password")}</Label>
              <Input
                type="password"
                value={addForm.password}
                onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                placeholder={t("Min. 8 characters")}
                autoComplete="new-password"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Role")}</Label>
              <Select value={addForm.role} onValueChange={v => setAddForm(f => ({ ...f, role: v as Role }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t("Admin")}</SelectItem>
                  <SelectItem value="operator">{t("Operator")}</SelectItem>
                  <SelectItem value="viewer">{t("Viewer")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)} disabled={addSaving}>{t("Cancel")}</Button>
            <Button size="sm" onClick={handleAddUser} disabled={addSaving || !addForm.username || !addForm.password}>
              {addSaving ? t("Creating…") : t("Create User")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Change Password Dialog ───────────────────────────────────────────── */}
      <Dialog open={!!pwTarget} onOpenChange={open => { if (!open) setPwTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("Change Password — {name}", { name: pwTarget?.username ?? "" })}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("New Password")}</Label>
              <Input
                type="password"
                value={pwForm.password}
                onChange={e => setPwForm(f => ({ ...f, password: e.target.value }))}
                placeholder={t("Min. 8 characters")}
                autoComplete="new-password"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Confirm Password")}</Label>
              <Input
                type="password"
                value={pwForm.confirm}
                onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                placeholder={t("Repeat password")}
                autoComplete="new-password"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPwTarget(null)} disabled={pwSaving}>{t("Cancel")}</Button>
            <Button size="sm" onClick={handleChangePassword} disabled={pwSaving || !pwForm.password || !pwForm.confirm}>
              {pwSaving ? t("Saving…") : t("Update Password")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete User AlertDialog ──────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete \"{name}\"?", { name: deleteTarget?.username ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("This action cannot be undone. The user will immediately lose access.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleting}
              onClick={handleDeleteUser}
            >
              {deleting ? t("Deleting…") : t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Create API Key Dialog ────────────────────────────────────────────── */}
      <Dialog open={keyDialogOpen} onOpenChange={open => { if (!open) closeKeyDialog() }}>
        <DialogContent className="sm:max-w-sm">
          {keyDialogMode === "form" ? (
            <>
              <DialogHeader><DialogTitle>{t("Create API Key")}</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("Name")}</Label>
                  <Input
                    value={keyForm.name}
                    onChange={e => setKeyForm(f => ({ ...f, name: e.target.value }))}
                    placeholder={t("e.g. CI pipeline")}
                    autoComplete="off"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("Expires")} <span className="text-ink-500 font-normal">{t("(optional)")}</span></Label>
                  <Input
                    type="date"
                    value={keyForm.expiresAt}
                    onChange={e => setKeyForm(f => ({ ...f, expiresAt: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("IP Allowlist")} <span className="text-ink-500 font-normal">{t("(optional — one IP or CIDR per line)")}</span></Label>
                  <Textarea
                    value={keyForm.ipAllowlist}
                    onChange={e => setKeyForm(f => ({ ...f, ipAllowlist: e.target.value }))}
                    placeholder={"192.168.1.0/24\n10.0.0.1"}
                    rows={3}
                    className="text-sm font-mono resize-none"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={closeKeyDialog} disabled={keySaving}>{t("Cancel")}</Button>
                <Button size="sm" onClick={handleCreateKey} disabled={keySaving || !keyForm.name.trim()}>
                  {keySaving ? t("Creating…") : t("Create Key")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader><DialogTitle>{t("API Key Created")}</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-[12px] text-ink-400 leading-relaxed">
                  {tx("Copy your key now — it will {never} again.", { never: <strong className="text-ink-200">{t("not be shown")}</strong> })}
                </p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={createdKey?.key ?? ""}
                    className="h-8 text-xs font-mono flex-1"
                    onClick={e => (e.target as HTMLInputElement).select()}
                  />
                  <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={handleCopyKey}>
                    {keyCopied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {createdKey && createdKey.ip_allowlist.length > 0 && (
                  <p className="text-[11.5px] text-ink-500">
                    {t("Restricted to: {ips}", { ips: createdKey.ip_allowlist.join(", ") })}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button size="sm" onClick={closeKeyDialog}>{t("Done")}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete API Key AlertDialog ───────────────────────────────────────── */}
      <AlertDialog open={!!deleteKeyTarget} onOpenChange={open => { if (!open) setDeleteKeyTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Revoke \"{name}\"?", { name: deleteKeyTarget?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("This key will stop working immediately. Any clients using it will lose access.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingKey}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deletingKey}
              onClick={handleDeleteKey}
            >
              {deletingKey ? t("Revoking…") : t("Revoke Key")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
