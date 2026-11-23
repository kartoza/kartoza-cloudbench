import { describe, expect, it } from 'vitest'
import { wmsProblem } from './wmsProblem'

const exception = (code: string, text: string) =>
  `<?xml version="1.0"?><ServiceExceptionReport version="1.1.1"><ServiceException code="${code}">
      ${text}
</ServiceException></ServiceExceptionReport>`

describe('wmsProblem', () => {
  it('is nothing for an image', () => {
    expect(wmsProblem(200, 'image/png', '')).toBeNull()
  })

  it('reads a layer GeoServer may not show as private', () => {
    const body = exception('LayerNotDefined', 'Could not find layer geonode:roads')
    expect(wmsProblem(200, 'application/vnd.ogc.se_xml;charset=UTF-8', body)).toBe('private')
  })

  it("passes GeoServer's message on otherwise", () => {
    const body = exception('InvalidSRS', 'Error occurred decoding the espg code EPSG:1')
    expect(wmsProblem(200, 'application/vnd.ogc.se_xml', body)).toBe(
      'Error occurred decoding the espg code EPSG:1',
    )
  })

  it('falls back to the status', () => {
    expect(wmsProblem(502, 'application/json', '{"error":"x"}')).toBe(
      'GeoServer answered 502 (application/json)',
    )
  })
})
