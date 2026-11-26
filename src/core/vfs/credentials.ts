/**
 * 凭据抽象 — 插件永不接触明文密码，只拿到 service/account 句柄。
 *
 * 浏览器预览用 localStorage（开发便利）；Tauri 打包后换成 keychain adapter：
 *   CredentialStore 的实现由宿主注入，调用方代码不变。
 */

export interface Credential {
  username: string;
  secret: string;
}

export interface CredentialStore {
  get(service: string, account: string): Promise<Credential | undefined>;
  set(service: string, account: string, credential: Credential): Promise<void>;
  delete(service: string, account: string): Promise<void>;
}

const keyOf = (service: string, account: string) => `vellink:cred:${service}:${account}`;

export function createMemoryCredentialStore(): CredentialStore {
  const data = new Map<string, Credential>();
  return {
    async get(service, account) {
      return data.get(keyOf(service, account));
    },
    async set(service, account, credential) {
      data.set(keyOf(service, account), { ...credential });
    },
    async delete(service, account) {
      data.delete(keyOf(service, account));
    },
  };
}

/** 开发态持久化实现；Tauri 版应替换为 OS keychain，不要把 token 写进 localStorage。 */
export function createLocalCredentialStore(): CredentialStore {
  return {
    async get(service, account) {
      try {
        const raw = window.localStorage.getItem(keyOf(service, account));
        return raw ? (JSON.parse(raw) as Credential) : undefined;
      } catch {
        return undefined;
      }
    },
    async set(service, account, credential) {
      try {
        window.localStorage.setItem(keyOf(service, account), JSON.stringify(credential));
      } catch {
        // 隐私模式下仅保留本次会话
      }
    },
    async delete(service, account) {
      try {
        window.localStorage.removeItem(keyOf(service, account));
      } catch {
        // ignore
      }
    },
  };
}

/** Basic Auth header；凭据从 store 取，调用方不接触明文。 */
export function basicAuthHeader(credential: Credential): string {
  const pair = `${credential.username}:${credential.secret}`;
  // 浏览器与 Node 18+ 都有 btoa；UTF-8 多字节先编码再逐字节转 latin1。
  const bytes = new TextEncoder().encode(pair);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}
