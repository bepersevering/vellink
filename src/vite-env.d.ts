/// <reference types="vite/client" />

declare module "*.css";

/** 构建期注入的应用版本号（vite.config.ts 的 define）。 */
declare const __APP_VERSION__: string | undefined;
