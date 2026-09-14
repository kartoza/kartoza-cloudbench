/**
 * Fetches deployment-time config from the backend (see
 * apps/core/views.py:FrontendConfigView) and feeds it into config/env.ts —
 * called once from main.tsx before the app renders.
 */
import { API_BASE, handleResponse } from './common'
import { setRuntimeConfig } from '../config/env'

interface FrontendConfigResponse {
  createGeoServerUrl: string | null
  createPostgisUrl: string | null
  createGeoNodeUrl: string | null
}

export async function loadFrontendConfig(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/frontend-config/`)
    setRuntimeConfig(await handleResponse<FrontendConfigResponse>(response))
  } catch {
    // Leave config/env.ts's VITE_CREATE_*_URL build-time fallback in place.
  }
}
