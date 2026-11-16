import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import './styles/global.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary.tsx'
import { projectService } from './io/persistence/ProjectService.ts'

// Save when the page is hidden or closed, outside React so a crash doesn't stop it.
projectService.watchPage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fullScreen onCrash={() => projectService.capture()}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
