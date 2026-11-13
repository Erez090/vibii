// Live smoke check against the public link: invite gate + guest start + first question.
// Usage: node scripts/live/live-check.mjs <base-url> <invite-code>
import { chromium } from "@playwright/test";

const [base, invite] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const out = {};
await page.goto(`${base}/login`);
await page.getByTestId("invite-input").fill("wrong-code");
await page.getByTestId("demo-login").click();
await page.getByRole("alert").waitFor({ timeout: 15000 });
out.wrongInvite = (await page.getByRole("alert").textContent())?.trim();
await page.goto(`${base}/login?invite=${encodeURIComponent(invite)}`);
out.prefilled = await page.getByTestId("invite-input").inputValue();
await page.screenshot({ path: "test-results/live-login.png" });
await page.getByTestId("demo-login").click();
await page.waitForURL("**/onboarding", { timeout: 20000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: "test-results/live-onboarding.png" });
out.onboardingText = (await page.locator("main").innerText()).slice(0, 200).replace(/\s+/g, " ");
console.log(JSON.stringify(out, null, 2));
await browser.close();
