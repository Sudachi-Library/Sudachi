// Sudachi against an in-memory Google (Drive + sign-in): the first sign-in offers to bring the Library over from Citrus's
// state.json (with Undo), shifts come from Mandarin and aims from Citrus Plan, status.json is written to hub/sudachi only
// (titles, never notes), Citrus's files stay untouched, and two devices converge. Made-up data only. Run: node test/hub.mjs
import { chromium, serve, sleep, checker } from './helpers.mjs';
import { createFakeGoogle } from './fake-google.mjs';
import { shifts, goals } from './fixture.mjs';

const { server, url } = await serve(), browser = await chromium.launch(), { check, bad } = checker();
const at = Date.parse('2026-11-10T10:00:00Z');
const citrusState = { app: 'citrus', updatedAt: at, me: { id: '1', name: 'Dr Test Me' }, chores: { c1: { id: 'c1', title: 'not media', at } }, memos: { m1: { id: 'm1', title: 'memo', body: 'not media', at } },
  media: {
    cb1: { id: 'cb1', kind: 'book', title: 'Citrus Test Novel', creator: 'Test Writer', status: 'done', rating: 10, src: 'goodreads', extId: '1', finishedAt: '2026-10-01', at },
    cb2: { id: 'cb2', kind: 'book', title: 'Citrus Test Essay', status: 'doing', progress: 40, total: 200, src: 'manual', rating: 0, startedAt: '2026-11-10', log: [{ d: '2026-11-15', p: 20, m: 30 }], quotes: [{ id: 'q', t: 'A private test quote', p: 20, d: '2026-11-15' }], at },
    cf1: { id: 'cf1', kind: 'movie', title: 'Citrus Test Film', status: 'done', rating: 8, src: 'manual', finishedAt: '2026-11-15', runtime: 100, review: 'A private test review', at },
    cg1: { id: 'cg1', kind: 'game', title: 'Citrus Test Game', status: 'planned', src: 'steam', extId: '5', minutes: 0, at },
  }, mediaMeta: { goals: { book: 24 } }, deleted: { 'media:gone1': at } };
const plan = { app: 'citrus', updatedAt: '2026-11-16T05:00:00Z', days: {}, goals };

const g = createFakeGoogle();
g.put('state.json', g.path(['My Apps', 'hub', 'citrus']), citrusState);
g.put('plan.json', g.path(['My Apps', 'hub', 'citrus']), plan);
g.put('shifts.json', g.path(['My Apps', 'hub', 'mandarin']), shifts);

async function device(label, { width = 390 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 700, hasTouch: width < 700, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' });
  await g.attach(ctx);
  const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  await p.route(/anilist|openlibrary|googleapis\.com\/books|wikidata|wikipedia|steamstatic|musicbrainz|coverartarchive/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.clock.install({ time: new Date('2026-11-16T19:30:00+03:00') });
  await p.addInitScript(() => { if (!localStorage.getItem('sudachi.google')) localStorage.setItem('sudachi.google', JSON.stringify({ access_token: 'tok', exp: Date.now() + 3600e3, email: 'tester@example.com' })); });
  await p.goto(url); await p.waitForSelector('#view-today.active'); p.label = label;
  return { ctx, p };
}
const state = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('sudachi.state.v1') || 'null'));
const until = async (p, fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(150); } return false; };
const sync = async (p) => { await until(p, () => !window.__sudachi.rt.syncing); await p.evaluate(() => window.__sudachi.refreshAll(true)); await until(p, () => !window.__sudachi.rt.syncing); await sleep(300); };

console.log('first sign-in on the phone');
const A = await device('phone');
check(await until(A.p, () => !!document.querySelector('.sheet h2')?.textContent.includes('Bring your Library over')), 'offers to bring the Library over from Citrus');
const offer = await A.p.locator('.sheet').innerText();
check(/4 titles: 2 books · 1 film · 1 game/.test(offer), `says what it found (${offer.match(/Found in[^.]*/)?.[0]})`);
await A.p.click('.sheet button:has-text("Bring it over")'); await sleep(700);
let s = await state(A.p);
check(s.media.cb1 && s.media.cb1.auto && s.media.cb1.srcRating === 10 && s.media.cf1.score === 8 && !s.media.cf1.auto && s.media.cb2.log[0].n === 20 && s.meta.goals.book === 24, 'titles, reading log, goals came over; Goodreads rating converted, your own kept');
check(!s.chores && !s.memos && s.deleted['media:gone1'], 'chores and memos stay behind; deletions hold');
check(s.migrated?.from === 'citrus' && await A.p.locator('.toast button:has-text("Undo")').count() === 1, 'migration recorded, Undo offered');
check(await until(A.p, () => window.__sudachi.R.has()), 'the shifts were read from Mandarin');
check(await until(A.p, () => window.__sudachi.rt.hub.goals?.aims?.length === 2), 'the aims were read from Citrus Plan');
await A.p.click('nav.tabs button[data-view=today]'); await sleep(400);
const today = await A.p.locator('#view-today').innerText();
check(/Day shift/.test(today) && /Citrus Test Essay/.test(today), 'Today: the kind of day and the shelf');

console.log('what Citrus gets');
await A.p.evaluate(() => { const w = window.__sudachi; w.store.update(s => w.M.logProgress(s, 'cb2', { n: 10, date: '2026-11-16' }).state); });
await sync(A.p); await A.p.evaluate(() => window.__sudachi.publish()); await sleep(300);
const st = g.readJsonAt(['My Apps', 'hub', 'sudachi'], 'status.json');
check(st?.app === 'sudachi' && st.contract === 2 && /this week/.test(st.summary) && st.extra.week.films === 1 && st.extra.now.some(n => n.title === 'Citrus Test Essay') && st.extra.goals.books.target === 24, `status.json: "${st?.summary}"`);
check(!/private test (quote|review)/.test(JSON.stringify(st)), 'no notes or quotes in status.json');
check(!!g.readJsonAt(['My Apps', 'hub', 'sudachi'], 'state.json'), 'state.json in hub/sudachi');
check(JSON.stringify(g.readJsonAt(['My Apps', 'hub', 'citrus'], 'state.json')) === JSON.stringify(citrusState), "Citrus's file is untouched");

console.log('a second device');
const B = await device('desktop', { width: 1400 });
await sleep(500);
check(!(await B.p.locator('.sheet h2:has-text("Bring your Library over")').count()), 'the second device does not ask again');
await sync(B.p);
let sb = await state(B.p); check(sb.media.cb1 && sb.media.cb2.progress === 50, 'the desktop has the phone’s library');
await B.p.evaluate(() => { const w = window.__sudachi; w.store.update(s => w.M.addMedia(s, { id: 'nB', kind: 'anime', title: 'From the desktop', status: 'planned' })); });
await A.p.evaluate(() => { const w = window.__sudachi; w.store.update(s => w.M.deleteMedia(s, 'cg1')); }); await sleep(300);
await A.p.evaluate(() => { const w = window.__sudachi; w.store.update(s => w.M.finish(s, 'cb2', { date: '2026-11-16', score: 9 })); }); await sleep(200);
await sync(B.p); await sync(A.p); await sync(B.p);
const [ea, eb] = [await state(A.p), await state(B.p)];
check(ea.media.nB && eb.media.nB, 'a title added on the desktop reaches the phone');
check(!ea.media.cg1 && !eb.media.cg1, 'a title deleted on the phone stays deleted on both');
check(eb.media.cb2.status === 'done' && eb.media.cb2.score === 9, 'a finish on the phone reaches the desktop');
console.log('Drive layout: found by tag, then moved by Citrus');
const sud = g.path(['My Apps', 'hub', 'sudachi'], false);
check(g.files.get(sud)?.appProperties?.citrusApp === 'sudachi', 'Sudachi tagged its own folder (citrusApp=sudachi)');
check(g.readJsonAt(['My Apps', 'hub', 'sudachi'], 'status.json')?.drive?.byTag === true, 'status.json says drive.byTag');
// Citrus tags the folders it reads and moves them all under Citrus/, renamed (what organiseDrive does)
const tagAndMove = (oldPath, app, newPath) => { const id = g.path(oldPath, false), f = g.files.get(id); f.appProperties = { ...(f.appProperties || {}), citrusApp: app }; f.parents = [g.path(newPath.slice(0, -1))]; f.name = newPath.at(-1); g.touch(f); return id; };
tagAndMove(['My Apps', 'hub', 'sudachi'], 'sudachi', ['Citrus', 'Life', 'Media - Sudachi']);
tagAndMove(['My Apps', 'hub', 'mandarin'], 'mandarin', ['Citrus', 'Work', 'Mandarin']);
tagAndMove(['My Apps', 'hub', 'citrus'], 'citrus', ['Citrus', '00 Hub', 'Citrus']);
await A.p.evaluate(() => { const w = window.__sudachi; w.store.update(s => w.M.addMedia(s, { id: 'afterMove', kind: 'book', title: 'Written after the move', status: 'planned' })); });
await sync(A.p); await A.p.evaluate(() => window.__sudachi.publish()); await sleep(300);
check(g.readJsonAt(['Citrus', 'Life', 'Media - Sudachi'], 'state.json')?.media?.afterMove, 'after the move the phone writes into the moved folder');
const C = await device('fresh tablet', { width: 800 }); await sleep(400); await sync(C.p);
const sc = await state(C.p);
check(sc.media.afterMove && sc.media.cb1, 'a fresh device finds the moved folder by tag and has everything');
check(await until(C.p, () => window.__sudachi.R.has()), 'and still reads Mandarin’s shifts from their new place');
check(!g.path(['My Apps', 'hub', 'sudachi'], false), 'no My Apps/hub/sudachi is created again');
const twins = g.tree().filter(l => /(status|state)\.json/.test(l) && !/backups|citrus|mandarin/.test(l));
check(twins.length === new Set(twins).size, `no duplicate files (${twins.length})`);
check(!A.p.errors.length && !B.p.errors.length && !C.p.errors.length, `no page errors${[...A.p.errors, ...B.p.errors, ...C.p.errors].slice(0, 2).join(' | ')}`);
await browser.close(); server.close();
if (bad()) { console.log(`${bad()} hub check(s) FAILED`); process.exit(1); }
console.log('all passed');
