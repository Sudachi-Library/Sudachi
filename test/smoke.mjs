// Every tab and the main sheets render at phone and desktop sizes (and in each interface) with made-up data, with no page
// errors, no stray "undefined" / "NaN" / "null" on screen and no sideways scroll. Logging, finishing, the brain dump, the
// story and search are exercised. Run: node test/smoke.mjs
import { chromium, serve, page, sleep, checker } from './helpers.mjs';
import { shifts, state } from './fixture.mjs';
import fs from 'node:fs'; import path from 'node:path';
const shots = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'shots/smoke'); fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });
const { server, url } = await serve(), browser = await chromium.launch(), { check, bad } = checker();
const TABS = ['today', 'library', 'backlog', 'review', 'more'];
const clean = async (p, sel, what) => {
  const txt = await p.locator(sel).first().innerText();
  check(txt.length > 30, `${what} renders (${txt.length} chars)`);
  check(!/\bundefined\b|\bNaN\b|\bnull\b|\[object Object\]/.test(txt), `${what}: no undefined / NaN / null`);
  check(!/hit a problem/.test(txt), `${what}: no crash card`);
  return txt;
};
const state0 = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('sudachi.state.v1') || 'null'));
for (const [w, hgt, time, ui] of [[390, 844, '2026-11-16T19:30:00+03:00', 'sudachi'], [320, 640, '2026-11-22T10:00:00+03:00', 'arcade'], [1500, 900, '2026-11-14T15:00:00+03:00', 'zine'], [390, 844, '2026-11-17T21:00:00+03:00', 'paper']]) {
  console.log(`${w}px at ${time.slice(5, 16)} (${ui})`);
  const { p, ctx, errors } = await page(browser, { width: w, height: hgt, time, seed: state, shifts });
  await p.addInitScript((u) => localStorage.setItem('sudachi.ui', JSON.stringify({ ui: u, size: 'normal' })), ui);
  await p.route(/anilist|openlibrary|googleapis\.com\/books|wikidata|steamstatic|musicbrainz|coverartarchive/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.goto(url); await sleep(600);
  for (const t of TABS) {
    if (t === 'more') await p.click('#btnMore'); else await p.click(`nav.tabs button[data-view=${t}]`);
    await sleep(300);
    await clean(p, `#view-${t}`, t);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check(over <= 1, `${t}: no sideways scroll (${over}px)`);
    await p.screenshot({ path: `${shots}/${w}-${ui}-${t}.png`, fullPage: true });
  }
  const sheetCheck = async (open, what) => { await open(); await sleep(400); const t = await clean(p, '.sheet', what); await p.screenshot({ path: `${shots}/${w}-${ui}-${what.replace(/\W+/g, '-')}.png` }); const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check(over <= 1, `${what}: no sideways scroll`); for (let i = 0; i < 3 && await p.locator('.sheet').count(); i++) { await p.keyboard.press('Escape'); await sleep(300); } return t; };
  const tab = async (t) => { if (t === 'more') await p.click('#btnMore'); else await p.click(`nav.tabs button[data-view=${t}]`); await sleep(200); };
  // Today
  await tab('today');
  const today = await p.locator('#view-today').innerText();
  check(/Pick for today/.test(today) && /On the shelf/.test(today) && /This week/i.test(today), 'Today: pick, shelf, week');
  if (time.startsWith('2026-11-22')) check(/After a night/.test(today), 'Today knows you came off a night');
  if (time.startsWith('2026-11-14')) check(/Day off/.test(today), 'Today knows it is a day off');
  if (time.startsWith('2026-11-16')) check(/Still on these/.test(today) && /Test Quest/.test(today), 'still on this? for the old game');
  await sheetCheck(() => p.click('#view-today .shelf .pc-hit >> nth=0'), 'item sheet');
  // +1 episode on the shelf
  const before = (await state0(p)).media.a1.progress;
  const plus = p.locator('#view-today .shelf .pc:has-text("Test Sky Garden") button:has-text("+1 ep")');
  if (await plus.count()) { await plus.first().click(); await sleep(300); check((await state0(p)).media.a1.progress === before + 1, '+1 ep from the shelf'); }
  // finish from the shelf
  await p.click('#view-today .shelf .pc:has-text("The Test Kitchen") button.finish'); await sleep(400);
  await clean(p, '.sheet', 'finish sheet');
  await p.click('.sheet .tierpick button[data-t="A+"]'); await p.click('.sheet .flags button:has-text("Comfort")'); await p.click('.sheet button:has-text("Save")'); await sleep(400);
  let s = await state0(p); check(s.media.s1.status === 'done' && s.media.s1.score === 9 && s.media.s1.flags.comfort && s.media.s1.startedAt === '2026-11-10', 'finished with A+ and ♥, start date kept');
  await sheetCheck(() => p.click('#btnLog'), 'log sheet');
  await sheetCheck(() => p.click('#view-today .qbar button:has-text("Add")'), 'add sheet');
  // Library
  await tab('library');
  await p.fill('#view-library .lib-search', 'test film'); await sleep(300);
  check(await p.locator('#view-library .pc').count() === 1, 'library search finds the film by its English title');
  check(await p.evaluate(() => document.activeElement?.classList.contains('lib-search')), 'typing keeps the focus');
  await p.fill('#view-library .lib-search', ''); await sleep(200);
  await p.click('#view-library .seg[aria-label=View] button[aria-label=List]'); await sleep(200); await clean(p, '#view-library', 'library list'); await p.screenshot({ path: `${shots}/${w}-${ui}-library-list.png`, fullPage: true });
  await p.click('#view-library .kc:has-text("Books")'); await sleep(200); check((await p.locator('#view-library .lrow').count()) === 3, 'books filter: 3 books');
  await p.click('#view-library .kc:has-text("Albums")'); await sleep(200); check((await p.locator('#view-library .lrow').count()) === 2 && /Heard/.test(await p.locator('#view-library').innerText()), 'albums filter: 2 albums, Heard');
  await p.click('#view-library .kc >> nth=0'); await p.click('#view-library .seg[aria-label=View] button[aria-label="Poster wall"]'); await sleep(200);
  // Backlog: brain dump + Steam pile
  await tab('backlog');
  await p.fill('#view-backlog .dump-in', 'Test Dumped Book (book)\nfilm: Test Dumped Film\nTest Sky Garden [anime]'); await sleep(300);
  check(await p.evaluate(() => document.activeElement?.classList.contains('dump-in')), 'the brain dump keeps the focus while you type');
  const prev = await p.locator('#view-backlog .dump-prev').innerText(); check(/already/.test(prev), 'brain dump preview marks what you already have');
  await p.click('#view-backlog .dump button:has-text("Add 2")'); await sleep(400);
  s = await state0(p); check(Object.values(s.media).some(m => m.title === 'Test Dumped Book' && m.kind === 'book' && m.status === 'planned'), 'brain dump lands in the backlog');
  check(/From Steam/.test(await p.locator('#view-backlog').innerText()), 'Steam pile to sort');
  await p.click('#view-backlog .steam .tri:has-text("Unplayed Test Game") button:has-text("Want to")'); await sleep(300);
  s = await state0(p); check(s.media.g2.triage === 'want', 'sorted a Steam game: want to');
  await p.screenshot({ path: `${shots}/${w}-${ui}-backlog-after.png`, fullPage: true });
  // Review + story
  await tab('review');
  await p.click('#view-review button:has-text("Play the story")'); await sleep(500);
  check(await p.locator('.story').count() === 1, 'the story opens');
  await p.screenshot({ path: `${shots}/${w}-${ui}-story-1.png` });
  const slides = await p.locator('.st-bars i').count(); let txt = '';
  for (let i = 0; i < slides; i++) { txt += await p.locator('.st-stage').innerText() + '\n'; if (i === 3) await p.screenshot({ path: `${shots}/${w}-${ui}-story-4.png` }); await p.keyboard.press('ArrowRight'); await sleep(250); }
  check(!/\bundefined\b|\bNaN\b|\bnull\b/.test(txt) && /November 2026/.test(txt), `story: ${slides} slides, clean`);
  check(await p.locator('.story').count() === 0, 'the story closes after the last slide');
  await p.click('#view-review .seg button:has-text("Years")'); await sleep(300); await clean(p, '#view-review', 'year review'); await p.screenshot({ path: `${shots}/${w}-${ui}-review-year.png`, fullPage: true });
  // search
  await p.keyboard.press('/'); await sleep(200); await p.keyboard.type('classic'); await sleep(200);
  check((await p.locator('.search .item').count()) === 1, 'search finds a title'); await p.keyboard.press('Enter'); await sleep(400); check(await p.locator('.sheet .it-title').count() === 1, 'Enter opens it'); await p.keyboard.press('Escape'); await sleep(300);
  // import sheet
  await sheetCheck(() => p.keyboard.press('i'), 'import sheet');
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(bad() ? `\n${bad()} FAILED` : '\nall passed');
process.exit(bad() ? 1 : 0);
