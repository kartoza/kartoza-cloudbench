/**
 * What's wrong with a WMS layer, from GeoServer's answer to a GetMap.
 *
 * GeoServer answers a GetMap it can't draw with a ServiceException (XML)
 * instead of an image. A layer the request may not see is reported the same
 * as one that doesn't exist ("LayerNotDefined"), which for a GeoNode layer
 * almost always means it's private.
 *
 * Returns null when the answer is an image, 'private' when the layer can't be
 * seen, and GeoServer's message (or the status) for anything else.
 */
export type WmsProblem = null | 'private' | string

export function wmsProblem(status: number, contentType: string, body: string): WmsProblem {
  if (status >= 200 && status < 300 && contentType.startsWith('image/')) return null
  if (/LayerNotDefined|Could not find layer/i.test(body)) return 'private'
  const message = body.match(/<ServiceException(?:\s[^>]*)?>([\s\S]*?)<\/ServiceException>/)?.[1]?.trim()
  return message || `GeoServer answered ${status}${contentType ? ` (${contentType})` : ''}`
}
