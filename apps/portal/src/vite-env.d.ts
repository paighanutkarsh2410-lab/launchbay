/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API's origin when it is not the portal's own (the public demo). */
  readonly VITE_API_URL?: string;
}
