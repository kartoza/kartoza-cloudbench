const URL_PARAM = 'view'
const MAP_VIEW_VALUE = 'map'

export function setMapViewUrlParam(): void {
  const url = new URL(window.location.href)
  url.searchParams.set(URL_PARAM, MAP_VIEW_VALUE)
  window.history.pushState({ view: MAP_VIEW_VALUE }, '', url.toString())
}

export function clearMapViewUrlParam(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(URL_PARAM)) return
  url.searchParams.delete(URL_PARAM)
  window.history.pushState({}, '', url.toString())
}

export function isMapViewUrlParamSet(): boolean {
  return new URLSearchParams(window.location.search).get(URL_PARAM) === MAP_VIEW_VALUE
}
