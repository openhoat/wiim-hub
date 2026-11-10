import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

// The hub has two ways in, and they answer different needs.
//
// A browser carries a session cookie, never a secret the page knows: the SSO
// in front of the hub authenticates it, and its forward auth copies an identity
// header onto the request. An agent carries a token, because a session dies
// with a cookie jar and a long-lived process has no browser to log in with.
//
// `WIIM_HUB_TOKEN` is that token, one value or several comma separated for a
// rotation. Unset, the hub keeps working as it always did, on the trust of the
// network it sits on: a demo, a LAN-only install and the test suite all rely on
// it.

export type Auth = { tokens: string[] } | null

// Written by oauth2-proxy (`--set-xauthrequest`) and copied to the upstream by
// the forward auth, so a request carrying it went through the SSO. It is only a
// proof because the ingress strips it from every other way in: a header a
// client can set itself proves nothing.
export const identityHeader = 'x-auth-request-preferred-username'

const digest = (value: string): Buffer => createHash('sha256').update(value).digest()

// Digesting both sides is what makes the comparison constant time: the first
// differing byte of a digest says nothing about the secret, where comparing the
// raw strings would leak a common prefix and their length.
const sameSecret = (given: string, expected: string): boolean =>
  timingSafeEqual(digest(given), digest(expected))

export const readTokens = (raw: string | undefined): string[] => {
  const seen = new Set<string>()
  for (const part of (raw ?? '').split(',')) {
    const token = part.trim()
    if (token !== '') seen.add(token)
  }
  return [...seen]
}

export const authFromEnv = (raw: string | undefined): Auth => {
  const tokens = readTokens(raw)
  return tokens.length === 0 ? null : { tokens }
}

// The scheme is read by hand: `\s+(.+)` backtracks on a header that is one long
// run of spaces (Sonar S8786).
const whitespace = /\s/

const bearerOf = (authorization: string): string | null => {
  const value = authorization.trim()
  const scheme = 'bearer'
  if (value.slice(0, scheme.length).toLowerCase() !== scheme) return null
  const rest = value.slice(scheme.length)
  // The scheme is a word of its own: `bearerx` is not a bearer header, and a
  // scheme with no whitespace after it carries no token.
  if (rest === '' || whitespace.test(rest[0]) === false) return null
  const token = rest.trim()
  return token === '' ? null : token
}

const headerValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return (value[0] ?? '').trim()
  return (value ?? '').trim()
}

// `/api/*` is the whole surface that reads or writes a speaker, so it is the
// one prefix the check guards. The static shell, the manifest, the worker and
// `/health` carry no device and stay open: a PWA has to install before a
// session exists, and a probe asks the health route without a credential.
export const isProtected = (pathname: string): boolean => pathname.startsWith('/api/')

export const authorized = (headers: IncomingHttpHeaders, auth: Auth): boolean => {
  if (auth === null) return true
  const bearer = bearerOf(headerValue(headers.authorization))
  if (bearer !== null && auth.tokens.some(token => sameSecret(bearer, token))) return true
  // The two doors are independent: the ingress decides which one a hostname
  // opens. An agent route hands a bearer through untouched and strips the
  // identity header; the page route does the opposite.
  return headerValue(headers[identityHeader]) !== ''
}
