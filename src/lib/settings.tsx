import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import en from '@/locales/en.json'
import fr from '@/locales/fr.json'

const langNames = ['en', 'fr'] as const
export type Lang = 'auto' | ResolvedLang
export type Theme = 'auto' | 'dark' | 'light'
export type ResolvedLang = (typeof langNames)[number]
export type Translate = (key: string, vars?: Record<string, string | number>) => string

type Dictionary = typeof en

const dictionaries: Record<ResolvedLang, Dictionary> = { en, fr }
const supportedLangs: ReadonlySet<string> = new Set(langNames)
const storagePrefix = 'wiim-hub:'

const isResolvedLang = (value: string): value is ResolvedLang => supportedLangs.has(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readPreference = (key: string): string | null => {
  try {
    return localStorage.getItem(storagePrefix + key)
  } catch {
    return null
  }
}

const writePreference = (key: string, value: string): void => {
  try {
    localStorage.setItem(storagePrefix + key, value)
  } catch {
    // private mode: the choice still applies for this session
  }
}

const pickLang = (): ResolvedLang => {
  const tags = navigator.languages.length > 0 ? navigator.languages : [navigator.language]
  for (const tag of tags) {
    const base = tag.toLowerCase().split(/[-_]/)[0]
    if (isResolvedLang(base)) return base
  }
  return 'en'
}

const lookup = (dictionary: Dictionary, path: string): string | undefined => {
  let node: unknown = dictionary
  for (const part of path.split('.')) {
    if (!isRecord(node)) return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

// A missing translation falls back to English, then prints its own key: the
// gap shows up in the page instead of breaking the render.
const translate = (
  dictionary: Dictionary,
  key: string,
  vars: Record<string, string | number>
): string => {
  const template = lookup(dictionary, key) ?? lookup(en, key) ?? key
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''))
}

type SettingsValue = {
  lang: Lang
  theme: Theme
  resolvedLang: ResolvedLang
  resolvedTheme: 'dark' | 'light'
  setLang: (lang: Lang) => void
  setTheme: (theme: Theme) => void
  t: Translate
}

const SettingsContext = createContext<SettingsValue | null>(null)

const readLang = (): Lang => {
  const stored = readPreference('lang')
  return stored === 'en' || stored === 'fr' ? stored : 'auto'
}

const readTheme = (): Theme => {
  const stored = readPreference('theme')
  return stored === 'dark' || stored === 'light' ? stored : 'auto'
}

export const SettingsProvider = ({ children }: Readonly<{ children: ReactNode }>) => {
  const [lang, setLang] = useState<Lang>(readLang)
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [dark, setDark] = useState(false)
  const resolvedLang = lang === 'auto' ? pickLang() : lang
  const dictionary = dictionaries[resolvedLang]

  const t = useCallback<Translate>(
    (key, vars = {}) => translate(dictionary, key, vars),
    [dictionary]
  )

  // The exposed setters write the preference as well as the state, so the state
  // hook keeps its plain `[value, setter]` shape.
  const updateLang = useCallback((next: Lang) => {
    setLang(next)
    writePreference('lang', next)
  }, [])

  const updateTheme = useCallback((next: Theme) => {
    setTheme(next)
    writePreference('theme', next)
  }, [])

  // The system preference is read live, so "Auto" follows the desktop without
  // a reload; an explicit choice simply stops listening.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'auto' && media.matches)
      const root = document.documentElement
      root.classList.toggle('dark', dark)
      root.dataset.theme = dark ? 'dark' : 'light'
      root.style.colorScheme = dark ? 'dark' : 'light'
      setDark(dark)
    }
    apply()
    if (theme !== 'auto') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = resolvedLang
  }, [resolvedLang])

  const value = useMemo<SettingsValue>(
    () => ({
      lang,
      theme,
      resolvedLang,
      resolvedTheme: dark ? 'dark' : 'light',
      setLang: updateLang,
      setTheme: updateTheme,
      t,
    }),
    [lang, theme, resolvedLang, dark, updateLang, updateTheme, t]
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export const useSettings = (): SettingsValue => {
  const value = useContext(SettingsContext)
  if (value === null) throw new Error('useSettings must be used inside SettingsProvider')
  return value
}
