/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PACKAGE_VERSION?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_TARGET_PLATFORM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
