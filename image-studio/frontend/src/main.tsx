import React from 'react'
import {createRoot} from 'react-dom/client'
import './styles/index.css'
import App from './app/App'
import { applyPlatformAttributes } from './platform'
import { PlatformProvider } from './platform/context'
import { applyMacWorkspacePreviewToStore, applyWindowsRightRailPreviewToStore, readPreviewScenario } from './app/dev/previewScenario'
import './platform/android/wailsShim'
import { useStudioStore } from './state/studioStore'

const container = document.getElementById('root')
applyPlatformAttributes()

const root = createRoot(container!)

if (import.meta.env.DEV && typeof window !== "undefined") {
    ;(window as Window & { __imageStudioDebug?: unknown }).__imageStudioDebug = {
        readPreviewScenario,
        applyMacWorkspacePreviewToStore,
        applyWindowsRightRailPreviewToStore,
        getState: () => useStudioStore.getState(),
    }
}

root.render(
    <React.StrictMode>
        <PlatformProvider>
            <App/>
        </PlatformProvider>
    </React.StrictMode>
)
