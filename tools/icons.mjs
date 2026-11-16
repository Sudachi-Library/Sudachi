// Draws the PNG icons from docs/icons/icon.svg (192, 512, and a 512 maskable with safe-zone padding). Run: node tools/icons.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs'; import path from 'node:path';
const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../docs/icons'), svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const b = await chromium.launch(), p = await b.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-512-maskable.png', 512, 0.12]]) {
  await p.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await p.setContent(`<html><body style="margin:0;background:${pad ? '#0f3b3a' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body></html>`);
  await p.screenshot({ path: path.join(dir, name), omitBackground: !pad });
}
await b.close(); console.log('icons written');
