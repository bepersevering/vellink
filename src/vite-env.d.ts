/// <reference types="vite/client" />

declare module "*.css";

/** App version injected at build time (via define in vite.config.ts). */
declare const __APP_VERSION__: string | undefined;
