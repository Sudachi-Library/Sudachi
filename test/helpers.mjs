// Shared bits for the browser tests: a static server for docs/ and a page with a pinned clock. Made-up people only.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
export const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
export async function serve() {
  const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
  await new Promise(r => server.on('listening', r));
  return { server, url: `http://localhost:${server.address().port}/index.html` };
}
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export { checker } from './helpers-node.mjs';
/** A phone (or desktop) page with the clock pinned, collecting page errors. seed: state (and roster) written before the app starts. */
export async function page(browser, { width = 390, height = 844, time = '2026-11-16T09:30:00+03:00', seed = null, shifts = null, mobile = width < 800 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' });
  const p = await ctx.newPage(), errors = [];
  if (time) await p.clock.install({ time: new Date(time) });
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|googleapis|gsi|fonts/.test(m.text())) errors.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  await p.route(/accounts\.google\.com/, r => r.fulfill({ status: 200, body: '' }));
  if (seed || shifts) await p.addInitScript(([s, sh]) => { if (s && !localStorage.getItem('sudachi.state.v1')) localStorage.setItem('sudachi.state.v1', JSON.stringify(s)); if (sh && !localStorage.getItem('sudachi.shifts')) localStorage.setItem('sudachi.shifts', JSON.stringify(sh)); }, [seed, shifts]);
  return { p, ctx, errors };
}
export { chromium };
