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

interface RuntimeConfig {
  createGeoServerUrl?: string | null
  createPostgisUrl?: string | null
  createGeoNodeUrl?: string | null
}

let runtimeConfig: RuntimeConfig = {}

/**
 * Populated once at startup from GET /api/frontend-config/ (see
 * api/frontendConfig.ts, called from main.tsx before the app renders).
 */
export function setRuntimeConfig(config: RuntimeConfig): void {
  runtimeConfig = config
}

/** URL to open when creating a new GeoServer connection. When set, opens in a new window instead of the dialog. */
export function getCreateGeoServerUrl(): string | null {
  return runtimeConfig.createGeoServerUrl ?? null
}

/** URL to open when creating a new GeoNode connection. When set, opens in a new window instead of the dialog. */
export function getCreateGeoNodeUrl(): string | null {
  return runtimeConfig.createGeoNodeUrl ?? null
}

/** URL to open when creating a new PostgreSQL connection. When set, opens in a new window instead of the dialog. */
export function getCreatePostGISUrl(): string | null {
  return runtimeConfig.createPostgisUrl ?? null
}