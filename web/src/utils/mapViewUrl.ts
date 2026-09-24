const URL_PARAM = 'view'
const MAP_VIEW_VALUE = 'map'
const TAB_PARAM = 'tab'
const CATALOGUE_TAB_VALUE = 'catalogue'
const LAYERS_PARAM = 'layers'

export type MapExplorerTab = 'map' | 'catalogue'

export function setMapViewUrlParam(): void {
  const url = new URL(window.location.href)
  url.searchParams.set(URL_PARAM, MAP_VIEW_VALUE)
  window.history.pushState({ view: MAP_VIEW_VALUE }, '', url.toString())
}

export function clearMapViewUrlParam(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(URL_PARAM) && !url.searchParams.has(TAB_PARAM)) return
  url.searchParams.delete(URL_PARAM)
  url.searchParams.delete(TAB_PARAM)
  window.history.pushState({}, '', url.toString())
}

export function isMapViewUrlParamSet(): boolean {
  return new URLSearchParams(window.location.search).get(URL_PARAM) === MAP_VIEW_VALUE
}

// Which tab (Map / Catalogue) is active within the Map Explorer overlay.
// Uses replaceState rather than pushState — switching tabs shouldn't add
// browser-back stops, it should just survive a refresh.
export function setMapExplorerTabUrlParam(tab: MapExplorerTab): void {
  const url = new URL(window.location.href)
  if (tab === 'map') {
    url.searchParams.delete(TAB_PARAM)
  } else {
    url.searchParams.set(TAB_PARAM, CATALOGUE_TAB_VALUE)
  }
  window.history.replaceState(window.history.state, '', url.toString())
}

export function getMapExplorerTabUrlParam(): MapExplorerTab {
  return new URLSearchParams(window.location.search).get(TAB_PARAM) === CATALOGUE_TAB_VALUE ? 'catalogue' : 'map'
}

export interface MapExplorerLayerRef {
  connectionId: string
  bucketName: string
  key: string
}

export function setMapExplorerLayersUrlParam(layers: MapExplorerLayerRef[]): void {
  const url = new URL(window.location.href)
  if (layers.length === 0) {
    url.searchParams.delete(LAYERS_PARAM)
  } else {
    const encoded = layers
      .map((l) => [l.connectionId, encodeURIComponent(l.bucketName), encodeURIComponent(l.key)].join(':'))
      .join(',')
    url.searchParams.set(LAYERS_PARAM, encoded)
  }
  window.history.replaceState(window.history.state, '', url.toString())
}

export function getMapExplorerLayersUrlParam(): MapExplorerLayerRef[] {
  const raw = new URLSearchParams(window.location.search).get(LAYERS_PARAM)
  if (!raw) return []
  try {
    const refs: MapExplorerLayerRef[] = []
    for (const entry of raw.split(',')) {
      const [connectionId, encodedBucketName, encodedKey] = entry.split(':')
      if (!connectionId || !encodedBucketName || !encodedKey) continue
      refs.push({
        connectionId,
        bucketName: decodeURIComponent(encodedBucketName),
        key: decodeURIComponent(encodedKey),
      })
    }
    return refs
  } catch {
    // Malformed/tampered param — ignore and start with no layers.
    return []
  }
}
