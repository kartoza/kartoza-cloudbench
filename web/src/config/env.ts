/**
 * Environment variable accessors.
 *
 * All VITE_* variables used by this app are centralised here so that
 * call sites do not scatter `import.meta.env` references across the codebase.
 */

/** Base URL for all API requests. Defaults to '/api' when not set. */
export function getApiBase(): string {
  return import.meta.env.VITE_API_BASE ?? '/api'
}

/** Base URL for the Vite asset bundle (used in vite.config.ts `base`). Defaults to ''. */
export function getBaseUrl(): string {
  return import.meta.env.VITE_BASE_URL ?? ''
}

/** URL to open when creating a new GeoServer connection. When set, opens in a new window instead of the dialog. */
export function getCreateGeoServerUrl(): string | null {
  return import.meta.env.VITE_CREATE_GEOSERVER_URL ?? null
}

/** URL to open when creating a new GeoNode connection. When set, opens in a new window instead of the dialog. */
export function getCreateGeoNodeUrl(): string | null {
  return import.meta.env.VITE_CREATE_GEONODE_URL ?? null
}

/** URL to open when creating a new PostgreSQL connection. When set, opens in a new window instead of the dialog. */
export function getCreatePostGISUrl(): string | null {
  return import.meta.env.VITE_CREATE_POSTGIS_URL ?? null
}