import { describe, it, expect, vi } from 'vitest'
import type maplibregl from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'
import {
  BASEMAP_ATTRIBUTION,
  BASEMAP_STYLE_URL,
  absolutizeBasemapStyle,
  applyBasemap,
} from './basemap'

// Trimmed copy of https://world.kartoza.com/styles/classic.json
const kartozaStyle: StyleSpecification = {
  version: 8,
  glyphs: '/fonts/{fontstack}/{range}.pbf',
  sprite: '/sprites/icons',
  sources: {
    planet: {
      type: 'vector',
      tiles: ['/services/planet/tiles/{z}/{x}/{y}.pbf'],
      minzoom: 0,
      maxzoom: 14,
    },
  },
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eee' } }],
}

describe('basemap', () => {
  it('uses the Kartoza world basemap, not tile.openstreetmap.org', () => {
    expect(BASEMAP_STYLE_URL).toBe('https://world.kartoza.com/styles/classic.json')
  })

  it("makes the style's root-relative URLs point at the basemap host", () => {
    const style = absolutizeBasemapStyle(kartozaStyle)
    expect(style.glyphs).toBe('https://world.kartoza.com/fonts/{fontstack}/{range}.pbf')
    expect(style.sprite).toBe('https://world.kartoza.com/sprites/icons')
    expect(style.sources.planet).toMatchObject({
      tiles: ['https://world.kartoza.com/services/planet/tiles/{z}/{x}/{y}.pbf'],
      attribution: BASEMAP_ATTRIBUTION,
    })
    expect(style.layers).toEqual(kartozaStyle.layers)
  })

  it('leaves absolute URLs and an existing attribution alone', () => {
    const style = absolutizeBasemapStyle({
      ...kartozaStyle,
      sprite: [{ id: 'default', url: 'https://cdn.example.com/sprite' }],
      sources: {
        planet: {
          type: 'vector',
          url: 'https://cdn.example.com/tiles.json',
          attribution: 'Mine',
        },
      },
    })
    expect(style.sprite).toEqual([{ id: 'default', url: 'https://cdn.example.com/sprite' }])
    expect(style.sources.planet).toMatchObject({
      url: 'https://cdn.example.com/tiles.json',
      attribution: 'Mine',
    })
  })

  it('loads the style onto the map, transformed', () => {
    const setStyle = vi.fn()
    applyBasemap({ setStyle } as unknown as maplibregl.Map)
    expect(setStyle).toHaveBeenCalledWith(BASEMAP_STYLE_URL, expect.any(Object))
    const { transformStyle } = setStyle.mock.calls[0][1]
    expect(transformStyle(undefined, kartozaStyle).glyphs).toBe(
      'https://world.kartoza.com/fonts/{fontstack}/{range}.pbf'
    )
  })
})
