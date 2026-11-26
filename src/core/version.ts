/**
 * 构建期版本号。
 *
 * 由 vite.config.ts 的 define 从 package.json 注入；单测等非 Vite 环境里没有这个
 * 全局量，退回占位值，避免直接读未定义变量。
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
