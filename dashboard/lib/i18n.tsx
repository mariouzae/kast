"use client"

// Minimal dashboard i18n. Messages are keyed by their English text, so English
// needs no dictionary and any missing translation falls back to English.
// Only UI text goes through here — never values sent to the API.

import * as React from "react"
import { ptBR } from "@/lib/i18n-pt-BR"

export type Lang = "pt-BR" | "en"

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "en",    label: "English" },
]

export const DEFAULT_LANG: Lang = "pt-BR"
const STORAGE_KEY = "kast-lang"

const DICTS: Record<Lang, Record<string, string> | null> = {
  "pt-BR": ptBR,
  en: null,
}

type Vars = Record<string, string | number>

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

export type TFunc = (text: string, vars?: Vars) => string
/** Like t(), but placeholders may be React nodes: tx("Type {word} to confirm.", { word: <b>RESET</b> }). */
export type TxFunc = (text: string, nodes: Record<string, React.ReactNode>) => React.ReactNode
/** Plural helper: tn(n, "{n} track", "{n} tracks"). `n` is always available as {n}. */
export type TnFunc = (n: number, one: string, other: string, vars?: Vars) => string

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: TFunc; tn: TnFunc; tx: TxFunc }

function makeT(lang: Lang): { t: TFunc; tn: TnFunc; tx: TxFunc } {
  const dict = DICTS[lang]
  const t: TFunc = (text, vars) => interpolate(dict?.[text] ?? text, vars)
  const tn: TnFunc = (n, one, other, vars) => t(n === 1 ? one : other, { n, ...vars })
  const tx: TxFunc = (text, nodes) =>
    (dict?.[text] ?? text).split(/(\{\w+\})/).map((part, i) => {
      const m = /^\{(\w+)\}$/.exec(part)
      return <React.Fragment key={i}>{m && m[1] in nodes ? nodes[m[1]] : part}</React.Fragment>
    })
  return { t, tn, tx }
}

const I18nContext = React.createContext<Ctx>({ lang: DEFAULT_LANG, setLang: () => {}, ...makeT(DEFAULT_LANG) })

function readStoredLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && LANGUAGES.some((l) => l.code === v)) return v as Lang
  } catch {}
  return DEFAULT_LANG
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Server render uses the default; the stored choice is applied after mount.
  const [lang, setLangState] = React.useState<Lang>(DEFAULT_LANG)
  React.useEffect(() => { setLangState(readStoredLang()) }, [])
  React.useEffect(() => { document.documentElement.lang = lang }, [lang])

  const setLang = React.useCallback((l: Lang) => {
    setLangState(l)
    try { localStorage.setItem(STORAGE_KEY, l) } catch {}
  }, [])

  const value = React.useMemo(() => ({ lang, setLang, ...makeT(lang) }), [lang, setLang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return React.useContext(I18nContext)
}

/** Inline translation for shared UI pieces: <T>Close</T>. */
export function T({ children }: { children: string }) {
  const { t } = useI18n()
  return <>{t(children)}</>
}
