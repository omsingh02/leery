import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";

const ADMIN = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54399/postgres";

/** Superuser SQL against the e2e database (scenario setup + hidden-state inspection). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sql<T = Record<string, any>>(q: string, params: unknown[] = []): Promise<T[]> {
  const u = new URL(ADMIN);
  u.pathname = "/leery_e2e";
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Collect uncaught page errors and console errors (the browser's own "Failed to load resource" noise is ignored). */
export function watch(page: Page, label = "page"): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/Failed to load resource/i.test(text)) return; // 4xx from intentional engine errors
    errors.push(`[${label}] console.error: ${text}`);
  });
  return errors;
}

/** A second (third…) independent device: same emulation as the project, fresh storage → new identity. */
export async function newDevice(browser: Browser, info: TestInfo): Promise<{ context: BrowserContext; page: Page }> {
  const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, baseURL } = info.project.use;
  const context = await browser.newContext({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, baseURL });
  return { context, page: await context.newPage() };
}

export const roomCodeFromUrl = (page: Page): string => {
  const m = /\/r\/([A-Z0-9]{6})/.exec(page.url());
  if (!m) throw new Error(`not on a room page: ${page.url()}`);
  return m[1];
};

export async function startSolo(page: Page, name: string, bots = 3) {
  await page.goto("/");
  await page.getByTestId("name-input").fill(name);
  for (let i = 3; i < bots; i++) await page.getByTestId("solo-bots-inc").click();
  for (let i = 3; i > bots; i--) await page.getByTestId("solo-bots-dec").click();
  await page.getByTestId("solo-start").click();
  await expect(page.getByTestId("game-screen")).toBeVisible({ timeout: 20_000 });
}

export async function createRoom(page: Page, name: string) {
  await page.goto("/");
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("create-room").click();
  await expect(page.getByTestId("lobby")).toBeVisible({ timeout: 20_000 });
  return roomCodeFromUrl(page);
}

export async function joinByLink(page: Page, code: string, name: string) {
  await page.goto(`/r/${code}`);
  await expect(page.getByTestId("join-panel")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("join-name-input").fill(name);
  await page.getByTestId("join-confirm").click();
  await expect(page.getByTestId("lobby")).toBeVisible({ timeout: 20_000 });
}

const quiet = { timeout: 2_000 };

/** Take my turn the simple way: honest cards if I hold any, else one card. Returns true if a play was made. */
export async function playMyTurn(page: Page): Promise<boolean> {
  try {
    const play = page.getByTestId("play-button");
    if (!(await play.isVisible())) return false;
    const honest = page.getByTestId("select-honest");
    if (await honest.isVisible()) await honest.click(quiet);
    else await page.getByTestId("hand").locator('[data-testid^="card-"]').first().click({ ...quiet, position: { x: 6, y: 24 } });
    await play.click(quiet);
    return true;
  } catch {
    return false; // the state moved under us (timer, race) — the caller just loops again
  }
}

/** Accept (or occasionally call) while a challenge window is open for me. */
export async function respondToChallenge(page: Page, callRate = 0): Promise<boolean> {
  try {
    const accept = page.getByTestId("accept-play");
    if (!(await accept.isVisible()) || !(await accept.isEnabled())) return false;
    if (Math.random() < callRate) await page.getByTestId("call-bluff").click(quiet);
    else await accept.click(quiet);
    return true;
  } catch {
    return false;
  }
}

/** Drive one human through the UI until `stop()` says so, the game ends, or time runs out. */
export async function autoplay(
  page: Page,
  o: { maxMs: number; callRate?: number; stop?: (stats: { plays: number }) => boolean },
): Promise<{ plays: number; over: boolean }> {
  const t0 = Date.now();
  const stats = { plays: 0 };
  while (Date.now() - t0 < o.maxMs) {
    if (await page.getByTestId("game-over").isVisible()) return { ...stats, over: true };
    if (o.stop?.(stats)) return { ...stats, over: false };
    if (await playMyTurn(page)) {
      stats.plays++;
      await page.waitForTimeout(500);
      continue;
    }
    if (await respondToChallenge(page, o.callRate ?? 0)) continue;
    await page.waitForTimeout(250);
  }
  return { ...stats, over: false };
}

/** Hand + pile must always add up to a full deck while a game is running. */
export async function expectDeckIntact(code: string) {
  const [r] = await sql<{ pile: string[] }>("select pile from game.rooms where code = $1", [code]);
  const hands = await sql<{ hand: string[] }>(
    "select p.hand from game.players p join game.rooms r on r.id = p.room_id where r.code = $1",
    [code],
  );
  const all = [...r.pile, ...hands.flatMap((h) => h.hand)];
  expect(all).toHaveLength(52);
  expect(new Set(all).size).toBe(52);
}

/** Force a deterministic position (like the engine tests): whose turn, rank, and exact hands by seat. */
export async function setupPosition(code: string, o: { seat: number; rankIdx?: number; hands: Record<number, string[]> }) {
  const [room] = await sql<{ id: string }>("select id from game.rooms where code = $1", [code]);
  for (const [seat, hand] of Object.entries(o.hands)) {
    await sql("update game.players set hand = $1 where room_id = $2 and seat = $3", [hand, room.id, Number(seat)]);
  }
  await sql(
    `update game.rooms set seat_turn = $2, rank_idx = $3, pile = '{}', status = 'turn',
       turn_started_at = clock_timestamp(), deadline = clock_timestamp() + interval '45 seconds',
       act_at = null, bot_caller = null, passed = '{}', play_seat = null, play_count = 0, reveal = null
     where code = $1`,
    [code, o.seat, o.rankIdx ?? 0],
  );
}

/**
 * `setupPosition` writes straight to the database, so a client shows the new hands only after its next poll. Until
 * then it still shows the dealt ones — and may even hold the same card, somewhere else, which is how a gesture
 * aimed at it misses. Wait for this page's hand to be exactly `codes` before acting on it.
 */
export async function expectHand(page: Page, codes: string[]) {
  const hand = page.getByTestId("hand");
  await expect(hand.locator('[data-testid^="card-"]')).toHaveCount(codes.length, { timeout: 15_000 });
  for (const c of codes) await expect(hand.locator(`[data-testid="card-${c}"]`)).toBeVisible();
}
