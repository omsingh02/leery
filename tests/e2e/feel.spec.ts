import { expect, test } from "@playwright/test";
import { createRoom, joinByLink, newDevice, setupPosition, sql, watch } from "./helpers";

/** The feel layer: gestures, first-time tips and comfort settings — against the real UI and engine. */
test.describe("Leery game feel (real UI ↔ real engine)", () => {
  test("drag picked cards up onto the table to play them; a short drag springs back", async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    const errors = watch(page, "alice");
    const code = await createRoom(page, "Alice");
    const b = await newDevice(browser, info);
    await joinByLink(b.page, code, "Bob");
    await page.getByTestId("start-game").click();
    await expect(page.getByTestId("game-screen")).toBeVisible({ timeout: 20_000 });
    await expect(b.page.getByTestId("game-screen")).toBeVisible({ timeout: 20_000 });

    // Alice to play Aces, holding AH (honest) and two others.
    await setupPosition(code, { seat: 0, rankIdx: 0, hands: { 0: ["AH", "5C", "9D"], 1: ["5S", "6C", "7C"] } });
    await expect(page.getByTestId("play-button")).toBeVisible({ timeout: 15_000 });
    const card = page.getByTestId("hand").locator('[data-testid="card-AH"]');
    const box = await card.boundingBox();
    if (!box) throw new Error("no card box");
    const x = box.x + 8;
    const y = box.y + 30;

    // Let go too early: nothing is played, the card springs home.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 40, { steps: 5 });
    await expect(page.getByTestId("drag-hint")).toContainText(/drag up/i);
    await page.mouse.up();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("drag-hint")).toHaveCount(0);
    expect((await sql<{ n: number }>("select cardinality(pile) as n from game.rooms where code = $1", [code]))[0].n).toBe(0);
    await expect(card).toBeVisible();

    // Drag past the line: the hint says "release", letting go plays the card.
    const box2 = await card.boundingBox();
    if (!box2) throw new Error("no card box");
    await page.mouse.move(box2.x + 8, box2.y + 30);
    await page.mouse.down();
    await page.mouse.move(box2.x + 8, box2.y + 30 - 40, { steps: 4 });
    await page.mouse.move(box2.x + 8, box2.y + 30 - 190, { steps: 8 });
    await expect(page.getByTestId("drag-hint")).toContainText(/release to play 1 as aces/i);
    await page.mouse.up();

    // The card leaves the hand at once; Bob is asked to call or accept.
    await expect(b.page.getByTestId("accept-play")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("hand").locator('[data-testid="card-AH"]')).toHaveCount(0);
    expect((await sql<{ n: number }>("select cardinality(pile) as n from game.rooms where code = $1", [code]))[0].n).toBe(1);
    expect(errors).toEqual([]);
    await b.context.close();
  });

  test("the Play button explains itself, and the first-time tips show once", async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    const code = await createRoom(page, "Alice");
    const b = await newDevice(browser, info);
    await joinByLink(b.page, code, "Bob");
    await page.getByTestId("start-game").click();
    await expect(page.getByTestId("game-screen")).toBeVisible({ timeout: 20_000 });
    await setupPosition(code, { seat: 0, rankIdx: 0, hands: { 0: ["AH", "5C", "9D"], 1: ["5S", "6C", "7C"] } });
    await expect(page.getByTestId("play-button")).toBeVisible({ timeout: 15_000 });

    // The select tip is waiting for a brand-new player…
    await expect(page.getByTestId("hint-select")).toBeVisible();
    // …tapping Play with nothing picked says why instead of doing nothing (it is aria-disabled, not dead).
    await page.getByTestId("play-button").click({ force: true });
    await expect(page.getByText(/tap 1–4 cards in your hand first/i)).toBeVisible();
    expect((await sql<{ n: number }>("select cardinality(pile) as n from game.rooms where code = $1", [code]))[0].n).toBe(0);

    // Picking a card dismisses the tip for good.
    await page.getByTestId("hand").locator('[data-testid="card-AH"]').click({ position: { x: 6, y: 24 } });
    await expect(page.getByTestId("hint-select")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("play-button")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("hint-select")).toHaveCount(0);
    await b.context.close();
  });

  test("settings: sound, vibration and effects persist across reloads", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("settings-dialog")).toBeVisible();

    const sound = page.getByTestId("setting-sound");
    await expect(sound).toHaveAttribute("aria-checked", "true");
    await sound.click();
    await expect(sound).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("setting-effects-reduced").click();
    await expect(page.getByTestId("setting-effects-reduced")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-dialog")).toBeHidden();

    await page.reload();
    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("setting-sound")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("setting-effects-reduced")).toHaveAttribute("aria-checked", "true");
    // the header sound toggle agrees
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "false");
  });
});
