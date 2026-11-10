import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { type Lang, pickLang, type ResolvedLang, type Translate, translate } from '@/lib/i18n'

export type { Lang, ResolvedLang, Translate }

export type Theme = 'auto' | 'dark' | 'light'

const storagePrefix = 'wiim-hub:'

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
  const resolvedLang =
    lang === 'auto'
      ? pickLang(navigator.languages.length > 0 ? navigator.languages : [navigator.language])
      : lang

  const t = useCallback<Translate>(
    (key, vars = {}) => translate(resolvedLang, key, vars),
    [resolvedLang]
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
