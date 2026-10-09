/**
 * Device identity + small persisted preferences.
 *
 * There are no accounts. A random 192-bit token lives in localStorage and is sent with every RPC;
 * the server stores only its SHA-256 hash. Losing it (clearing site data) = losing your seat.
 *
 * Testing tip: open the app with `?as=alice` to get an independent identity in the same browser
 * (handy for playing both sides locally). Not used in normal play.
 */

const ns = (() => {
  try {
    const as = new URLSearchParams(window.location.search).get("as");
    return as ? `:${as.replace(/[^\w-]/g, "").slice(0, 24)}` : "";
  } catch {
    return "";
  }
})();

const memory = new Map<string, string>(); // fallback when storage is unavailable (private mode)

function read(key: string): string | null {
  const k = `leery.${key}${ns}`;
  try {
    return window.localStorage.getItem(k) ?? memory.get(k) ?? null;
  } catch {
    return memory.get(k) ?? null;
  }
}

function write(key: string, value: string | null) {
  const k = `leery.${key}${ns}`;
  try {
    if (value === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, value);
  } catch {
    /* storage unavailable — keep in memory for this tab */
  }
  if (value === null) memory.delete(k);
  else memory.set(k, value);
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable per-device secret. Created on first use. */
export function getToken(): string {
  let t = read("token");
  if (!t || t.length < 32) {
    t = randomToken();
    write("token", t);
  }
  return t;
}

export const getName = (): string => read("name") ?? "";
export const setName = (name: string) => write("name", name.trim());

export interface LastRoom {
  code: string;
  at: number;
}

const LAST_ROOM_TTL = 6 * 60 * 60 * 1000;

export function getLastRoom(): LastRoom | null {
  try {
    const raw = read("room");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastRoom;
    if (!parsed.code || Date.now() - parsed.at > LAST_ROOM_TTL) return null;
    return parsed;
  } catch {
    return null;
  }
}
export const setLastRoom = (code: string) => write("room", JSON.stringify({ code, at: Date.now() }));
export const clearLastRoom = () => write("room", null);

export const isMuted = (): boolean => read("muted") === "1";
export const setMutedPref = (muted: boolean) => write("muted", muted ? "1" : "0");

/** Generic small string preference (namespaced like everything else here). */
export const getPref = (key: string): string | null => read(`pref.${key}`);
export const setPref = (key: string, value: string | null) => write(`pref.${key}`, value);

/** Calls `handler` when another tab changes (or clears) this site's storage. No-op where there are no storage events. */
export function onStorageChange(handler: (key: string | null) => void): void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  window.addEventListener("storage", (e) => handler(e.key));
}
