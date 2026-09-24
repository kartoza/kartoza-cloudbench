import React from 'react'
import ReactDOM from 'react-dom/client'
import { ChakraProvider } from '@chakra-ui/react'
import '@fontsource/nunito/400.css'
import '@fontsource/nunito/400-italic.css'
import '@fontsource/nunito/500.css'
import '@fontsource/nunito/600.css'
import '@fontsource/nunito/700.css'
import '@fontsource/nunito/800.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import theme from './theme'
import { applySsoTokenFromUrl } from './api/ssoBootstrap'
import { loadFrontendConfig } from './api/frontendConfig'

// Must run before any component mounts / API call fires — see
// api/ssoBootstrap.ts for why.
applySsoTokenFromUrl()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      refetchOnWindowFocus: false,
    },
  },
})

async function bootstrap() {
  // Must run before the app renders — components read the "Add <type>"
  // URL overrides it populates synchronously (see config/env.ts). Wrapped
  // in an async function rather than a top-level await: esbuild's
  // production build target doesn't support top-level await.
  await loadFrontendConfig()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ChakraProvider theme={theme}>
          <App />
        </ChakraProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  )
}

void bootstrap()
