/**
 * URL validation, IP-literal classification for the SSRF guard, and
 * content-type handling for the local HTTP(S) fetch provider — the pure,
 * network-free half. The provider's `fetch()` composes these with transport
 * (redirect following, byte caps, decoding) and the guard's DNS step.
 *
 * @module @deepseek-ai/dsh-web-fetch-http/policy
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** The body kinds this provider decodes. */
export type FetchableKind = 'html' | 'text'

/**
 * Validate a request URL against the basic transport hygiene the provider
 * enforces before any network access: http(s) only, no embedded credentials,
 * bounded length. Returns the parsed `URL`. Throws {@link WebError} otherwise.
 * (The SSRF guard runs separately in the provider, on the parsed hostname and
 * on DNS answers.)
 *
 * @param input - the raw URL string from the fetch request.
 * @param maxUrlLength - inclusive upper bound on `input`'s length.
 * @returns the parsed `URL`.
 */
export function validateFetchUrl(input: string, maxUrlLength: number): URL {
  if (input.length > maxUrlLength) {
    throw new WebError(`URL exceeds the maximum length of ${maxUrlLength}`, 'WEB_INVALID_URL')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
  return url
}

/**
 * Two URLs are same-origin when scheme, hostname, and port match. A redirect
 * that crosses origins is refused so each new origin requires a fresh tool call
 * (and thus a fresh provider/permission decision).
 *
 * @param a - one of the two URLs to compare.
 * @param b - the other URL to compare.
 * @returns true when `a` and `b` share scheme, hostname, and port.
 */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/**
 * Classify a response `Content-Type` into a decodable body kind, or `undefined`
 * for an unsupported (e.g. binary) type. `text/html` and `application/xhtml+xml`
 * are `html`; other `text/*` plus a few structured text types are `text`.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none (unsupported).
 * @returns the decodable kind, or `undefined` for an unsupported type.
 */
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = (contentType ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}

/**
 * Extract the `charset` parameter from a response `Content-Type`, lower-cased,
 * or `undefined` when absent. The provider feeds this label to `TextDecoder`
 * so a non-UTF-8 response is decoded with its declared encoding rather than
 * silently mangled into replacement characters.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none.
 * @returns the lower-cased charset label, or `undefined` when none is declared.
 */
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase()
}

/**
 * Build a `TextDecoder` for the declared charset, falling back to UTF-8 when
 * none is declared. Throws {@link WebError} `WEB_UNSUPPORTED_CONTENT_TYPE` when
 * the label is present but not a charset `TextDecoder` recognizes — better to
 * fail loudly than return mojibake.
 *
 * @param charset - the declared charset label (from {@link parseCharset}), or
 *   `undefined` to default to UTF-8.
 * @returns a decoder for the declared (or defaulted) encoding.
 */
export function decoderForCharset(charset: string | undefined): TextDecoder {
  if (charset === undefined) return new TextDecoder('utf-8')
  try {
    return new TextDecoder(charset)
  } catch (error: unknown) {
    throw new WebError(`unsupported charset "${charset}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause: error })
  }
}

/** An IP family: IPv4 or IPv6. */
export type IpFamily = 4 | 6

/** A parsed IP literal: the family plus the numeric value of the address. */
export interface ParsedIp {
  /** Address family the literal was parsed as. */
  readonly family: IpFamily
  /**
   * Big-endian numeric value. IPv6 occupies the full 128 bits; IPv4 occupies
   * the low 32 bits and embedded IPv4 (mapped, compatible, NAT64) is judged by
   * its low 32 bits against the IPv4 rules.
   */
  readonly value: bigint
}

/**
 * Remove the decorations a host string can carry: the square brackets
 * `URL.hostname` keeps around an IPv6 literal and the RFC 4007 zone id, in
 * raw (`fe80::1%eth0`) or WHATWG URL-escaped (`fe80::1%25eth0`) spelling.
 * @param host - host string as it appears in a URL hostname or DNS answer.
 * @returns the bracket-free host without its zone id.
 */
export function stripLiteralDecorations(host: string): string {
  const bracketless = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const zoneStart = bracketless.indexOf('%')
  return zoneStart === -1 ? bracketless : bracketless.slice(0, zoneStart)
}

/**
 * Parse a host string as an IP literal. A host that is not a valid literal (a
 * name, or a malformed address) parses as `undefined` and is left to DNS.
 * @param host - host string as it appears in a URL hostname; brackets and
 *   zone ids are stripped before parsing.
 * @returns the parsed literal, or `undefined` when the host is not an IP literal.
 */
export function parseIpLiteral(host: string): ParsedIp | undefined {
  const stripped = stripLiteralDecorations(host)
  if (stripped.includes(':')) {
    const value = parseIpv6(stripped)
    return value === undefined ? undefined : { family: 6, value }
  }
  const value = parseIpv4(stripped)
  return value === undefined ? undefined : { family: 4, value }
}

/**
 * Whether the address falls into a range the fetch provider must not contact:
 * IPv4 `0.0.0.0/8`, RFC 1918 private (`10/8`, `172.16/12`, `192.168/16`),
 * loopback `127/8`, link-local `169.254/16` (including the cloud metadata
 * address `169.254.169.254`), multicast `224/4`, reserved `240/4` (including
 * the broadcast address); IPv6 the unspecified address, loopback `::1`,
 * unique-local `fc00::/7`, link-local `fe80::/10`, multicast `ff00::/8`, and
 * every embedded-IPv4 form (`::ffff:0:0/96` mapped, deprecated `::/96`
 * compatible, `64:ff9b::/96` NAT64) judged by its IPv4 tail.
 * @param ip - the parsed literal to classify.
 * @returns true when the address is blocked.
 */
export function isBlockedIp(ip: ParsedIp): boolean {
  return ip.family === 4 ? isBlockedIpv4(ip.value) : isBlockedIpv6(ip.value)
}

/** Classify one IPv4 value (low 32 bits) against the blocked ranges. */
function isBlockedIpv4(value: bigint): boolean {
  const firstOctet = value >> 24n
  if (firstOctet === 0n) return true
  if (firstOctet === 10n) return true
  if (firstOctet === 127n) return true
  if (value >> 16n === 0xa9fen) return true
  if (value >> 20n === 0xac1n) return true
  if (value >> 16n === 0xc0a8n) return true
  return firstOctet >= 224n
}

/** Classify one 128-bit IPv6 value against the blocked ranges. */
function isBlockedIpv6(value: bigint): boolean {
  const low32 = value & 0xffffffffn
  const high96 = value >> 32n
  if (high96 === 0n) return isBlockedIpv4(low32)
  if (high96 === 0xffffn) return isBlockedIpv4(low32)
  if (high96 === 0x64ff9bn << 64n) return isBlockedIpv4(low32)
  if (value >> 120n === 0xffn) return true
  if (value >> 121n === 0x7en) return true
  if (value >> 118n === 0x3fan) return true
  return false
}

/**
 * Parse one side of a `::` split into 16-bit groups; an embedded dotted IPv4
 * tail (`::ffff:1.2.3.4`) contributes its two low groups. An empty side
 * yields no groups.
 * @param text - one colon-separated side of an IPv6 literal (possibly empty).
 * @returns the 16-bit groups in order, or `undefined` for a malformed side.
 */
function parseGroups(text: string): number[] | undefined {
  if (text === '') return []
  const pieces = text.split(':')
  const groups: number[] = []
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index] as string
    const isLast = index === pieces.length - 1
    const embeddedV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(piece)
    if (embeddedV4) {
      if (!isLast) return undefined
      const value = parseIpv4(piece)
      if (value === undefined) return undefined
      groups.push(Number((value >> 16n) & 0xffffn), Number(value & 0xffffn))
      continue
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return undefined
    groups.push(Number.parseInt(piece, 16))
  }
  return groups
}

/**
 * Parse a zone-free IPv6 literal into its 128-bit value, accepting one `::`
 * compression and an embedded IPv4 tail.
 * @param stripped - the IPv6 text without any zone id.
 * @returns the numeric value, or `undefined` for a malformed literal.
 */
function parseIpv6(stripped: string): bigint | undefined {
  const halves = stripped.split('::')
  if (halves.length > 2) return undefined
  /* v8 ignore next -- split() never yields a missing index; the fallback only satisfies noUncheckedIndexedAccess. */
  const head = parseGroups(halves[0] ?? '')
  if (head === undefined) return undefined
  let tail: number[] = []
  if (halves.length === 2) {
    /* v8 ignore next -- a two-element split always has a second element. */
    const parsedTail = parseGroups(halves[1] ?? '')
    if (parsedTail === undefined) return undefined
    tail = parsedTail
  }
  const missing = 8 - head.length - tail.length
  if (missing < 0) return undefined
  if (halves.length === 1 && missing !== 0) return undefined
  let value = 0n
  for (const group of head) value = (value << 16n) | BigInt(group)
  value <<= BigInt(missing * 16)
  for (const group of tail) value = (value << 16n) | BigInt(group)
  return value
}

/**
 * Parse a zone-free canonical dotted-quad IPv4 literal into its 32-bit value.
 * Non-canonical spellings (leading zeros, out-of-range octets) are refused:
 * canonicalization belongs to the URL parser, which the provider runs first.
 * @param stripped - the IPv4 text without any zone id.
 * @returns the numeric value, or `undefined` for a malformed literal.
 */
function parseIpv4(stripped: string): bigint | undefined {
  const parts = stripped.split('.')
  if (parts.length !== 4) return undefined
  let value = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    if (part.length > 1 && part.startsWith('0')) return undefined
    const octet = Number(part)
    if (octet > 255) return undefined
    value = (value << 8n) | BigInt(octet)
  }
  return value
}
