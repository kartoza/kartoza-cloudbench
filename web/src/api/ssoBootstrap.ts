/**
 * SSO handoff bootstrap.
 *
 * GeoHosting embeds CloudBench directly via iframe, cross-origin, and
 * hands off a short-lived signed token as a URL parameter (see
 * GeoHosting's geohosting/cloudbench/views.py). localStorage isn't
 * shared across origins, so this app has to pick the token up itself on
 * first load and persist it the same way a normal CloudBench login
 * would (see common.ts, which reads it back out on every API call).
 */
export function applySsoTokenFromUrl(): void {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  if (!token) {
    return
  }

  localStorage.setItem('token', token)

  params.delete('token')
  const query = params.toString()
  const path = window.location.pathname + (query ? `?${query}` : '') + window.location.hash
  window.history.replaceState({}, document.title, window.location.origin + path)
}
