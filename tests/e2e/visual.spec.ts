import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { createRoom, expectHand, joinByLink, newDevice, setupPosition, sql } from "./helpers";

/**
 * On-demand visual tour (not part of the normal run):
 *   E2E_VISUAL=1 npx playwright test           → mobile + desktop screenshots in $E2E_SHOTS (default test-results/shots)
 * Walks real players through every screen so the layouts can be eyeballed.
 */
const OUT = process.env.E2E_SHOTS ?? "test-results/shots";

test.describe("@visual", () => {
  test("tour of every screen", async ({ page, browser }, info) => {
    test.setTimeout(240_000);
    fs.mkdirSync(OUT, { recursive: true });
    const tag = info.project.name;
    const shot = async (p: Page, name: string) => {
      await p.waitForTimeout(450); // let entrance animations settle
      await p.screenshot({ path: `${OUT}/${tag}-${name}.png` });
    };

    await page.goto("/");
    await shot(page, "01-home");

    // --- lobby: Alex hosts, Mira joins, two bots ---
    const code = await createRoom(page, "Alex");
    const mira = await newDevice(browser, info);
    await joinByLink(mira.page, code, "Mira");
    await page.getByTestId("add-bot").click();
    await expect(page.getByTestId("player-count")).toContainText("3");
    await page.getByTestId("add-bot").click();
    await expect(page.getByTestId("player-count")).toContainText("4");
    await page.getByTestId("speed-blitz").click();
    await shot(page, "02-lobby-host");
    await shot(mira.page, "03-lobby-guest");

    await page.getByTestId("start-game").click();
    await expect(page.getByTestId("game-screen")).toBeVisible({ timeout: 20_000 });
    await expect(mira.page.getByTestId("game-screen")).toBeVisible({ timeout: 20_000 });

    // --- Alex's turn, required rank 7: he holds two 7s ---
    const alexHand = ["AS", "3H", "3D", "7S", "7H", "9C", "10D", "JH", "JS", "QC", "KD", "KH"];
    await setupPosition(code, {
      seat: 0,
      rankIdx: 6,
      hands: {
        0: alexHand,
        1: ["2C", "4H", "5S", "6D", "8C", "9H", "10C", "QD", "KS"],
        2: ["AC", "2D", "4S", "5H", "6C", "8D", "9S", "JC", "QH", "KC", "7C"],
        3: ["AD", "2H", "3C", "4D", "5D", "6H", "8H", "9D", "10H", "JD", "QS", "7D"],
      },
    });
    await expectHand(page, alexHand);
    await expect(page.getByTestId("play-button")).toBeVisible({ timeout: 15_000 });
    await shot(page, "04-game-my-turn");
    await shot(mira.page, "05-game-waiting");

    await page.getByTestId("select-honest").click();
    await shot(page, "06-game-selected");
    await page.getByTestId("play-button").click();

    // Deterministic tour: don't let a bot jump in before Mira can (bots call at random).
    const noBotCall = async () => {
      await expect.poll(async () => (await sql<{ status: string }>("select status from game.rooms where code = $1", [code]))[0].status).toBe("challenge");
      await sql("update game.rooms set bot_caller = null, act_at = null where code = $1", [code]);
    };
    await noBotCall();

    // challenge window: Mira may call or accept, Alex (the accused) waits
    await expect(mira.page.getByTestId("call-bluff")).toBeVisible({ timeout: 15_000 });
    await shot(mira.page, "07-challenge-can-call");
    await shot(page, "08-challenge-accused");

    // Mira calls — the cards are honest (two real 7s), so Mira picks up the pile
    await mira.page.getByTestId("call-bluff").click();
    await expect(page.getByTestId("reveal-overlay")).toBeVisible({ timeout: 10_000 });
    await shot(page, "09-reveal-honest");
    await shot(mira.page, "10-reveal-honest-caller");

    // --- the other verdict: Alex lies about Kings with two low cards and gets caught ---
    await expect(page.getByTestId("reveal-overlay")).toBeHidden({ timeout: 15_000 });
    await setupPosition(code, {
      seat: 0,
      rankIdx: 12,
      hands: { 0: alexHand, 1: ["2C", "4H", "5S", "6D", "8C", "9H"], 2: ["AC", "2D", "4S", "5H"], 3: ["AD", "2H", "3C", "4D"] },
    });
    await expectHand(page, alexHand);
    await expect(page.getByTestId("play-button")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("hand").locator('[data-testid="card-3H"]').click({ position: { x: 6, y: 24 } });
    await page.getByTestId("hand").locator('[data-testid="card-3D"]').click({ position: { x: 6, y: 24 } });
    await page.getByTestId("play-button").click();
    await noBotCall();
    await expect(mira.page.getByTestId("call-bluff")).toBeVisible({ timeout: 15_000 });
    await mira.page.getByTestId("call-bluff").click();
    await expect(page.getByTestId("reveal-overlay")).toBeVisible({ timeout: 10_000 });
    await shot(page, "11-reveal-bluff-liar");
    await shot(mira.page, "12-reveal-bluff-caller");

    // --- many cards: a big pile-up lands in one hand ---
    await expect(page.getByTestId("reveal-overlay")).toBeHidden({ timeout: 15_000 });
    const many: string[] = [];
    for (const r of ["A", "2", "3", "4", "5", "6", "7", "8"]) for (const s of ["S", "H", "D"]) many.push(`${r}${s}`);
    await setupPosition(code, { seat: 0, rankIdx: 2, hands: { 0: many, 1: ["KC", "QC"], 2: ["JC"], 3: ["10C", "9C"] } });
    await expectHand(page, many);
    await expect(page.getByTestId("play-button")).toBeVisible({ timeout: 15_000 });
    await shot(page, "13-game-24-cards");

    // --- the finish ---
    await setupPosition(code, { seat: 0, rankIdx: 0, hands: { 0: ["AH"], 1: ["5C", "6C", "7C"], 2: ["JC"], 3: ["10C", "9C"] } });
    await expectHand(page, ["AH"]);
    await page.getByTestId("hand").locator('[data-testid="card-AH"]').click({ position: { x: 6, y: 24 } });
    await page.getByTestId("play-button").click();
    await expect(page.getByTestId("game-over")).toBeVisible({ timeout: 30_000 });
    await shot(page, "14-game-over-winner");
    await expect(mira.page.getByTestId("game-over")).toBeVisible({ timeout: 30_000 });
    await shot(mira.page, "15-game-over-loser");

    await mira.context.close();
  });
});
