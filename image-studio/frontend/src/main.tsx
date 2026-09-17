import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { applyPlatformAttributes } from './platform'
import { PlatformProvider } from './platform/context'
import { installDesktopRuntime } from './platform/runtime/desktop'
import { installDesktopAppearance } from './platform/runtime/desktopAppearance'

async function start() {
  applyPlatformAttributes()
  await installDesktopRuntime()
  installDesktopAppearance()
  const root = createRoot(document.getElementById('root')!)
  // Keep settings independent of the workspace store and all of its side effects.
  if (new URLSearchParams(window.location.search).get('window') === 'settings') {
    const { SettingsWindowApp } = await import('./components/desktop-settings/SettingsWindowApp')
    root.render(<React.StrictMode><PlatformProvider><SettingsWindowApp /></PlatformProvider></React.StrictMode>)
    return
  }
  await import('./platform/android/wailsShim')
  const { default: App } = await import('./app/App')
  if (import.meta.env.DEV) {
    const preview = await import('./app/dev/previewScenario')
    const { useStudioStore } = await import('./state/studioStore')
    ;(window as Window & { __imageStudioDebug?: unknown }).__imageStudioDebug = { ...preview, getState: () => useStudioStore.getState() }
  }
  root.render(<React.StrictMode><PlatformProvider><App /></PlatformProvider></React.StrictMode>)
}
void start()
