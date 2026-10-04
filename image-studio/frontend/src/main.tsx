import React from 'react'
import {createRoot} from 'react-dom/client'
import './styles/index.css'
import StudioRoot from './studio/StudioRoot'
import { applyPlatformAttributes, targetPlatform } from './platform'
import { PlatformProvider } from './platform/context'

const container = document.getElementById('root')
applyPlatformAttributes()
const root = createRoot(container!)
if (import.meta.env.DEV && typeof window !== 'undefined') {
    // Development helpers load the classic editor's store on demand, so the
    // Studio does not load it at startup and production builds omit them.
    void Promise.all([import('./app/dev/previewScenario'), import('./state/studioStore')]).then(([scenario, store]) => {
        ;(window as Window & { __imageStudioDebug?: unknown }).__imageStudioDebug = {
            readPreviewScenario: scenario.readPreviewScenario,
            applyMacWorkspacePreviewToStore: scenario.applyMacWorkspacePreviewToStore,
            applyWindowsRightRailPreviewToStore: scenario.applyWindowsRightRailPreviewToStore,
            getState: () => store.useStudioStore.getState(),
        }
    })
}
// The retired Android shell needs its Wails runtime stand-in before the app
// starts; desktop builds never load it.
const androidShell = targetPlatform === 'android' || targetPlatform === 'android-pad'
const ready = androidShell ? import('./platform/android/wailsShim').then(() => undefined) : Promise.resolve()
void ready.catch(() => undefined).then(() => root.render(
    <React.StrictMode>
        <PlatformProvider>
            <StudioRoot/>
        </PlatformProvider>
    </React.StrictMode>
))
