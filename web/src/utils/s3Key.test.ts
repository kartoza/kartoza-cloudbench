import { describe, expect, it } from 'vitest'
import { isAbsoluteUrl, resolveRelativeKey } from './s3Key'

describe('resolveRelativeKey', () => {
  it('resolves paths relative to the object folder', () => {
    expect(resolveRelativeKey('roads/README.md', './thumbnail.png')).toBe('roads/thumbnail.png')
    expect(resolveRelativeKey('roads/README.md', 'styles/default.json')).toBe('roads/styles/default.json')
    expect(resolveRelativeKey('a/b/README.md', '../catalog.json')).toBe('a/catalog.json')
    expect(resolveRelativeKey('README.md', './roads/thumbnail.png')).toBe('roads/thumbnail.png')
  })

  it('treats a leading slash as the bucket root and drops query/fragment', () => {
    expect(resolveRelativeKey('a/b/README.md', '/catalog.json')).toBe('catalog.json')
    expect(resolveRelativeKey('roads/README.md', './thumbnail.png?v=2#x')).toBe('roads/thumbnail.png')
    expect(resolveRelativeKey('roads/README.md', './my%20map.png')).toBe('roads/my map.png')
  })

  it('refuses absolute URLs and paths above the bucket root', () => {
    expect(resolveRelativeKey('roads/README.md', 'https://example.org/a.png')).toBeNull()
    expect(resolveRelativeKey('roads/README.md', 'data:image/png;base64,AAAA')).toBeNull()
    expect(resolveRelativeKey('roads/README.md', '../../escape.png')).toBeNull()
    expect(resolveRelativeKey('roads/README.md', '')).toBeNull()
  })
})

describe('isAbsoluteUrl', () => {
  it('recognises schemes and protocol-relative URLs', () => {
    expect(isAbsoluteUrl('https://x.org/a.png')).toBe(true)
    expect(isAbsoluteUrl('//cdn.example.org/a.png')).toBe(true)
    expect(isAbsoluteUrl('./thumbnail.png')).toBe(false)
  })
})
