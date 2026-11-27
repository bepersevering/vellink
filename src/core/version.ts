/**
 * Build-time version number.
 *
 * Injected from package.json via the define in vite.config.ts; in non-Vite environments
 * such as unit tests this global is absent, so fall back to a placeholder to avoid
 * reading an undefined variable.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
