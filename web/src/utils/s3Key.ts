// Resolving paths written inside S3 objects (e.g. a layer README's
// "./thumbnail.png") against the object's own key.

// Anything with a scheme (https:, data:, ...) or protocol-relative ("//host").
const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/)/i

export function isAbsoluteUrl(src: string): boolean {
  return ABSOLUTE_URL.test(src)
}

export function resolveRelativeKey(baseKey: string, src: string): string | null {
  if (!src || isAbsoluteUrl(src)) return null
  const path = src.split(/[?#]/)[0]
  const parts = path.startsWith('/') ? [] : baseKey.split('/').slice(0, -1)
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(decodeURIComponent(segment))
    }
  }
  return parts.length > 0 ? parts.join('/') : null
}
