import en from '../locales/en.json'
import fr from '../locales/fr.json'
import { formatNumber } from './format'

const langNames = ['en', 'fr'] as const

export type ResolvedLang = (typeof langNames)[number]
export type Lang = 'auto' | ResolvedLang

export type Vars = Record<string, string | number>
export type Translate = (key: string, vars?: Vars) => string

// The English dictionary is the shape both locales must have: a key added on
// one side and forgotten on the other fails the type check instead of showing
// its own name at runtime.
type Dictionary = typeof en

const dictionaries: Record<ResolvedLang, Dictionary> = { en, fr }
const supportedLangs: ReadonlySet<string> = new Set(langNames)

const isResolvedLang = (value: string): value is ResolvedLang => supportedLangs.has(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// The browser announces its preference as an ordered tag list: the first one
// the page speaks wins, and English is the fallback.
export const pickLang = (tags: readonly string[]): ResolvedLang => {
  for (const tag of tags) {
    const base = tag.toLowerCase().split(/[-_]/)[0] ?? ''
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

const rules = new Map<string, Intl.PluralRules>()

const rulesFor = (locale: string): Intl.PluralRules => {
  const known = rules.get(locale)
  if (known !== undefined) return known
  const created = new Intl.PluralRules(locale)
  rules.set(locale, created)
  return created
}

// The index of the `}` closing the `{` at `open`, counting nested braces; -1
// when the template is unbalanced, which is a typo in a dictionary.
const closingBrace = (text: string, open: number): number => {
  let depth = 0
  for (let index = open; index < text.length; index++) {
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

// `{count, plural, one {# device} other {# devices}}`, with `#` standing for
// the count. An exact selector (`=0`) wins over the CLDR category, and a
// missing branch falls back to `other`, which every plural must carry.
const parseBranches = (body: string): Map<string, string> => {
  const branches = new Map<string, string>()
  let index = 0
  while (index < body.length) {
    const open = body.indexOf('{', index)
    if (open === -1) break
    const close = closingBrace(body, open)
    if (close === -1) break
    const selector = body.slice(index, open).trim()
    if (selector !== '') branches.set(selector, body.slice(open + 1, close))
    index = close + 1
  }
  return branches
}

const branchFor = (branches: Map<string, string>, count: number, locale: string): string => {
  const exact = branches.get(`=${count}`)
  if (exact !== undefined) return exact
  return branches.get(rulesFor(locale).select(count)) ?? branches.get('other') ?? ''
}

const argumentPattern = /^\s*(\w+)\s*(?:,\s*(\w+)\s*(?:,\s*([\s\S]*))?)?\s*$/

const render = (template: string, vars: Vars, locale: string, count: number | null): string => {
  let out = ''
  let index = 0
  while (index < template.length) {
    const char = template[index]
    if (char === '#' && count !== null) {
      out += formatNumber(count, locale)
      index += 1
      continue
    }
    if (char !== '{') {
      out += char
      index += 1
      continue
    }
    const close = closingBrace(template, index)
    if (close === -1) {
      out += template.slice(index)
      break
    }
    out += renderArgument(template.slice(index + 1, close), vars, locale)
    index = close + 1
  }
  return out
}

const renderArgument = (body: string, vars: Vars, locale: string): string => {
  const match = argumentPattern.exec(body)
  // An argument the parser does not know is printed as it came: a typo shows
  // up in the sentence instead of blanking it.
  if (match === null) return `{${body}}`
  const name = match[1] ?? ''
  const kind = match[2]
  const value = vars[name]
  if (kind === undefined) {
    if (value === undefined) return ''
    return typeof value === 'number' ? formatNumber(value, locale) : value
  }
  if (kind === 'number') return typeof value === 'number' ? formatNumber(value, locale) : ''
  if (kind !== 'plural') return `{${body}}`
  if (typeof value !== 'number') return value === undefined ? '' : value
  return render(branchFor(parseBranches(match[3] ?? ''), value, locale), vars, locale, value)
}

// The parser's own seam: `translate` only ever hands it a dictionary entry, so
// the edge cases (an unbalanced brace, an argument it does not know) would
// otherwise be untestable without polluting the locales.
export const renderTemplate = (template: string, locale: ResolvedLang, vars: Vars = {}): string =>
  render(template, vars, locale, null)

// A missing translation falls back to English, then prints its own key: the
// gap shows up in the page instead of breaking the render.
export const translate = (locale: ResolvedLang, key: string, vars: Vars = {}): string => {
  const template = lookup(dictionaries[locale], key) ?? lookup(en, key) ?? key
  return renderTemplate(template, locale, vars)
}
