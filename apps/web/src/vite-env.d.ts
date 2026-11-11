/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_REGISTRY_ADDRESS?: string;
  readonly VITE_REFEREE_ADDRESS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
