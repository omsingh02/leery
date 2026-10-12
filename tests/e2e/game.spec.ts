import { expect, test } from "@playwright/test";
import {
  autoplay,
  createRoom,
  expectDeckIntact,
  expectHand,
  joinByLink,
  newDevice,
  roomCodeFromUrl,
  setupPosition,
  sql,
  startSolo,
  watch,
} from "./helpers";

test.describe("Leery (real UI ↔ real engine)", () => {
  test("home: validation, code normalisation, rules dialog", async ({ page }) => {
    const errors = watch(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/Leery/);

    // name is required
    await page.getByTestId("create-room").click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    // room codes are uppercased, stripped of junk and capped at 6…
    const code = page.getByTestId("join-code-input");
    await code.fill("ab-cd3efgh");
    await expect(code).toHaveValue("ABCD3E");
    // …and pasting an invite link (or a message containing a code) extracts the code
    await code.fill("come play! https://liars.example/r/k7qxm2");
    await expect(code).toHaveValue("K7QXM2");
    await code.fill("my code is d3efgh ok");
    await expect(code).toHaveValue("D3EFGH");

    // the bots stepper is bounded (the buttons disable at the limits)
    const inc = page.getByTestId("solo-bots-inc");
    const dec = page.getByTestId("solo-bots-dec");
    while (await inc.isEnabled()) await inc.click();
    await expect(page.getByTestId("solo-bots-count")).toHaveText("7");
    while (await dec.isEnabled()) await dec.click();
    await expect(page.getByTestId("solo-bots-count")).toHaveText("1");

    await page.getByTestId("open-rules").click();
    await expect(page.getByTestId("rules-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("rules-dialog")).toBeHidden();

    expect(errors).toEqual([]);
  });

  test("unknown room shows a friendly error", async ({ page }) => {
    await page.goto("/r/ZZZZZZ");
    await expect(page.getByTestId("room-error")).toBeVisible({ timeout: 20_000 });
    await page.goto("/nope/never");
    await expect(page.getByTestId("not-found")).toBeVisible();
  });

  test("solo vs bots: play turns, read the log, leave", async ({ page }) => {
    test.setTimeout(150_000);
    const errors = watch(page);
    await startSolo(page, "Tester", 3);

    // three opponents are seated
    await expect(page.locator('[data-testid^="seat-"]:not([data-testid^="seat-cards-"])')).toHaveCount(3);

    const { plays } = await autoplay(page, { maxMs: 100_000, callRate: 0.2, stop: (s) => s.plays >= 3 });
    expect(plays).toBeGreaterThanOrEqual(3);

    const code = roomCodeFromUrl(page);
    await expectDeckIntact(code);
    const [{ turns }] = await sql<{ turns: number }>("select turns from game.rooms where code = $1", [code]);
    expect(turns).toBeGreaterThanOrEqual(4); // bots really took turns too

    await page.getByTestId("game-log-toggle").click();
    await expect(page.getByTestId("game-log")).toContainText(/played/i);
    await page.keyboard.press("Escape");

    await page.getByTestId("game-menu").click();
    await page.getByTestId("leave-game-menu").click();
    await page.getByTestId("leave-game-confirm").click();
    await expect(page).toHaveURL(/\/$/);
    // the room is torn down when the last human leaves
    await expect.poll(async () => (await sql("select 1 from game.rooms where code = $1", [code])).length).toBe(0);

    expect(errors).toEqual([]);
  });

  test("invite flow: create, join by link, play with a bot, reload restores, late joiners are blocked", async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    const alice = page;
    const errorsA = watch(alice, "alice");
    const code = await createRoom(alice, "Alice");

    const b = await newDevice(browser, info);
    const bob = b.page;
    const errorsB = watch(bob, "bob");
    await joinByLink(bob, code, "Bob");

    // both see each other
    await expect(alice.getByTestId("player-count")).toContainText("2");
    await expect(bob.getByTestId("lobby")).toContainText("Alice");
    // only the host sees host controls
    await expect(bob.getByTestId("start-game")).toHaveCount(0);
    await expect(bob.getByTestId("waiting-host")).toBeVisible();

    await alice.getByTestId("add-bot").click();
    await expect(alice.getByTestId("player-count")).toContainText("3");
    await alice.getByTestId("speed-blitz").click();
    await alice.getByTestId("start-game").click();

    await expect(alice.getByTestId("game-screen")).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByTestId("game-screen")).toBeVisible({ timeout: 20_000 });

    // play for a while with both humans
    const stats = { alice: 0, bob: 0 };
    await Promise.all([
      autoplay(alice, { maxMs: 70_000, stop: (s) => ((stats.alice = s.plays), stats.alice >= 3 && stats.bob >= 3) }),
      autoplay(bob, { maxMs: 70_000, stop: (s) => ((stats.bob = s.plays), stats.alice >= 3 && stats.bob >= 3) }),
    ]);
    expect(stats.alice).toBeGreaterThanOrEqual(3);
    expect(stats.bob).toBeGreaterThanOrEqual(3);
    await expectDeckIntact(code);

    // reload mid-game: Bob is put straight back at the table with his own hand
    const [bobRow] = await sql<{ n: number }>(
      "select cardinality(p.hand) as n from game.players p join game.rooms r on r.id = p.room_id where r.code = $1 and p.name = 'Bob'",
      [code],
    );
    await bob.reload();
    await expect(bob.getByTestId("game-screen")).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByTestId("my-card-count")).toContainText(/\d+/);
    const shown = Number((await bob.getByTestId("my-card-count").innerText()).match(/\d+/)![0]);
    expect(Math.abs(shown - bobRow.n)).toBeLessThanOrEqual(4); // the game keeps moving between the SQL read and the reload

    // a stranger opening the link now can't join a running game
    const c = await newDevice(browser, info);
    await c.page.goto(`/r/${code}`);
    await expect(c.page.getByTestId("join-blocked")).toBeVisible({ timeout: 20_000 });
    await c.context.close();

    expect(errorsA).toEqual([]);
    expect(errorsB).toEqual([]);
    await b.context.close();
  });

  test("finish and rematch", async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    const alice = page;
    const code = await createRoom(alice, "Alice");
    const b = await newDevice(browser, info);
    const bob = b.page;
    await joinByLink(bob, code, "Bob");
    await alice.getByTestId("start-game").click();
    await expect(alice.getByTestId("game-screen")).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByTestId("game-screen")).toBeVisible({ timeout: 20_000 });

    // Alice (seat 0) is about to play her very last card — honestly (it's Aces' turn).
    await setupPosition(code, { seat: 0, rankIdx: 0, hands: { 0: ["AH"], 1: ["5C", "6C", "7C"] } });
    await expectHand(alice, ["AH"]);
    await expect(alice.getByTestId("play-button")).toBeVisible({ timeout: 15_000 });
    await alice.getByTestId("hand").locator('[data-testid="card-AH"]').click({ position: { x: 6, y: 24 } });
    await alice.getByTestId("play-button").click();

    // Bob sees the challenge and lets it slide
    await expect(bob.getByTestId("accept-play")).toBeVisible({ timeout: 15_000 });
    await bob.getByTestId("accept-play").click();

    await expect(alice.getByTestId("game-over")).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByTestId("game-over")).toBeVisible({ timeout: 20_000 });
    await expect(alice.getByTestId("winner-name")).toContainText(/you win/i);
    await expect(bob.getByTestId("winner-name")).toContainText(/Alice wins/i);
    await expect(bob.getByTestId("standings")).toContainText("Alice");

    // only the host can restart
    await expect(bob.getByTestId("rematch")).toHaveCount(0);
    await expect(bob.getByTestId("waiting-rematch")).toBeVisible();
    await alice.getByTestId("rematch").click();
    await expect(alice.getByTestId("lobby")).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByTestId("lobby")).toBeVisible({ timeout: 20_000 });
    await expect(alice.getByTestId("player-count")).toContainText("2");

    // …and the new round deals a fresh deck
    await alice.getByTestId("start-game").click();
    await expect(alice.getByTestId("game-screen")).toBeVisible({ timeout: 20_000 });
    await expectDeckIntact(code);
    await b.context.close();
  });

  test("host can remove a player who then can't rejoin", async ({ page, browser }, info) => {
    test.setTimeout(90_000);
    const code = await createRoom(page, "Alice");
    const b = await newDevice(browser, info);
    await joinByLink(b.page, code, "Bob");

    const [{ id }] = await sql<{ id: string }>(
      "select p.id from game.players p join game.rooms r on r.id = p.room_id where r.code = $1 and p.name = 'Bob'",
      [code],
    );
    await page.getByTestId(`remove-player-${id}`).click();
    await expect(page.getByTestId("player-count")).toContainText("1");
    await expect(b.page.getByTestId("join-blocked")).toBeVisible({ timeout: 20_000 });

    // a bot can be added and removed too
    await page.getByTestId("add-bot").click();
    await expect(page.getByTestId("player-count")).toContainText("2");
    await b.context.close();
  });
});
