import React from 'react'
import {createRoot} from 'react-dom/client'
import './styles/index.css'
import StudioRoot from './studio/StudioRoot'
import { applyPlatformAttributes, targetPlatform } from './platform'
import { PlatformProvider } from './platform/context'

const container = document.getElementById('root')
applyPlatformAttributes()
const root = createRoot(container!)
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
