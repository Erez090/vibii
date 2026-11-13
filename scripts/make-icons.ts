// Renders the PWA icons (PNG) from an inline SVG using Playwright's Chromium.
import { chromium } from "@playwright/test";
const svg = (size: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc49a"/><stop offset="1" stop-color="#f39a64"/></linearGradient>
<radialGradient id="b" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="#2a1840"/><stop offset="1" stop-color="#0d1222"/></radialGradient></defs>
<rect width="512" height="512" fill="url(#b)"/>
<text x="256" y="330" text-anchor="middle" font-family="Quicksand, Avenir Next, Helvetica, sans-serif" font-weight="500" font-size="230" fill="url(#g)">Vi</text></svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const s of [192, 512, 180]) {
    await p.setViewportSize({ width: s, height: s });
    await p.setContent(`<html><body style="margin:0">${svg(s)}</body></html>`);
    await p.screenshot({ path: `public/icons/${s === 180 ? "apple-touch-icon" : `icon-${s}`}.png` });
  }
  await b.close();
})();
