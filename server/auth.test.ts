import { describe, expect, test } from 'vitest'
import { authFromEnv, authorized, isProtected, readTokens } from './auth.ts'

describe('readTokens', () => {
  test('keeps one value, several values, and nothing else', () => {
    expect(readTokens('secret')).toEqual(['secret'])
    expect(readTokens(' first , second ,, ')).toEqual(['first', 'second'])
    expect(readTokens(undefined)).toEqual([])
    expect(readTokens('   ')).toEqual([])
  })

  test('drops a repeated value instead of counting it twice', () => {
    expect(readTokens('a,b,a')).toEqual(['a', 'b'])
  })
})

describe('authFromEnv', () => {
  test('turns an empty variable into no check at all', () => {
    expect(authFromEnv(undefined)).toBeNull()
    expect(authFromEnv('')).toBeNull()
    expect(authFromEnv(' , ')).toBeNull()
  })

  test('locks the door when a token is configured', () => {
    expect(authFromEnv('secret')).toEqual({ tokens: ['secret'] })
  })
})

describe('isProtected', () => {
  test('guards the API and leaves the shell, the health probe and the PWA assets open', () => {
    expect(isProtected('/api/state')).toBe(true)
    expect(isProtected('/api/')).toBe(true)
    expect(isProtected('/health')).toBe(false)
    expect(isProtected('/assets/index-abc123.js')).toBe(false)
    expect(isProtected('/manifest.webmanifest')).toBe(false)
    expect(isProtected('/')).toBe(false)
  })
})

describe('authorized', () => {
  const auth = authFromEnv('secret')
  const open = null

  test('answers yes to everybody while no token is configured', () => {
    expect(authorized({}, open)).toBe(true)
    expect(authorized({ authorization: 'Bearer anything' }, open)).toBe(true)
  })

  test('accepts the token as a bearer, whatever the case of the scheme', () => {
    expect(authorized({ authorization: 'Bearer secret' }, auth)).toBe(true)
    expect(authorized({ authorization: 'bearer secret' }, auth)).toBe(true)
    expect(authorized({ authorization: 'Bearer   secret  ' }, auth)).toBe(true)
  })

  test('refuses a wrong token, another scheme, or no credential at all', () => {
    expect(authorized({ authorization: 'Bearer wrong' }, auth)).toBe(false)
    expect(authorized({ authorization: 'Bearer secre' }, auth)).toBe(false)
    expect(authorized({ authorization: 'Bearer ' }, auth)).toBe(false)
    expect(authorized({ authorization: 'Basic secret' }, auth)).toBe(false)
    // The scheme is a word of its own: a header that only starts with the letters
    // is not a bearer, and neither is the scheme with no whitespace after it.
    expect(authorized({ authorization: 'bearerx secret' }, auth)).toBe(false)
    expect(authorized({ authorization: 'bearersecret' }, auth)).toBe(false)
    expect(authorized({ authorization: 'Bearer' }, auth)).toBe(false)
    expect(authorized({}, auth)).toBe(false)
  })

  test('accepts any token of a rotation', () => {
    const rotating = authFromEnv('old,new')
    expect(authorized({ authorization: 'Bearer old' }, rotating)).toBe(true)
    expect(authorized({ authorization: 'Bearer new' }, rotating)).toBe(true)
    expect(authorized({ authorization: 'Bearer other' }, rotating)).toBe(false)
  })

  test('accepts the identity the forward auth leaves on a browser request', () => {
    expect(authorized({ 'x-auth-request-preferred-username': 'olivier' }, auth)).toBe(true)
    expect(authorized({ 'x-auth-request-preferred-username': ['olivier'] }, auth)).toBe(true)
    // An empty header, repeated or not, is what a stripped or missing identity
    // looks like.
    expect(authorized({ 'x-auth-request-preferred-username': '' }, auth)).toBe(false)
    expect(authorized({ 'x-auth-request-preferred-username': [] }, auth)).toBe(false)
  })

  test('keeps the two doors independent', () => {
    // The ingress is what keeps them apart: the agent route strips the identity
    // header, the page route only lets a session through the forward auth. This
    // function trusts that decision, so a browser that also sent a bearer is not
    // refused for it.
    expect(
      authorized(
        { authorization: 'Bearer wrong', 'x-auth-request-preferred-username': 'olivier' },
        auth
      )
    ).toBe(true)
  })
})
