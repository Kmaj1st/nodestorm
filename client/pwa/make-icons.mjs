// Renders the PNG app icons in client/public/ from the SVGs, with the Chromium that Playwright already uses for e2e.
// Only needed when the artwork changes: node client/pwa/make-icons.mjs
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const here = new URL("./", import.meta.url);
const pub = new URL("../public/", import.meta.url);
const icons = [
  { svg: new URL("icon.svg", pub), out: "icon-192.png", size: 192 },
  { svg: new URL("icon.svg", pub), out: "icon-512.png", size: 512 },
  { svg: new URL("icon-maskable.svg", here), out: "icon-maskable-512.png", size: 512 },
  { svg: new URL("icon-maskable.svg", here), out: "apple-touch-icon.png", size: 180 },
];

const browser = await chromium.launch();
try {
  for (const { svg, out, size } of icons) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const src = `data:image/svg+xml;base64,${readFileSync(svg).toString("base64")}`;
    await page.setContent(`<body style="margin:0"><img src="${src}" width="${size}" height="${size}" style="display:block">`);
    await page.locator("img").evaluate((img) => img.decode());
    await page.screenshot({ path: new URL(out, pub).pathname, omitBackground: true });
    await page.close();
    console.log(`wrote public/${out}`);
  }
} finally {
  await browser.close();
}
