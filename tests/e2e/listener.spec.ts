import { expect, test, type Page } from "@playwright/test";

const shots = "test-results/screenshots";

const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Vibii" }).getByRole("link", { name, exact: true });

async function audioState(page: Page) {
  return page.evaluate(() => {
    const a = document.querySelectorAll("audio");
    return { count: a.length, t: a[0]?.currentTime ?? 0, paused: a[0]?.paused ?? true };
  });
}

test("all-skip onboarding → one reveal → one tap plays 1→5 → survives tab navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByTestId("demo-login").click();
  await page.getByRole("button", { name: "Let’s go" }).click();
  await page.getByRole("button", { name: /Taste only/ }).click();

  // Skip every question; the final Skip alone completes onboarding (no create/confirm step).
  let skips = 0;
  for (let i = 0; i < 60 && new URL(page.url()).pathname.startsWith("/onboarding"); i++) {
    const skip = page.getByTestId("skip");
    if (await skip.isVisible().catch(() => false)) {
      const q = await page.getByTestId("question").textContent().catch(() => null);
      await skip.click();
      skips++;
      await page.waitForFunction((prev) => document.querySelector("[data-testid=question]")?.textContent !== prev, q, { timeout: 5000 }).catch(() => {});
    } else await page.waitForTimeout(250);
  }
  expect(skips).toBe(9); // 12 core minus the 3 household screens auto-skipped on the taste-only path
  await page.waitForURL("**/");
  await expect(page.getByRole("heading", { name: "Your playlist is ready" })).toBeVisible({ timeout: 30_000 });
  const covers = page.locator("ol img");
  await expect(covers).toHaveCount(5);
  const srcs = await covers.evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
  expect(new Set(srcs).size).toBe(5);
  await page.screenshot({ path: `${shots}/reveal-390.png` });

  // One tap.
  await page.getByRole("button", { name: "▶ Play" }).click();
  await expect(page.getByTestId("track-title")).toHaveText(/.+/);
  await expect.poll(async () => (await audioState(page)).t, { timeout: 15_000 }).toBeGreaterThan(1);
  const first = await page.getByTestId("track-title").textContent();
  const firstCover = await page.locator("main img").first().getAttribute("src");
  await page.screenshot({ path: `${shots}/player-390.png` });

  // Seek near the end; the queue advances by itself and the artwork changes.
  await page.getByTestId("seek").fill("46");
  await expect.poll(() => page.getByTestId("track-title").textContent(), { timeout: 20_000 }).not.toBe(first);
  expect(await page.locator("main img").first().getAttribute("src")).not.toBe(firstCover);
  expect((await audioState(page)).paused).toBe(false);

  // Navigate tabs: same single audio element keeps playing.
  await tab(page, "My vibes").click();
  await page.waitForURL("**/my-vibes");
  const s1 = await audioState(page);
  expect(s1.count).toBe(1);
  expect(s1.paused).toBe(false);
  // External recommendations are links, never local playback controls.
  await expect(page.getByRole("link", { name: /Open in Spotify/ }).first()).toBeVisible();
  await expect(page.locator("main").getByRole("slider")).toHaveCount(0);
  await expect(page.getByText("Concept art · not the official cover")).toBeVisible();
  await page.screenshot({ path: `${shots}/my-vibes-390.png` });

  await tab(page, "create new").click();
  await page.waitForURL("**/create");
  const s2 = await audioState(page);
  expect(s2.count).toBe(1);
  expect(s2.paused).toBe(false);
  await page.screenshot({ path: `${shots}/create-390.png` });

  await tab(page, "DJ Vibii").click();
  await page.waitForURL(/\/$/);
  expect((await audioState(page)).count).toBe(1);

  // Pause via keyboard.
  await page.getByTestId("play-toggle").focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);

  // Tabs fit in one row at 390px (no truncation).
  const tabs = page.getByRole("navigation", { name: "Vibii" }).getByRole("link");
  await expect(tabs).toHaveText(["DJ Vibii", "My vibes", "create new"]);
  const boxes = await tabs.evaluateAll((els) => els.map((e) => ({ top: e.getBoundingClientRect().top, sw: e.scrollWidth, cw: e.clientWidth })));
  expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBe(1);
  for (const b of boxes) expect(b.sw).toBeLessThanOrEqual(b.cw);

  // Other widths + Hebrew RTL.
  await page.setViewportSize({ width: 430, height: 932 });
  await page.screenshot({ path: `${shots}/player-430.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${shots}/player-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: "vibii_lang", value: "he", url: "http://localhost:3100" }]);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(tab(page, "create new")).toBeVisible();
  await page.screenshot({ path: `${shots}/player-390-he.png` });
});

test("listeners cannot open the operator console or another user's audio", async ({ page, request }) => {
  await page.goto("/login");
  await page.getByTestId("demo-login").click();
  await page.waitForURL("**/onboarding");
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
  const api = await page.request.get("/api/admin/requests");
  expect(api.status()).toBe(403);
  const other = await page.request.get("/api/tracks/00000000-0000-0000-0000-000000000000/url");
  expect(other.status()).toBe(404);
  const anon = await request.get("/api/player");
  expect(anon.status()).toBe(401);
});
