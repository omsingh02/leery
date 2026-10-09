import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** First-time tips: shown once per device — even with several tabs open. */

type StorageListener = (e: { key: string | null }) => void;

function browser(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const listeners: StorageListener[] = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
    addEventListener: (type: string, fn: StorageListener) => {
      if (type === "storage") listeners.push(fn);
    },
  });
  return {
    data,
    /** What another tab does: change storage, and the browser tells this tab. */
    otherTab(key: string, value: string | null) {
      if (value === null) data.delete(key);
      else data.set(key, value);
      for (const l of listeners) l({ key });
    },
    stored: () => JSON.parse(data.get("leery.pref.hints") ?? "[]") as string[],
  };
}

async function fresh() {
  vi.resetModules();
  return (await import("@/lib/hints")).hints;
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("hints", () => {
  it("each tip shows until it has been marked, and the mark survives a reload", async () => {
    const page = browser();
    let hints = await fresh();
    expect(hints.has("select")).toBe(false);
    hints.mark("select");
    expect(hints.has("select")).toBe(true);
    expect(page.stored()).toEqual(["select"]);

    hints = await fresh(); // a reload
    expect(hints.has("select")).toBe(true);
    expect(hints.has("call")).toBe(false);
  });

  it("marking merges with what another tab has stored instead of overwriting it", async () => {
    const page = browser({ "leery.pref.hints": JSON.stringify(["select"]) });
    const hints = await fresh();
    page.data.set("leery.pref.hints", JSON.stringify(["select", "call"])); // another tab, no event delivered yet
    hints.mark("drag");
    expect(page.stored().sort()).toEqual(["call", "drag", "select"]);
  });

  it("follows another tab marking or resetting the tips", async () => {
    const page = browser();
    const hints = await fresh();
    const seen = vi.fn();
    hints.subscribe(seen);

    page.otherTab("leery.pref.hints", JSON.stringify(["call"]));
    expect(hints.has("call")).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);

    page.otherTab("leery.pref.hints", null); // "Show again" in the other tab
    expect(hints.has("call")).toBe(false);

    page.otherTab("leery.unrelated", "x"); // other keys are none of its business
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("reset() brings every tip back", async () => {
    const page = browser({ "leery.pref.hints": JSON.stringify(["select", "call", "drag"]) });
    const hints = await fresh();
    hints.reset();
    expect(hints.has("select")).toBe(false);
    expect(page.data.has("leery.pref.hints")).toBe(false);
  });

  it("survives storage that is missing or full of garbage", async () => {
    browser({ "leery.pref.hints": "{not json" });
    const hints = await fresh();
    expect(hints.has("select")).toBe(false);
    expect(() => hints.mark("select")).not.toThrow();

    vi.unstubAllGlobals(); // no window at all (private mode, SSR…)
    const bare = await fresh();
    expect(() => bare.mark("call")).not.toThrow();
    expect(bare.has("call")).toBe(true);
  });
});
