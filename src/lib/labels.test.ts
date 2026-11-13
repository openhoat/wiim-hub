import { describe, expect, test } from 'vitest'
import { type ResolvedLang, type Translate, translate } from './i18n'
import {
  agoLabel,
  controlErrorLabel,
  eventKindLabel,
  eventText,
  inputLabel,
  isExternalInput,
  statusLabel,
} from './labels'
import type { DeviceEvent } from './types'

const tFor =
  (locale: ResolvedLang): Translate =>
  (key, vars) =>
    translate(locale, key, vars)

const now = Date.UTC(2026, 0, 2, 12, 0, 0)

describe('statusLabel', () => {
  test('translates a known state and prints an unknown one as it came', () => {
    expect(statusLabel(tFor('en'), 'play')).toBe('playing')
    expect(statusLabel(tFor('fr'), 'play')).toBe('en lecture')
    expect(statusLabel(tFor('en'), 'buffering')).toBe('buffering')
    expect(statusLabel(tFor('en'), '')).toBe('idle')
  })
})

describe('eventKindLabel', () => {
  test('names the kind, or keeps the token', () => {
    expect(eventKindLabel(tFor('fr'), 'offline')).toBe('appareil injoignable')
  })
})

describe('inputLabel', () => {
  test('prefers the name the user set, then the built-in one, then the id', () => {
    expect(inputLabel(tFor('en'), { optical: 'TV' }, 'optical')).toBe('TV')
    expect(inputLabel(tFor('en'), {}, 'optical')).toBe('Optical input')
    expect(inputLabel(tFor('en'), { optical: '' }, 'spdif')).toBe('spdif')
  })

  test('knows the inputs that carry a signal rather than a track', () => {
    expect(isExternalInput('optical')).toBe(true)
    expect(isExternalInput('wifi')).toBe(false)
  })
})

describe('eventText', () => {
  const event = (kind: DeviceEvent['kind'], from: string, to: string): DeviceEvent => ({
    t: now,
    kind,
    from,
    to,
  })

  test('composes a status transition in the selected language', () => {
    expect(eventText(tFor('en'), event('status', 'play', 'pause'))).toBe('playing → paused')
    expect(eventText(tFor('fr'), event('status', 'play', 'pause'))).toBe('en lecture → en pause')
  })

  test('prints a track as the device named it', () => {
    expect(eventText(tFor('en'), event('track', '', 'Late Ferry'))).toBe('Late Ferry')
  })

  test('has no sentence for a reachability change, which the row already states', () => {
    expect(eventText(tFor('en'), event('online', '', ''))).toBe('')
  })
})

describe('controlErrorLabel', () => {
  test('distinguishes a firmware refusal from a failed value', () => {
    expect(controlErrorLabel(tFor('en'), null)).toBe('')
    expect(controlErrorLabel(tFor('en'), 'unsupported')).toBe(
      'This player does not accept that command.'
    )
    expect(controlErrorLabel(tFor('en'), 'invalid volume level')).toBe(
      'Command failed: invalid volume level'
    )
    expect(controlErrorLabel(tFor('fr'), 'invalid volume level')).toBe(
      'Échec de la commande : invalid volume level'
    )
  })
})

describe('agoLabel', () => {
  test('says never when nothing was seen', () => {
    expect(agoLabel(tFor('en'), 'en', null, now)).toBe('never')
    expect(agoLabel(tFor('fr'), 'fr', null, now)).toBe('jamais')
  })

  test('drops to the coarser unit as the age grows, rounded down', () => {
    const en = tFor('en')
    expect(agoLabel(en, 'en', now, now)).toBe('now')
    expect(agoLabel(en, 'en', now - 30_000, now)).toBe('30 seconds ago')
    expect(agoLabel(en, 'en', now - 90_000, now)).toBe('1 minute ago')
    expect(agoLabel(en, 'en', now - 2 * 3_600_000, now)).toBe('2 hours ago')
    // 119 minutes is one hour and change, not two.
    expect(agoLabel(en, 'en', now - 7_140_000, now)).toBe('1 hour ago')
  })

  test('measures a long outage in days', () => {
    expect(agoLabel(tFor('en'), 'en', now - 3 * 86_400_000, now)).toBe('3 days ago')
  })

  test('writes the age in the language of the page', () => {
    const fr = tFor('fr')
    expect(agoLabel(fr, 'fr', now, now)).toBe('maintenant')
    expect(agoLabel(fr, 'fr', now - 90_000, now)).toBe('il y a 1 minute')
    expect(agoLabel(fr, 'fr', now - 3 * 86_400_000, now)).toBe('il y a 3 jours')
  })

  test('does not run backwards on a clock that is ahead', () => {
    expect(agoLabel(tFor('en'), 'en', now + 60_000, now)).toBe('now')
  })
})
