import { describe, expect, it } from 'vitest'
import { authFromEnv, authorized, isProtected, readTokens } from './auth.ts'

describe('readTokens', () => {
  it('keeps one value, several values, and nothing else', () => {
    expect(readTokens('secret')).toEqual(['secret'])
    expect(readTokens(' first , second ,, ')).toEqual(['first', 'second'])
    expect(readTokens(undefined)).toEqual([])
    expect(readTokens('   ')).toEqual([])
  })

  it('drops a repeated value instead of counting it twice', () => {
    expect(readTokens('a,b,a')).toEqual(['a', 'b'])
  })
})

describe('authFromEnv', () => {
  it('turns an empty variable into no check at all', () => {
    expect(authFromEnv(undefined)).toBeNull()
    expect(authFromEnv('')).toBeNull()
    expect(authFromEnv(' , ')).toBeNull()
  })

  it('locks the door when a token is configured', () => {
    expect(authFromEnv('secret')).toEqual({ tokens: ['secret'] })
  })
})

describe('isProtected', () => {
  it('guards the API and leaves the shell, the health probe and the PWA assets open', () => {
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

  it('answers yes to everybody while no token is configured', () => {
    expect(authorized({}, open)).toBe(true)
    expect(authorized({ authorization: 'Bearer anything' }, open)).toBe(true)
  })

  it('accepts the token as a bearer, whatever the case of the scheme', () => {
    expect(authorized({ authorization: 'Bearer secret' }, auth)).toBe(true)
    expect(authorized({ authorization: 'bearer secret' }, auth)).toBe(true)
    expect(authorized({ authorization: 'Bearer   secret  ' }, auth)).toBe(true)
  })

  it('refuses a wrong token, another scheme, or no credential at all', () => {
    expect(authorized({ authorization: 'Bearer wrong' }, auth)).toBe(false)
    expect(authorized({ authorization: 'Bearer secre' }, auth)).toBe(false)
    expect(authorized({ authorization: 'Bearer ' }, auth)).toBe(false)
    expect(authorized({ authorization: 'Basic secret' }, auth)).toBe(false)
    expect(authorized({}, auth)).toBe(false)
  })

  it('accepts any token of a rotation', () => {
    const rotating = authFromEnv('old,new')
    expect(authorized({ authorization: 'Bearer old' }, rotating)).toBe(true)
    expect(authorized({ authorization: 'Bearer new' }, rotating)).toBe(true)
    expect(authorized({ authorization: 'Bearer other' }, rotating)).toBe(false)
  })

  it('accepts the identity the forward auth leaves on a browser request', () => {
    expect(authorized({ 'x-auth-request-preferred-username': 'olivier' }, auth)).toBe(true)
    expect(authorized({ 'x-auth-request-preferred-username': ['olivier'] }, auth)).toBe(true)
    // An empty header, repeated or not, is what a stripped or missing identity
    // looks like.
    expect(authorized({ 'x-auth-request-preferred-username': '' }, auth)).toBe(false)
    expect(authorized({ 'x-auth-request-preferred-username': [] }, auth)).toBe(false)
  })

  it('keeps the two doors independent', () => {
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
