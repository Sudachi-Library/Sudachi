// The cloud, tested like a saboteur would: the Drive layout (a small core + 16 parts), only changed parts going up or coming
// down, a Drive copy from before the split, two devices editing at once, a mass delete from another device, a hung connection,
// a damaged part file, a library too big for localStorage, a cut-off save on the device, and two tabs at once.
// Made-up data only. Run: node test/cloud.mjs
import { chromium, serve, sleep, checker } from './helpers.mjs';
import { createFakeGoogle } from './fake-google.mjs';
import { shifts, state as fixture } from './fixture.mjs';

const { server, url } = await serve(), browser = await chromium.launch(), { check, bad } = checker();
const g = createFakeGoogle();
g.put('shifts.json', g.path(['My Apps', 'hub', 'mandarin']), shifts);
const ME = ['My Apps', 'hub', 'sudachi'], NOW = '2026-11-16T19:30:00+03:00';
const part = (i) => `media-${String(i).padStart(2, '0')}.json`;
const driveState = () => { const core = g.readJsonAt(ME, 'state.json'); if (!core) return null; const media = { ...(core.media || {}) }; for (let i = 0; i < 16; i++) Object.assign(media, g.readJsonAt(ME, part(i))?.media || {}); return { ...core, media }; };

async function device(label, { seed = null, ctx = null, width = 390, google = g } = {}) {
  ctx ||= await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 700, hasTouch: width < 700, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' });
  if (!ctx.__attached) { await google.attach(ctx); ctx.__attached = true; }
  const p = await ctx.newPage(); p.errors = []; p.label = label;
  p.on('pageerror', e => p.errors.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com|anilist|openlibrary|wikipedia|wikidata|musicbrainz|coverartarchive|steamstatic/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.clock.install({ time: new Date(NOW) });
  await p.addInitScript(([s]) => {
    if (!localStorage.getItem('sudachi.google')) localStorage.setItem('sudachi.google', JSON.stringify({ access_token: 'tok', exp: Date.now() + 3600e3, email: 'tester@example.com' }));
    if (s && !localStorage.getItem('sudachi.seeded')) { localStorage.setItem('sudachi.state.v1', JSON.stringify(s)); localStorage.setItem('sudachi.seeded', '1'); }
    localStorage.setItem('sudachi.ui', JSON.stringify({ ui: 'sudachi', size: 'normal', covers: false }));
  }, [seed]);
  await p.goto(url); await p.waitForSelector('#view-today.active');
  return { ctx, p };
}
const ours = (l) => l.filter(n => n === 'state.json' || /^media-\d\d\.json$/.test(n));
const resetCounts = () => { g.counts.up = 0; g.counts.down = 0; g.counts.upNames = []; g.counts.downNames = []; };
const S = (p) => p.evaluate(() => window.__sudachi.store.get());
const until = async (p, fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(150); } return false; };
const sync = async (p) => { await until(p, () => !window.__sudachi.rt.syncing); await p.evaluate(() => window.__sudachi.refreshAll(true)); await until(p, () => !window.__sudachi.rt.syncing, 15000); await sleep(300); };
const act = (p, fn, arg) => p.evaluate(([f, a]) => { const w = window.__sudachi; w.store.update(s => new Function('w', 's', 'a', `return (${f})(w, s, a)`)(w, s, a)); }, [fn.toString(), arg]);
const noCovers = (s) => ({ ...s, settings: { ...s.settings, custom: { look: { covers: false } } } });

console.log('the Drive layout');
const A = await device('phone', { seed: noCovers(fixture) });
await until(A.p, () => !!document.querySelector('.sheet') || true); await sleep(500); await sync(A.p);
const core = g.readJsonAt(ME, 'state.json'), nParts = [...Array(16).keys()].filter(i => g.readJsonAt(ME, part(i))).length;
check(core && !core.media && core.layout === 2 && nParts === 16, `state.json is a small core (no titles) and the titles sit in 16 parts (${nParts})`);
check(Object.keys(driveState().media).length === Object.keys(fixture.media).length, 'every title is on Drive, each in exactly one part');

console.log('only what changed moves');
resetCounts();
await act(A.p, (w, s) => w.M.logProgress(s, 'a1', { n: 1 }).state);
await sync(A.p);
check(ours(g.counts.upNames).length === 1 && /^media-\d\d\.json$/.test(ours(g.counts.upNames)[0]), `+1 episode uploads one part, not the library (${g.counts.upNames.join(', ')})`);
const B = await device('tablet', { width: 800 });
await sleep(400); await sync(B.p);
check(Object.keys((await S(B.p)).media).length === Object.keys(fixture.media).length, 'a fresh device reads everything');
await act(A.p, (w, s) => w.M.logProgress(s, 's1', { n: 1 }).state); await sync(A.p);
resetCounts(); await sync(B.p);
check(ours(g.counts.downNames).length === 1 && (await S(B.p)).media.s1.progress === 4, `the other device downloads only the one part that moved (${ours(g.counts.downNames).join(', ')})`);
resetCounts(); await sync(B.p);
check(!ours(g.counts.downNames).length && !ours(g.counts.upNames).length, `a sync with nothing new moves none of the library (${[...g.counts.downNames, ...g.counts.upNames].join(', ') || 'nothing at all'})`);

console.log('two devices editing at once');
await act(A.p, (w, s) => w.M.updateMedia(s, 'f2', { score: 10 }));
await act(B.p, (w, s) => w.M.addMedia(s, { id: 'fromB', kind: 'movie', title: 'Test Film From The Tablet', status: 'planned' }));
await act(B.p, (w, s) => w.M.updateMedia(s, 'b1', { progress: 200 }));
await sync(A.p); await sync(B.p); await sync(A.p);
const [sa, sb] = [await S(A.p), await S(B.p)];
check(sa.media.f2.score === 10 && sb.media.f2.score === 10 && sa.media.fromB && sa.media.b1.progress === 200, 'both devices end up with both sets of edits');

console.log('a mass delete on another device');
const ids = Object.keys(sb.media).slice(0, 30);
for (let i = 0; i < 12; i++) await act(B.p, (w, s, a) => { let x = s; for (let k = 0; k < 40; k++) x = w.M.addMedia(x, { id: `bulk-${a}-${k}`, kind: 'book', title: `Test Bulk Book ${a}-${k}`, status: 'planned' }); return x; }, i);
await sync(B.p); await sync(A.p);
const total = Object.keys((await S(A.p)).media).length;
const victims = Object.keys((await S(B.p)).media).filter(id => id.startsWith('bulk-')).slice(0, Math.ceil(total * 0.25));
await act(B.p, (w, s, a) => { let x = s; for (const id of a) x = w.M.deleteMedia(x, id); return x; }, victims);
await sync(B.p); await sync(A.p);
check(await until(A.p, () => /were removed on another device/.test(document.querySelector('.sheet')?.innerText || ''), 4000), `the phone stops and asks (${victims.length} of ${total} titles removed elsewhere)`);
check(g.tree().some(l => /before-mass-delete/.test(l)), 'a copy from just before is kept on Drive');
await A.p.click('.sheet button:has-text("Bring them back")'); await sleep(400);
await sync(A.p); await sync(B.p);
check((await S(B.p)).media[victims[0]] && (await S(A.p)).media[victims[3]], 'Bring them back restores them on both devices');

console.log('a dead connection');
g.faults.hang = 1;
const t0 = Date.now();
await A.p.evaluate(() => { window.__sudachi.refreshAll(false); });
await sleep(400); await A.p.clock.fastForward(35000); await sleep(600);
check(await until(A.p, () => !window.__sudachi.rt.syncing, 5000), `a request that never answers times out; syncing does not freeze (${Math.round((Date.now() - t0) / 1000)} s real time)`);
check(await A.p.evaluate(() => window.__sudachi.rt.nextRetry > Date.now() || !(window.__sudachi.rt.lastProblems || []).length), 'and it either recovered by itself or a retry is scheduled');
check(await A.p.evaluate(() => window.__sudachi.G.stats.timeouts) >= 1, 'the timeout is counted for Diagnostics');
g.faults.hang = 0;
await sync(A.p);
check(await A.p.evaluate(() => !(window.__sudachi.rt.lastProblems || []).length), 'the next sync works');
await A.p.click('#btnMore'); await sleep(300);
check(/Everything is saved to Drive/.test(await A.p.locator('#view-more .cloud').innerText()), 'Settings says in plain words that everything is saved');

console.log('a damaged part on Drive');
const dmg = part(3), dmgId = g.path(ME, false) && [...g.files.values()].find(f => f.name === dmg && !f.trashed);
dmgId.content = Buffer.from('{"part":3,"media":{"x":{'); dmgId.appProperties = { ...dmgId.appProperties, rev: 'broken' }; g.touch(dmgId);
await sync(A.p); await sync(A.p);
check(g.tree().some(l => /media-03\.damaged-/.test(l)), 'the unreadable part is set aside (renamed), never overwritten');
check(!!g.readJsonAt(ME, dmg)?.media && Object.keys(driveState().media).length === Object.keys((await S(A.p)).media).length, 'a fresh good copy of that part is written from the device');

console.log('a library too big for browser storage');
await act(A.p, (w, s) => { let x = s; for (let k = 0; k < 2600; k++) x = w.M.addMedia(x, { id: `big-${k}`, kind: 'movie', title: `Test Big Library Film Number ${k} With A Long Original Title`, creator: 'Test Director Name', genres: ['Drama', 'Comedy', 'Romance'], status: 'done', score: 7, finishedAt: '2026-01-01', review: 'x'.repeat(220) }); return x; });
await sleep(800);
const ls = await A.p.evaluate(() => ({ main: !!localStorage.getItem('sudachi.state.v1'), flag: !!localStorage.getItem('sudachi.state.inIdb'), n: Object.keys(window.__sudachi.store.get().media).length, ok: window.__sudachi.store.persistence.ok }));
check(!ls.main && ls.flag && ls.ok, `over the limit, the library moves to IndexedDB only, still saved (${ls.n} titles)`);
await A.p.reload(); await A.p.waitForSelector('section.view.active'); await sleep(500);
check(Object.keys((await S(A.p)).media).length === ls.n, 'after a reload every title is still there');
resetCounts(); await sync(A.p);
check(ours(g.counts.upNames).length <= 17, `the big library goes up as parts (${ours(g.counts.upNames).length} files)`);
await act(A.p, (w, s) => w.M.updateMedia(s, 'big-5', { score: 9 })); resetCounts(); await sync(A.p);
check(ours(g.counts.upNames).length === 1, 'one change in a big library still sends one part');

console.log('a save cut off on the device');
await A.p.evaluate(async () => { const db = await new Promise(r => { const q = indexedDB.open('sudachi', 1); q.onsuccess = () => r(q.result); }); const all = await new Promise(r => { const q = db.transaction('slots').objectStore('slots').getAll(); q.onsuccess = () => r(q.result); }); const newest = all.sort((a, b) => b.savedAt - a.savedAt)[0]; await new Promise(r => { const t = db.transaction('slots', 'readwrite'); t.objectStore('slots').put({ ...newest, raw: newest.raw.slice(0, 5000), hi: newest.hi + 1e9, savedAt: Date.now() + 1 }); t.oncomplete = r; }); db.close(); });
await A.p.reload(); await A.p.waitForSelector('section.view.active'); await sleep(500);
check(Object.keys((await S(A.p)).media).length >= ls.n - 1, 'a half-written copy is skipped: the other slot loads');

console.log('two tabs at once');
const A2 = await device('phone, second tab', { ctx: A.ctx });
await sleep(400);
await act(A.p, (w, s) => w.M.addMedia(s, { id: 'tab1', kind: 'anime', title: 'Test Added In Tab One', status: 'planned' }));
check(await until(A2.p, () => !!window.__sudachi.store.get().media.tab1, 4000), 'the other tab sees a change within moments');
await act(A2.p, (w, s) => w.M.updateMedia(s, 'tab1', { score: 8.5 }));
check(await until(A.p, () => window.__sudachi.store.get().media.tab1?.score === 8.5, 4000), 'and the other way round');
g.faults.delay = 600;
await A.p.evaluate(() => { window.__sudachi.refreshAll(false); }); await sleep(150);
await A2.p.evaluate(() => window.__sudachi.refreshAll(false)); await sleep(100);
check(await A.p.evaluate(() => window.__sudachi.rt.syncing) && !(await A2.p.evaluate(() => window.__sudachi.rt.syncing)), 'only one tab talks to Drive at a time');
g.faults.delay = 0; await until(A.p, () => !window.__sudachi.rt.syncing, 20000);

console.log('a Drive copy from before the split (one big state.json)');
const g2 = createFakeGoogle(), at = Date.parse('2026-11-10T10:00:00Z');
g2.put('state.json', g2.path(ME), { app: 'sudachi', version: 1, updatedAt: at, media: { old1: { id: 'old1', kind: 'book', title: 'Test Book From An Old Version', status: 'done', score: 8, at, createdAt: at } }, deleted: {}, stamps: {}, settings: { custom: { look: { covers: false } } }, meta: {}, migrated: { from: 'skipped', at, counts: {} } });
const C = await device('old-layout device', { google: g2 }); await sleep(400); await sync(C.p);
check(!!(await S(C.p)).media.old1, 'the old single-file copy is read');
const c2 = g2.readJsonAt(ME, 'state.json'), inParts = [...Array(16).keys()].some(i => g2.readJsonAt(ME, part(i))?.media?.old1);
check(c2 && !c2.media && inParts, 'and rewritten as core + parts on the next save');
// an old-version device writes the single file again (with a new title): the new layout still picks it up
const f = [...g2.files.values()].find(x => x.name === 'state.json' && !x.trashed); f.content = Buffer.from(JSON.stringify({ ...c2, media: { old2: { id: 'old2', kind: 'movie', title: 'Test Film From An Old Device', status: 'planned', at: at + 9e6, createdAt: at } } })); f.appProperties = { ...f.appProperties, rev: 'old-device' }; g2.touch(f);
await sync(C.p);
check(!!(await S(C.p)).media.old2 && !!(await S(C.p)).media.old1, 'a title written by an old-version device still arrives');

check([A, B, A2, C].every(d => !d.p.errors.length), `no page errors${[A, B, A2, C].flatMap(d => d.p.errors).slice(0, 2).join(' | ')}`);
await browser.close(); server.close();
console.log(bad() ? `\n${bad()} FAILED` : '\nall passed');
process.exit(bad() ? 1 : 0);
