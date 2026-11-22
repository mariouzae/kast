"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Monitor, Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"

const options = [
  { value: "light",  label: "Light",  icon: Sun },
  { value: "dark",   label: "Dark",   icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const

/** Segmented Light / Dark / System switch. Choice persists in localStorage (next-themes). */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  return (
    <div
      role="radiogroup"
      aria-label={t("Colour theme")}
      className={cn("flex items-center border border-ink-800 bg-ink-950", className)}
    >
      {options.map(({ value, label, icon: Icon }) => {
        // Before mount the stored theme is unknown on the server; render
        // nothing as active to avoid a hydration mismatch.
        const active = mounted && theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={t("{theme} theme", { theme: t(label) })}
            onClick={() => setTheme(value)}
            className={cn(
              "h-7 w-7 flex items-center justify-center transition-colors",
              active ? "bg-ink-800 text-ink-100" : "text-ink-500 hover:text-ink-200",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        )
      })}
    </div>
  )
}
