import { describe, expect, it } from 'vitest'
import en from '../locales/en.json'
import fr from '../locales/fr.json'
import { pickLang, renderTemplate, translate } from './i18n'

// The two dictionaries are one contract: a key on one side and not the other is
// a sentence that silently falls back to English.
const isTree = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const flatten = (tree: Record<string, unknown>, prefix = ''): string[] => {
  const keys: string[] = []
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') keys.push(path)
    else if (isTree(value)) keys.push(...flatten(value, path))
  }
  return keys
}

const valuesOf = (tree: Record<string, unknown>): string[] => {
  const values: string[] = []
  for (const value of Object.values(tree)) {
    if (typeof value === 'string') values.push(value)
    else if (isTree(value)) values.push(...valuesOf(value))
  }
  return values
}

const entries = (tree: Record<string, unknown>, prefix = ''): [string, string][] => {
  const found: [string, string][] = []
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') found.push([path, value])
    else if (isTree(value)) found.push(...entries(value, path))
  }
  return found
}

describe('dictionaries', () => {
  it('carries the same keys in both languages', () => {
    expect(flatten(fr).sort()).toEqual(flatten(en).sort())
  })

  it('leaves no "(s)" behind: a plural is a plural, in both languages', () => {
    for (const value of [...valuesOf(en), ...valuesOf(fr)]) expect(value).not.toContain('(s)')
  })

  it('renders every entry in both languages with nothing left to fill', () => {
    // Every variable gets 2: a plural takes its `other` branch, and a template
    // this test cannot fill would show the brace it forgot.
    for (const locale of ['en', 'fr'] as const) {
      const dictionary = locale === 'en' ? en : fr
      for (const [key, template] of entries(dictionary)) {
        const vars = Object.fromEntries(
          [...template.matchAll(/\{(\w+)/g)].map(match => [match[1] ?? '', 2])
        )
        expect(translate(locale, key, vars), `${locale} ${key}`).not.toMatch(/[{}]/)
      }
    }
  })
})

describe('variables', () => {
  it('interpolates a string and a number', () => {
    expect(translate('en', 'rssi', { value: -55 })).toBe('-55 dBm')
    expect(translate('en', 'hosts.failed', { reason: 'clash' })).toBe('The hub refused: clash')
  })

  it('formats a number the way the locale writes it', () => {
    expect(translate('en', 'findings.checked.flash', { bad: 1234, total: 8192 })).toBe(
      'flash 1,234/8,192 bad blocks'
    )
    // French groups with a no-break space, the one every Chromium renders.
    expect(translate('fr', 'findings.checked.flash', { bad: 1234, total: 8192 })).toBe(
      'flash 1\u00a0234/8\u00a0192 blocs défectueux'
    )
  })

  it('prints a missing variable as nothing rather than as a brace', () => {
    expect(renderTemplate('a {one} b {two}', 'en', { one: 'x' })).toBe('a x b ')
  })

  it('falls back to English, then to the key itself', () => {
    expect(translate('fr', 'title')).toBe('WiiM Hub')
    expect(translate('fr', 'no.such.key')).toBe('no.such.key')
  })
})

describe('plurals', () => {
  it('picks the English branch the count asks for', () => {
    expect(translate('en', 'added', { count: 1 })).toBe('1 device found')
    expect(translate('en', 'added', { count: 3 })).toBe('3 devices found')
    expect(translate('en', 'group.members', { n: 2 })).toBe('2 speakers')
  })

  it('follows the French rule, where zero is singular too', () => {
    expect(translate('fr', 'added', { count: 0 })).toBe('0 appareil trouvé')
    expect(translate('fr', 'added', { count: 1 })).toBe('1 appareil trouvé')
    expect(translate('fr', 'added', { count: 2 })).toBe('2 appareils trouvés')
  })

  it('falls back to `other` when the category has no branch', () => {
    // A million selects `many` in French, and neither locale carries that branch.
    expect(translate('fr', 'added', { count: 1_000_000 })).toBe(
      '1\u00a0000\u00a0000 appareils trouvés'
    )
  })

  it('lets an exact selector win over the category', () => {
    const template = '{n, plural, =0 {none} one {# one} other {# many}}'
    expect(renderTemplate(template, 'en', { n: 0 })).toBe('none')
    expect(renderTemplate(template, 'en', { n: 1 })).toBe('1 one')
    expect(renderTemplate(template, 'en', { n: 5 })).toBe('5 many')
  })

  it('renders a nested argument inside a branch', () => {
    const template = '{n, plural, one {# {unit}} other {# {unit}s}}'
    expect(renderTemplate(template, 'en', { n: 1, unit: 'speaker' })).toBe('1 speaker')
    expect(renderTemplate(template, 'en', { n: 4, unit: 'speaker' })).toBe('4 speakers')
  })

  it('formats a value the template asks for as a number', () => {
    expect(renderTemplate('{n, number} units', 'fr', { n: 1234.5 })).toBe('1\u00a0234,5 units')
    // A string where a number was announced is not worth a crash.
    expect(renderTemplate('{n, number} units', 'en', { n: 'many' })).toBe(' units')
  })

  it('leaves a plural whose count is not a number alone', () => {
    expect(renderTemplate('{n, plural, one {# item} other {# items}}', 'en', { n: 'some' })).toBe(
      'some'
    )
    expect(renderTemplate('{n, plural, one {# item} other {# items}}', 'en')).toBe('')
  })

  it('composes the whole sentence, verb included', () => {
    expect(translate('en', 'findings.crashCounters', { count: 1 })).toBe(
      '1 crash counter is non zero: the firmware restarted.'
    )
    expect(translate('en', 'findings.upnpActionsLost', { lost: 2, total: 9 })).toBe(
      '2 UPnP actions were lost out of 9.'
    )
    expect(translate('fr', 'findings.upnpActionsLost', { lost: 2, total: 9 })).toBe(
      '2 actions UPnP ont été perdues sur 9.'
    )
  })
})

describe('parser guards', () => {
  it('prints an argument it does not know as it came', () => {
    expect(renderTemplate('a {n, fancy} b', 'en', { n: 2 })).toBe('a {n, fancy} b')
    expect(renderTemplate('a { } b', 'en')).toBe('a { } b')
  })

  it('keeps the rest of an unbalanced template instead of throwing', () => {
    expect(renderTemplate('a {n b', 'en', { n: 1 })).toBe('a {n b')
  })

  it('numbers a `#` only inside a plural branch', () => {
    expect(renderTemplate('# is not a count here', 'en')).toBe('# is not a count here')
    expect(renderTemplate('{n, plural, other {#}}', 'en', { n: 1234 })).toBe('1,234')
  })
})

describe('pickLang', () => {
  it('takes the first tag the page speaks', () => {
    expect(pickLang(['fr-CA', 'en'])).toBe('fr')
    expect(pickLang(['de-DE', 'en-GB'])).toBe('en')
    expect(pickLang(['de-DE', 'it'])).toBe('en')
    expect(pickLang([])).toBe('en')
  })
})
