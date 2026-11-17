// Sudachi — the media logger of the citrus family: books, comics & manga, games, anime, films and series. A cosy shelf for
// what you're on, streaming-style rows for what's next (planned around your shifts), and a collector's catalogue of
// everything, in a Cyber Pop × Pop-punk look. Split out of Citrus Maxima (16/11/2026), the last of the split. Sudachi owns
// all media; shifts come from Mandarin (hub/mandarin/shifts.json), goals from Citrus Plan (hub/citrus/plan.json). Vanilla ES
// modules, no build step.
import * as store from './store.js';
import { mergeStates } from './store.js';
import * as G from './google.js';
import * as R from './roster.js';
import * as D from './day.js';
import * as M from './media.js';
import * as T from './tiers.js';
import * as CZ from './custom.js';
import * as HUB from './hub.js';
import * as MIG from './migrate.js';
import * as RL from './relay.js';
import * as TU from './today-ui.js';
import * as LU from './library-ui.js';
import * as BU from './backlog-ui.js';
import * as VU from './review-ui.js';
import * as IU from './import-ui.js';
import * as IT from './item-ui.js';
import { ctx } from './bits.js';
import { coverEl } from './ui.js';
import * as CV from './covers.js';
import { checkBackup, describeCounts } from './backup-check.js';
import { h, toast, keyOf, fmtDate, pad2, DAY_NAMES, MONTHS, uid } from './util.js';

export const VERSION = '1.3.0';
const CITRUS_URL = 'https://amaerys.github.io/citrus-maxima/';
const MANDARIN_URL = 'https://mandarin-work.github.io/Mandarin/';

// ---------------- runtime state (not persisted) ----------------
const rt = {
  view: 'today',
  syncing: false,
  online: navigator.onLine,
  hub: { at: 0, shiftsAt: '', goals: null, goalsAt: '' },
  fromCitrus: false,
};
const $ = (s, el = document) => el.querySelector(s);
const S = () => store.get();

// ---------------- boot ----------------
async function boot() {
  applyTheme(); watchSheets(); applyLook();
  for (const b of document.querySelectorAll('nav.tabs button')) b.addEventListener('click', () => go(b.dataset.view));
  $('#btnRefresh').addEventListener('click', () => refreshAll(true));
  $('#btnMore').addEventListener('click', () => show('more'));
  $('#btnSearch').addEventListener('click', () => openSearch());
  $('#btnLog')?.addEventListener('click', () => IT.logSheet());
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if (e.key === 'Escape') { if (document.querySelector('.story')) return; const sr = document.querySelector('.search'); if (sr) { sr.remove(); e.stopImmediatePropagation(); return; } closeTopSheet(); return; }
    if (typing) return;
    if (e.key === '/' && !document.querySelector('.search')) { openSearch(); e.preventDefault(); return; }
    if (document.querySelector('.sheet-bg, .search, .story')) return;   // tab shortcuts never switch the page behind a sheet
    const tabs = CZ.visibleTabs(S());
    if (/^[1-4]$/.test(e.key) && tabs[+e.key - 1]) { show(tabs[+e.key - 1]); e.preventDefault(); }
    else if (e.key === 'r') { if (!rt.online) toast('Offline — Sudachi syncs when you are back online'); else refreshAll(true); }
    else if (e.key === ',') show('more');
    else if (e.key === 'l') { IT.logSheet(); e.preventDefault(); }
    else if (e.key === 'a') { IT.addSheet(); e.preventDefault(); }
    else if (e.key === 'd') { go('backlog', 'dump'); e.preventDefault(); }
    else if (e.key === 'i') { IU.importSheet(); e.preventDefault(); }
    else if (e.key === '?') { shortcutsSheet(); e.preventDefault(); }
  });
  window.addEventListener('online', () => { rt.online = true; renderSync(); });
  window.addEventListener('offline', () => { rt.online = false; renderSync(); });
  Object.assign(ctx, { S, update: (fn) => store.update(fn), sheet: (c) => sheet(c), render: () => render(), go: (v, p) => go(v, p), undoTo, cheer,
    goals: () => rt.hub.goals || { aims: [] }, kinds: kindsOf, hasShifts: () => R.has(), signedIn: () => G.isSignedIn(), migrateNow, importSheet: (w) => IU.importSheet(w),
    openItem: (id) => IT.openItem(id), finish: (id) => IT.finishSheet(id), sync: () => refreshAll(true) });
  store.subscribe(() => { applyLook(); render(); publishSoon(); coversSoon(); });
  store.onRemoteSync(scheduleRemoteSave);
  R.load(); loadHubCache();
  handleIncoming();
  if (!rt.handled) show(location.hash.replace('#', '') || CZ.custom(S()).start);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const cid = S().settings.clientId;
  G.onAuthChange(() => { renderSync(); render(); });
  G.renewOnTap(() => { render(); refreshAll(false); });   // the hourly token renews on your next tap (phones only allow Google's window inside a tap)
  if (cid && rt.online) {
    try { await G.init(cid); } catch (e) { console.warn(e); }
    if (G.isSignedIn()) refreshAll(false);
    else if (G.wasSignedIn()) { G.auth.needsSignIn = true; render(); }
  }
  navigator.storage?.persist?.().then(ok => { rt.storagePersisted = ok; }).catch(() => {});
  setInterval(() => {
    const busy = document.querySelector('.sheet-bg, .search, .story') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (rt.view === 'today' && document.visibilityState === 'visible' && !busy) render();
  }, 5 * 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flushRemoteSave(); return; }
    if (G.isSignedIn() && Date.now() - (S().google.lastSync || 0) > 2 * 60000) refreshAll(false);
    if (!document.querySelector('.sheet-bg, .story')) render();
  });
  window.addEventListener('pagehide', flushRemoteSave);
  setInterval(() => { if (document.visibilityState === 'visible' && G.isSignedIn() && rt.online && Date.now() - (S().google.lastSync || 0) > 5 * 60000) refreshAll(false); }, 60000);
  renderSync();
  coversSoon(3000);
}
/** Customise › Look: accent colour, stickers (tilted covers, tape), motion, real covers — synced, set on <html>. */
function applyLook() { const l = CZ.custom(S()).look, r = document.documentElement; r.dataset.accent = l.accent; r.dataset.stickers = l.stickers ? 'on' : 'off'; r.dataset.motion = l.motion ? 'on' : 'off'; }
/** A burst of stars and confetti from where you tapped (when motion is on and welcome). big: a finish. */
function cheer(from, big = false) {
  if (!CZ.custom(S()).look.motion || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = (from?.getBoundingClientRect?.() || { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 }), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const colors = ['#b8f03c', '#ff2e88', '#21d4fd', '#ff7a1a', '#a77bff', '#fff'];
  for (let i = 0; i < (big ? 26 : 12); i++) {
    const p = document.createElement('i'), a = Math.random() * Math.PI * 2, d = (big ? 70 : 40) + Math.random() * (big ? 140 : 70);
    p.className = 'confetti'; p.textContent = i % 4 === 0 ? '✦' : ''; p.style.cssText = `left:${x}px;top:${y}px;${i % 4 ? `background:${colors[i % colors.length]};` : `color:${colors[i % colors.length]};`}--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px;--r:${Math.random() * 540 - 270}deg;`;
    document.body.append(p); setTimeout(() => p.remove(), 1100);
  }
}
/** Undo to an earlier copy, so that it holds on every device (tombstones for what was added since, fresh times for what came back). */
function undoTo(before) { store.replaceState(before, { bump: true, exact: S() }); render(); toast('Undone'); }
/** The kind of day it is from Mandarin's shifts: {kind, label, text}. */
function kindsOf(date) {
  try { const k = D.dayKind(date); return { kind: k.kind, label: D.KIND_LABEL[k.kind] || 'Day', text: k.shift?.status === 'work' ? D.shiftText(k.shift) : '' }; }
  catch { return { kind: 'unknown', label: 'Rota not known', text: '' }; }
}

// Arriving from another app or a link: ?from=citrus shows "← Citrus"; ?do=<action> (or #view) jumps straight there.
const DO = { today: ['today'], log: ['today', 'log'], add: ['today', 'add'], shelf: ['library', 'shelf'], library: ['library'], backlog: ['backlog'], dump: ['backlog', 'dump'], import: ['today', 'import'], review: ['review'], story: ['review', 'story'], year: ['review', 'year'], relay: ['more', 'relay'], search: ['today', 'search'] };
function handleIncoming() {
  try {
    const q = new URLSearchParams(location.search);
    const from = String(q.get('from') || '').toLowerCase(), action = String(q.get('do') || '').toLowerCase();
    if (from === 'citrus') { rt.fromCitrus = true; try { sessionStorage.setItem('sudachi.fromCitrus', '1'); } catch {} }
    else { try { if (sessionStorage.getItem('sudachi.fromCitrus')) rt.fromCitrus = true; } catch {} }   // kept over a reload
    if (from === 'mandarin') rt.fromMandarin = true;
    const capture = /^#capture=/.test(location.hash) ? decodeURIComponent(location.hash.slice(9)).slice(0, 4000) : '';
    const target = capture ? ['backlog', 'capture'] : DO[action] || DO[location.hash.replace('#', '')] || null;
    if (q.toString() || capture) history.replaceState(null, '', location.pathname + (target ? `#${target[0]}` : location.hash || '#today'));
    if (!target) return;
    rt.handled = true; go(target[0], ['shelf', 'dump', 'story', 'year'].includes(target[1]) ? target[1] : undefined);
    const later = (fn) => setTimeout(fn, 300);
    if (target[1] === 'log') later(() => IT.logSheet());
    else if (target[1] === 'add') later(() => IT.addSheet());
    else if (target[1] === 'import') later(() => IU.importSheet());
    else if (target[1] === 'search') later(() => openSearch());
    else if (target[1] === 'relay') later(() => document.querySelector('#view-more .relay')?.scrollIntoView({ block: 'start' }));
    else if (target[1] === 'capture') later(() => { const items = M.parseDump(capture); if (!items.length) return; const before = S(), r = M.addDump(S(), items); store.update(() => r.state); toast(`${r.added} to the backlog`, 'ok', { action: { label: 'Undo', run: () => undoTo(before) } }); });
  } catch (e) { console.warn('incoming', e); }
}

// Shown at the top of every screen when the Google session needs a tap to come back
function authBanner() {
  if (!G.auth.needsSignIn || !rt.online) return null;
  return h('div', { class: 'banner' }, h('span', { class: 'grow' }, 'Google needs a tap to reconnect — nothing is lost, sync resumes after.'),
    h('button', { class: 'btn sm primary', onClick: async () => { try { await G.signIn({ renew: G.wasSignedIn() }); refreshAll(true); } catch (e) { try { await G.signIn(); refreshAll(true); } catch (e2) { toast(e2.message, 'err'); } } } }, 'Reconnect'));
}
/** "← Citrus" while you came from Citrus: one tap back, and Citrus toasts "Back from Sudachi" and refreshes its hub. */
function backBar() {
  if (!rt.fromCitrus && !rt.fromMandarin) return null;
  const to = rt.fromCitrus ? ['Citrus', `${CITRUS_URL}?from=sudachi`] : ['Mandarin', `${MANDARIN_URL}?from=sudachi`];
  return h('div', { class: 'back-bar' }, h('a', { class: 'btn sm ghost', href: to[1] }, `← ${to[0]}`), h('button', { class: 'btn sm ghost', 'aria-label': 'Hide', onClick: () => { rt.fromCitrus = rt.fromMandarin = false; try { sessionStorage.removeItem('sudachi.fromCitrus'); } catch {} render(); } }, '✕'));
}

const VIEWS = ['today', 'library', 'backlog', 'review', 'more'];
const VIEW_NAMES = { today: 'Today', library: 'Library', backlog: 'Backlog', review: 'Review', more: 'Settings' };
const OLD = { settings: 'more', shelf: 'library', mind: 'today' };
/** Bottom tabs / rail in your order; hidden ones disappear (Settings › Customise). Today and Settings always stay. */
function applyTabs(c) {
  const nav = document.querySelector('nav.tabs'); if (!nav) return;
  for (const id of c.tabs.order) { const b = nav.querySelector(`button[data-view="${id}"]`); if (b) nav.insertBefore(b, nav.querySelector('button[data-view="more"]')); }
  for (const b of nav.querySelectorAll('button[data-view]')) b.hidden = c.tabs.hidden.includes(b.dataset.view);
  nav.style.setProperty('--tabs', String(CZ.TABS.length - c.tabs.hidden.length));
}
function go(view, part) {
  if (view === 'library' && part) LU.libraryPart(part);
  if (view === 'backlog' && part) BU.backlogPart(part);
  if (view === 'review' && part) VU.reviewPart(part);
  show(view);
}
function show(view) {
  view = OLD[view] || view;
  if (!VIEWS.includes(view)) view = 'today';
  document.documentElement.dataset.view = view;
  rt.view = view;
  for (const s of document.querySelectorAll('section.view')) s.classList.toggle('active', s.id === `view-${view}`);
  for (const b of document.querySelectorAll('nav.tabs button')) { b.classList.toggle('active', b.dataset.view === view); if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  history.replaceState(null, '', `#${view}`);
  render();
  window.scrollTo(0, 0);
}
function render() {
  applyTabs(CZ.custom(S()));
  const fn = { today: TU.renderToday, library: LU.renderLibrary, backlog: BU.renderBacklog, review: VU.renderReview, more: renderMore }[rt.view] || TU.renderToday;
  const el = $(`#view-${rt.view}`); if (!el) return;
  const y = window.scrollY, act = document.activeElement, keep = ctx.refocus || (act && el.contains(act) && act.matches('input[type=search], .dump-in') ? (act.matches('.dump-in') ? '.dump-in' : `.${[...act.classList].find(c => /search|filter/.test(c)) || 'x'}`) : null);
  const caret = act?.selectionStart ?? null;
  ctx.refocus = null;
  let body;
  try { body = fn(); } catch (e) { console.error(e); body = crashCard(e); }   // one broken screen never blanks the app
  el.replaceChildren(...[backBar(), authBanner(), body].flat(Infinity).filter(Boolean));
  if (!el.querySelector('h1')) el.prepend(h('h1', { class: 'sr-only' }, VIEW_NAMES[rt.view] || 'Sudachi'));
  if (keep) { const i = el.querySelector(keep); if (i) { i.focus({ preventScroll: true }); try { const p = caret ?? i.value.length; i.setSelectionRange(p, p); } catch {} } }
  if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
  const pt = document.getElementById('pageTitle'); if (pt) pt.textContent = rt.view === 'today' ? '' : VIEW_NAMES[rt.view];
}
function crashCard(e) {
  return h('div', { class: 'card warn' }, h('div', { class: 'title' }, 'This screen hit a problem'), h('div', { class: 'small' }, 'Your data is safe. Try another tab, sync, or download a backup and tell Claude what you tapped.'),
    h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, String(e?.message || e).slice(0, 160)),
    h('div', { class: 'row wrap', style: { marginTop: '8px' } }, h('button', { class: 'btn sm', onClick: () => location.reload() }, 'Reload'), h('button', { class: 'btn sm', onClick: downloadBackup }, '⬇ Backup')));
}

// Interfaces: Sudachi (Cyber Pop × Pop-punk, the default) and the family's Arcade / Clean / Paper + text size, chosen per device
// (localStorage, never synced); index.html applies them before first paint.
const UI_KEY = 'sudachi.ui';
function getUi() { let u = {}; try { u = JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch {} if (!u.ui) u.ui = 'sudachi'; if (!u.size) u.size = 'normal'; return u; }
function setUi(patch) { const u = { ...getUi(), ...patch }; try { localStorage.setItem(UI_KEY, JSON.stringify(u)); } catch {} applyTheme(); render(); if (rt.view === 'more') document.querySelector('#view-more .ui-pick')?.scrollIntoView({ block: 'nearest' }); }
const THEME_COLOR = { sudachi: '#0b0a14', zine: '#f6f1e3', paper: '#F3F4F9', arcade: '#12141F', clean: '#0f1117' };
function applyTheme() { const u = getUi(), r = document.documentElement; r.dataset.ui = u.ui; r.dataset.size = u.size; r.dataset.theme = u.ui === 'paper' || u.ui === 'zine' ? 'light' : 'dark'; const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = THEME_COLOR[u.ui] || THEME_COLOR.sudachi; }

// ---------------- sync ----------------
function renderSync() {
  const dot = $('#syncDot'), txt = $('#syncText'), signed = G.isSignedIn();
  dot.className = 'sync ' + (rt.syncing ? 'busy' : signed && rt.online ? 'on' : '');
  txt.textContent = !rt.online ? 'offline' : rt.syncing ? 'syncing…' : signed ? (S().google.email || 'Google') : '';
}
// state.json is written at most every 2.5 s, only when its content changed, and only if no other device wrote it since we
// read it — otherwise Sudachi pulls, merges and writes the merged copy. Drive answers "anything new?" through its changes
// feed, so a sync where nothing moved is a single request; only what changed is read again.
let saveTimer = null, saving = null;
function scheduleRemoteSave() {
  if (!G.wasSignedIn()) return;
  rt.saveDirty = true;
  clearTimeout(saveTimer);
  if (!G.isSignedIn() || !rt.online) return;   // stays dirty: the next sync saves it
  saveTimer = setTimeout(() => saveStateNow().catch(e => console.warn('remote save failed', e.message)), 2500);
}
function flushRemoteSave() { if (rt.saveDirty && G.isSignedIn() && rt.online) { clearTimeout(saveTimer); saveStateNow().catch(() => {}); } }
async function saveStateNow() {
  if (saving) { await saving.catch(() => {}); if (!rt.saveDirty) return; }
  saving = (async () => {
    const root = S().settings.driveFolder;
    rt.saveDirty = false;
    if (store.needsMerge()) await pullState(true);              // a copy recovered from damage never goes out before Drive's is merged in
    try { await G.saveRemoteState(root, stripForRemote(S())); }
    catch (e) {
      if (!e.conflict) { rt.saveDirty = true; throw e; }
      await pullState(true);                                   // someone else saved first: take theirs in, then write the union
      try { await G.saveRemoteState(root, stripForRemote(S()), { force: true }); } catch (e2) { rt.saveDirty = true; throw e2; }
    }
    rt.lastSave = Date.now();
  })().finally(() => { saving = null; });
  return saving;
}
// what goes to Drive: everything except what belongs to this device (sync bookkeeping, calendar outbox)
function stripForRemote(s) { const { outbox, google, ...rest } = s; return rest; }
const comparable = (s) => G.fingerprint(stripForRemote(s || {}), ['updatedAt']);
/** Read state.json and merge it in. Writes back only if the merged copy holds something Drive doesn't. */
async function pullState(fromConflict = false) {
  const remote = await G.loadRemoteState(S().settings.driveFolder);
  if (!remote) { store.merged(); scheduleRemoteSave(); return false; }
  if (typeof remote !== 'object' || (remote.app && remote.app !== 'sudachi')) throw new Error('state.json on Drive is not Sudachi’s — kept your copy (backups are in hub/sudachi/backups)');
  const force = fromConflict || store.needsMerge(); store.merged();
  if ((!force && (remote.updatedAt || 0) === (S().updatedAt || 0)) || comparable(remote) === comparable(S())) return false;
  const merged = mergeStates(S(), remote);
  merged.updatedAt = Math.max(S().updatedAt || 0, remote.updatedAt || 0) + (comparable({ ...merged, updatedAt: 0 }) !== comparable({ ...remote, updatedAt: 0 }) ? 1 : 0);
  store.replaceState(merged);
  if (comparable(merged) !== comparable(remote)) { if (fromConflict) rt.saveDirty = true; else scheduleRemoteSave(); }
  rt.lastPull = Date.now();
  return true;
}
const WATCH_KEY = 'sudachi.drive.watch';
function loadWatch() { try { const w = JSON.parse(localStorage.getItem(WATCH_KEY) || 'null'); return w && w.root === S().settings.driveFolder ? w : null; } catch { return null; } }
function saveWatch(w) { rt.watch = w; try { w ? localStorage.setItem(WATCH_KEY, JSON.stringify(w)) : localStorage.removeItem(WATCH_KEY); } catch {} }

async function refreshAll(manual, { full = false } = {}) {
  if (!rt.online && manual) { toast('Offline — Sudachi syncs when you are back online'); return; }
  if (!G.isSignedIn()) { if (manual) toast(G.wasSignedIn() ? 'Google needs a tap to reconnect' : S().settings.clientId ? 'Sign in to Google in Settings' : 'Add your Google client ID in Settings'); render(); return; }
  if (!rt.online) { if (manual) toast('You are offline'); return; }
  if (rt.syncing) { if (manual) toast('Already syncing…'); return; }   // one sync at a time
  rt.syncing = true; renderSync();
  const root = S().settings.driveFolder, problems = [];
  const step = async (label, fn) => { try { await fn(); } catch (e) { problems.push(`${label}: ${e.message}`); } };
  const t0 = performance.now();
  try {
    // 1. what moved on Drive since last time?
    let watch = loadWatch(), plan = null, newToken = '';
    const stale = !watch?.token || Date.now() - (watch.fullAt || 0) > 12 * 3600000;   // a full pass at least twice a day, whatever the feed says
    if (!full && !manual && !stale) {
      try { const ch = await G.changesSince(watch.token); if (ch) { newToken = ch.token; plan = classifyChanges(ch.changes, watch); if (ch.more) plan = null; } }
      catch (e) { if (e.auth) throw e; }
    }
    if (!plan) { G.reverify(); newToken = await G.startToken().catch(() => ''); plan = { full: true, state: true, hub: true }; }
    if (!G.seenStateRev() && !rt.stateLoaded) plan.state = true;   // read state.json once per app session at least
    rt.syncMode = plan.full ? 'full' : plan.state || plan.hub ? 'changes' : 'nothing new';
    // 2. state first (the merge decides what everything else shows), then the hub
    if (plan.state) await step('state', async () => { await pullState(); rt.stateLoaded = true; });
    await Promise.all([
      step('account', async () => { if (!S().google.email) { const u = await G.userInfo(); store.update(s => ({ ...s, google: { ...s.google, email: u.email } }), { remote: false, silent: true }); } }),
      plan.hub || !rt.hub.at || Date.now() - rt.hub.at > 10 * 60000 ? step('hub', () => syncHub({ full: plan.full })) : null,
    ]);
    // 3. Steam (at most every 6 hours, when the relay is set up), unsaved local changes
    if (steamDue()) await step('steam', () => IU.steamSync('', { preview: false }));
    if (rt.saveDirty) await step('save', saveStateNow);
    // 4. remember where we are in the feed — only when everything worked, so a failed step is retried next time
    if (!problems.length && newToken) {
      const next = { ...(watch || {}), root, token: newToken };
      if (plan.full) Object.assign(next, await G.watchedFolders(root).catch(() => ({})), { fullAt: Date.now() });
      saveWatch(next);
    }
    // 5. a daily snapshot on Drive (14 kept), then tell the other apps
    if (!problems.length) G.backupDaily(root, stripForRemote(S()), keyOf(new Date())).catch(e => console.warn('backup', e.message));
    await step('publish', publish);
    store.update(s => ({ ...s, google: { ...s.google, lastSync: Date.now() } }), { remote: false, silent: true });
    rt.lastProblems = problems; rt.lastSyncMs = Math.round(performance.now() - t0);
    if (manual) toast(problems.length ? 'Synced with issues — see Settings › Diagnostics' : 'Synced', problems.length ? 'err' : 'ok');
    else if (problems.length) console.warn(problems);
  } catch (e) {
    rt.lastProblems = [e.message];
    if (manual) toast(e.message, 'err');
  } finally { rt.syncing = false; renderSync(); render(); }
}
/** Turn a page of Drive changes into the smallest sync that covers them. null = can't tell, do a full pass. */
function classifyChanges(changes, w) {
  const plan = { state: false, hub: false };
  const roots = new Set([w.hub, w.me].filter(Boolean));
  for (const c of changes) {
    if (roots.has(c.id) && (c.removed || c.trashed || !(c.parents || []).length)) { G.forgetFolders(); return null; }   // one of our folders vanished: rebuild
    const par = c.parents || [];
    if (par.includes(w.me) && c.name === 'state.json' && (c.props?.rev || '') !== G.seenStateRev()) plan.state = true;
    if (w.mandarin && par.includes(w.mandarin) && c.name === 'shifts.json') plan.hub = true;
    if (w.citrus && par.includes(w.citrus) && c.name === 'plan.json') plan.hub = true;
    const tag = c.props?.citrusApp;   // folders are found by tag: a tagged folder Sudachi uses that is new to it (or was re-tagged) means look again
    if (c.mimeType === 'application/vnd.google-apps.folder' && ['sudachi', 'mandarin', 'citrus'].includes(tag) && c.id !== w[tag === 'sudachi' ? 'me' : tag]) { G.forgetFolders(); return null; }
  }
  return plan;
}

// ---------------- the hub: what Sudachi reads from other apps, and what it publishes ----------------
const HUB_KEY = 'sudachi.hub';
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Only the aims from Citrus Plan (a yearly goal can link to one). */
const cleanGoals = (g) => ({ aims: (Array.isArray(g?.aims) ? g.aims : []).filter(a => isObj(a) && a.id && a.title).slice(0, 60).map(a => ({ id: String(a.id).slice(0, 60), title: String(a.title).slice(0, 120), done: !!a.done })) });
function loadHubCache() { try { const j = JSON.parse(localStorage.getItem(HUB_KEY) || 'null'); if (j && typeof j === 'object') rt.hub = { ...rt.hub, ...j, goals: j.goals ? cleanGoals(j.goals) : null }; } catch {} }
function saveHubCache() { try { localStorage.setItem(HUB_KEY, JSON.stringify(rt.hub)); } catch {} }
/** Read Mandarin's shifts.json and Citrus's plan.json (goals) and — until the Library is taken over — Citrus's state (once). Read only. */
async function syncHub() {
  const root = S().settings.driveFolder;
  const [sh, pl] = await Promise.all([G.readOtherFile(root, 'mandarin', 'shifts.json').catch(() => null), G.readOtherFile(root, 'citrus', 'plan.json').catch(() => null)]);
  if (sh?.data) { if (R.set(sh.data)) { rt.hub.shiftsAt = sh.modifiedTime || ''; rt.hub.shiftsError = ''; } else rt.hub.shiftsError = 'Mandarin’s shifts.json could not be read'; }
  else rt.hub.shiftsError = 'Mandarin has not published shifts.json yet';
  if (pl?.data && isObj(pl.data)) { rt.hub.goals = cleanGoals(pl.data.goals); rt.hub.goalsAt = pl.modifiedTime || ''; rt.hub.goalsError = pl.data.goals ? '' : 'Citrus’s plan.json has no goals yet'; }
  else rt.hub.goalsError = 'Citrus has not published plan.json yet';
  rt.hub.at = Date.now();
  if (!S().migrated) {
    const citrus = await G.readOtherFile(root, 'citrus', 'state.json').catch(() => null);
    if (citrus?.data && !S().migrated) offerMigration(citrus.data, 'Citrus on Drive');
  }
  saveHubCache();
}
// Taking the Library over from Citrus: offered once, with an Undo and a copy kept on Drive before it runs
let migrationOffered = false;
function offerMigration(citrus, source) {
  const { counts } = MIG.libraryPart(citrus); if (!counts.titles) { if (source !== 'Citrus on Drive') toast(`Nothing from the Library in ${source}`); return; } if (migrationOffered) return;
  migrationOffered = true;
  setTimeout(() => {
    const { close } = sheet([h('h2', {}, 'Bring your Library over from Citrus?'),
      h('p', { class: 'small' }, `Found in ${source}: ${MIG.describe(counts)}.`),
      h('p', { class: 'small muted' }, 'Sudachi copies every title with its status, progress, reading log, quotes and dates, your yearly goals and what you dismissed, and owns them from now on. Ratings that came from IMDb, Goodreads, MyAnimeList or AniList become tiers by percentile; ratings you gave by hand stay yours. Nothing is deleted in Citrus. Anything you already changed here is kept: for each title the newest edit wins. A copy of your Sudachi data as it is now is kept on Drive first, and you can Undo.'),
      h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: () => { close(); runMigration(citrus, source); } }, 'Bring it over'), h('button', { class: 'btn ghost', onClick: () => { close(); store.update(s => ({ ...s, migrated: { from: 'skipped', at: Date.now(), counts: {} } })); toast('Skipped. You can do it later in Settings › Backup and data.'); } }, 'Not now'))]);
  }, 300);
}
function backupBefore(what) { if (G.isSignedIn()) G.backupBefore(S().settings.driveFolder, stripForRemote(S()), what).catch(e => console.warn('backup before', e.message)); }
function runMigration(citrus, source) {
  const before = S(), r = MIG.applyMigration(before, citrus);
  if (!r.changed) { toast('Nothing to bring over'); return; }
  backupBefore('migration');
  try { store.replaceState(r.state, { bump: true }); smokeRender(); }
  catch (e) { console.warn(e); store.replaceState(before, { bump: true, exact: S() }); toast(`That copy would break the app (${String(e.message).slice(0, 60)}). Nothing was changed.`, 'err'); return; }
  render(); cheer(null, true); toast(`Brought over: ${MIG.describe(r.counts)}`, 'ok', { action: { label: 'Undo', run: () => { store.replaceState(before, { bump: true, exact: S() }); render(); toast('Undone: back to before the migration'); } } });
}
async function migrateNow() {
  if (!G.isSignedIn()) { show('more'); return toast('Sign in with Google first, or restore a Citrus backup file here'); }
  try { const c = await G.readOtherFile(S().settings.driveFolder, 'citrus', 'state.json'); if (!c?.data) return toast('No Citrus data found on Drive'); migrationOffered = false; offerMigration(c.data, 'Citrus on Drive'); }
  catch (e) { toast(e.message, 'err'); }
}
// What Sudachi publishes: status.json for Citrus. At most every few seconds, only when it changed.
let pubTimer = null;
function publishSoon() { clearTimeout(pubTimer); if (!G.isSignedIn() || !rt.online) return; pubTimer = setTimeout(() => publish().catch(e => console.warn('publish', e.message)), 4000); }
async function publish() {
  if (!G.isSignedIn() || !rt.online) return;
  await G.writeOwnFile(S().settings.driveFolder, 'status.json', HUB.buildStatus(S(), new Date()), { omit: ['updatedAt'] });
  rt.publishedAt = Date.now();
}
// Covers by themselves: titles without a picture get one from the catalogues, a few at a time in the background (only the
// image's address is saved; the picture loads from the site and the browser caches it).
let coverTimer = null, coverBusy = false, coverDone = 0;
function coversSoon(ms = 5000) { if (coverBusy || !rt.online || !CZ.custom(S()).look.covers) return; clearTimeout(coverTimer); coverTimer = setTimeout(fillCovers, ms); }
async function fillCovers() {
  if (coverBusy || !navigator.onLine || document.visibilityState !== 'visible' || coverDone >= 150) return;
  const todo = CV.needing(S()).slice(0, 6); if (!todo.length) return;
  coverBusy = true; const found = {};
  try { for (const m of todo) { found[m.id] = await CV.findCover(m).catch(() => ''); await new Promise(r => setTimeout(r, 1100)); } }   // MusicBrainz asks for about one request a second
  finally { coverBusy = false; }
  coverDone += todo.length; const t = keyOf(new Date());
  store.update(s => { const media = { ...s.media }; for (const [id, url] of Object.entries(found)) if (media[id] && !media[id].cover) media[id] = { ...media[id], ...(url ? { cover: url } : {}), coverTried: t, at: Date.now() }; return { ...s, media }; }, { silent: document.querySelector('.sheet-bg, .story, .search') ? true : false });
  coversSoon(1500);
}
ctx.findCovers = () => { coverDone = 0; coversSoon(100); };
/** Steam syncs on its own at most every 6 hours (only with the relay and a Steam profile set). */
function steamDue() { const st = S().meta?.steam; return !!(S().meta?.relay && st?.id && st.last && Date.now() - (st.at || 0) > 6 * 3600000); }

// ---------------- search: every title, by its original or English name, creator or genre
function openSearch() {
  if (document.querySelector('.search')) return;
  let sel = 0, hits = [];
  const list = h('div', { class: 'res' });
  const paint = (q) => {
    const s = S(), all = Object.values(s.media || {});
    hits = (q.trim() ? M.filterShelf(all, { q, sort: 'recent' }) : M.nowPlaying(s)).slice(0, 30).map(m => ({ m, name: M.shown(m), sub: [M.kindOf(m.kind).emoji + ' ' + M.statusWord(m.kind, m.status), T.tierText(m.score), m.year || '', m.creator].filter(Boolean).join(' · '), open: () => IT.openItem(m.id) }));
    if (q.trim() && !hits.length) hits.push({ name: `＋ Add “${q.trim()}”`, sub: 'not in your library yet', open: () => IT.addSheet({ title: q.trim() }) });
    sel = 0;
    list.replaceChildren(...(hits.length ? hits.map((x, i) => h('button', { class: `item ${i === sel ? 'hl' : ''}`, onClick: () => { box.remove(); x.open(); } }, x.m ? coverEl(x.m, 'xs') : null, h('div', { class: 'grow' }, h('div', { class: 'name' }, x.name), h('div', { class: 'meta' }, String(x.sub).slice(0, 110))))) : [h('div', { class: 'empty small' }, 'Type to search your library')]));
  };
  const inp = h('input', { type: 'search', placeholder: 'Search titles, creators, genres', 'aria-label': 'Search', onInput: (e) => paint(e.target.value), onKeydown: (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { sel = Math.max(0, Math.min(hits.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); [...list.querySelectorAll('.item')].forEach((c, i) => c.classList.toggle('hl', i === sel)); list.querySelectorAll('.item')[sel]?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    else if (e.key === 'Enter' && hits[sel]) { box.remove(); hits[sel].open(); }
  } });
  const box = h('div', { class: 'search', onClick: (e) => { if (e.target === box) box.remove(); } }, h('div', { class: 'box', role: 'dialog', 'aria-label': 'Search' }, inp, list));
  document.body.append(box); paint(''); setTimeout(() => inp.focus(), 30);
}
// ---------------- sheets ----------------
const topSheet = () => [...document.querySelectorAll('.sheet-bg, body > .search')].pop() || null;
const sheetOpeners = new WeakMap();
function sheet(content) {
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const bg = h('div', { class: 'sheet-bg', onClick: (e) => { if (e.target === bg) closeTopSheet(); } });
  const x = h('button', { class: 'sheet-x', type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onClick: () => { if (topSheet() === bg) closeTopSheet(); else close(); } }, '✕');
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, h('div', { class: 'handle' }), x, ...[content].flat());
  const title = box.querySelector('h2'); if (title) { title.id ||= 'sh-' + uid(); box.setAttribute('aria-labelledby', title.id); } else box.setAttribute('aria-label', 'Details');
  // remember typed edits, so Escape asks before throwing them away (the note editor saves itself, so it opts out)
  box.addEventListener('input', (e) => { if (e.target.matches?.('textarea:not([data-nodirty]), input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=search]):not([type=file]):not([data-nodirty])')) bg.dataset.dirty = '1'; });
  bg.append(box); document.body.append(bg); sheetOpeners.set(bg, opener);
  const close = () => bg.remove();
  queueMicrotask(() => { if (!bg.isConnected || box.contains(document.activeElement)) return; const f = box.querySelector('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=date]):not([data-nofocus]), textarea:not([data-nofocus])'); (f && !matchMedia('(hover: none)').matches ? f : box).focus({ preventScroll: true }); });
  return { close, box };
}
/** Escape: close the top sheet; with unsaved typing, the first Escape only warns. */
function closeTopSheet() {
  const bg = topSheet(); if (!bg) return false;
  if (bg.dataset.dirty && !bg.dataset.warned) { bg.dataset.warned = '1'; toast('Unsaved writing: press Esc (or ✕) again to discard'); setTimeout(() => { delete bg.dataset.warned; }, 4000); return true; }
  bg.remove(); return true;
}
function shortcutsSheet() {
  const rows = [['1 – 4', 'Today, Library, Backlog, Review (in your tab order)'], [',', 'Settings'], ['/', 'Search your library'], ['l', 'Log something'], ['a', 'Add a title'], ['d', 'Brain dump'], ['i', 'Import'], ['r', 'Sync with Google now'], ['← →', 'move through a story'], ['Esc', 'close the top sheet, the story or the search'], ['?', 'this list']];
  sheet([h('h2', {}, 'Keyboard shortcuts'), h('div', { class: 'kv keys' }, rows.flatMap(([k, v]) => [h('kbd', {}, k), h('span', {}, v)]))]);
}
// Back button closes the top sheet: one history entry guards all open sheets.
let sheetGuard = false, sheetSelfBack = false, lastSheetClose = 0;
// the second tap of a double-tap on Save lands on whatever was under the sheet (the bottom tabs): swallow it
document.addEventListener('click', (e) => { if (Date.now() - lastSheetClose < 280 && !e.target.closest?.('.sheet, .toast')) { e.preventDefault(); e.stopPropagation(); } }, true);
function watchSheets() {
  new MutationObserver((muts) => {
    const removed = muts.flatMap(m => [...m.removedNodes]).filter(n => n.classList?.contains('sheet-bg') || n.classList?.contains('search')), open = document.querySelectorAll('.sheet-bg, body > .search').length;
    if (removed.length) lastSheetClose = Date.now();
    document.documentElement.classList.toggle('sheet-open', open > 0);
    for (const bg of removed) { const o = sheetOpeners.get(bg); if (o?.isConnected && !topSheet()) o.focus({ preventScroll: true }); }
    if (open && !sheetGuard) { history.pushState({ cSheet: 1 }, '', location.href); sheetGuard = true; }
    else if (!open && sheetGuard && !sheetSelfBack && history.state?.cSheet) { sheetSelfBack = true; history.back(); }
  }).observe(document.body, { childList: true });
  addEventListener('popstate', () => {
    if (sheetSelfBack) { sheetSelfBack = false; sheetGuard = false; if (topSheet()) { history.pushState({ cSheet: 1 }, '', location.href); sheetGuard = true; } return; }
    sheetGuard = false; const bg = topSheet(); if (bg) { bg.remove(); if (topSheet()) { history.pushState({ cSheet: 1 }, '', location.href); sheetGuard = true; } }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return; const bg = topSheet(); if (!bg) return;
    const f = [...bg.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null || x === document.activeElement);
    if (!f.length) { e.preventDefault(); return; }
    const i = f.indexOf(document.activeElement);
    if (!bg.contains(document.activeElement) || (e.shiftKey && i <= 0) || (!e.shiftKey && i === f.length - 1)) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); }
  });
}
// ---------------- backups, restore, Drive check ----------------
async function backupsSheet() {
  let list = [];
  try { list = await G.listBackups(S().settings.driveFolder); } catch (e) { return toast(e.message, 'err'); }
  const { close } = sheet([h('h2', {}, 'Restore a daily backup'),
    h('p', { class: 'small muted' }, 'Sudachi keeps one snapshot of your library per day on Drive (hub/sudachi/backups, newest 14). Restoring replaces this copy and syncs it to your other devices.'),
    list.length ? h('div', { class: 'list' }, ...list.map(b => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, b.name.replace(/^state-|\.json$/g, '')), h('div', { class: 'meta' }, `${Math.max(1, Math.round(b.size / 1024))} KB`)),
      h('button', { class: 'btn sm', onClick: async () => { try { const j = await G.readBackup(b.id); close(); restoreSheet(j, { source: `Drive backup ${b.name}` }); } catch (e) { toast(e.message, 'err'); } } }, 'Restore')))) : h('div', { class: 'muted small' }, 'No backups yet — the first is made after today\'s sync.')]);
}
const PRE_KEY = 'sudachi.preRestore';
function preRestore() { if (rt.preRestore) return rt.preRestore; try { return JSON.parse(localStorage.getItem(PRE_KEY) || 'null'); } catch { return null; } }
function keepPreRestore() { const snap = { at: Date.now(), state: S() }; rt.preRestore = snap; try { localStorage.setItem(PRE_KEY, JSON.stringify(snap)); return true; } catch { return false; } }
function dropPreRestore() { rt.preRestore = null; try { localStorage.removeItem(PRE_KEY); } catch {} }
/** Draw every main screen off-page; a state that throws anywhere is rolled back before anyone sees an empty app. */
function smokeRender() { for (const fn of [TU.renderToday, LU.renderLibrary, BU.renderBacklog, VU.renderReview]) fn(); HUB.buildStatus(S(), new Date()); }
const when = (t) => t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'unknown date';
function restoreSheet(json, { source = 'Backup file' } = {}) {
  const chk = checkBackup(json); if (!chk.ok) { toast(`${source}: ${chk.error}`, 'err'); return; }
  const sm = chk.summary, cur = checkBackup({ ...S(), app: 'sudachi' }).summary, older = sm.savedAt && (S().updatedAt || 0) > sm.savedAt;
  const kv = (rows) => h('div', { class: 'kv' }, ...rows.flatMap(([a, b]) => [h('b', {}, a), h('span', {}, b)]));
  const { close } = sheet([h('h2', {}, 'Restore this backup?'), h('div', { class: 'small muted', style: { marginBottom: '10px' } }, source),
    h('div', { class: 'rs-cols' }, h('div', { class: 'card rs-in' }, h('div', { class: 'title' }, 'In the backup'), kv([['Saved', when(sm.savedAt)], ['Holds', describeCounts(sm.counts)]])), h('div', { class: 'card' }, h('div', { class: 'title' }, 'On this device now'), kv([['Saved', when(S().updatedAt)], ['Holds', describeCounts(cur?.counts)]]))),
    older ? h('div', { class: 'small late', style: { margin: '8px 0' } }, 'This backup is older than the data on this device.') : null,
    chk.dropped.length ? h('div', { class: 'card warn' }, h('div', { class: 'title' }, `Left out: ${chk.dropped.length} part${chk.dropped.length > 1 ? 's' : ''}`), h('div', { class: 'tiny' }, chk.dropped.slice(0, 8).join(' · '))) : null,
    h('p', { class: 'small muted' }, 'Replace puts the backup in place of everything here, then on your other devices. Merge keeps both: for each item the newest edit wins. Either way Sudachi keeps a copy of your data as it is now, so you can undo.'),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn danger grow', onClick: () => { close(); applyRestore(chk.state, { merge: false }); } }, 'Replace everything'), h('button', { class: 'btn primary grow', onClick: () => { close(); applyRestore(chk.state, { merge: true }); } }, 'Merge into mine'), h('button', { class: 'btn ghost', onClick: () => close() }, 'Cancel'))]);
}
function applyRestore(next, { merge = false } = {}) {
  const before = S(), kept = keepPreRestore();
  backupBefore(merge ? 'merge' : 'restore');
  const target = merge ? { ...mergeStates(before, next), updatedAt: Math.max(before.updatedAt || 0, next.updatedAt || 0) } : { ...next, outbox: before.outbox, google: before.google };
  try { store.replaceState(target); smokeRender(); }
  catch (e) { console.warn('restore rolled back', e); store.replaceState(before); dropPreRestore(); render(); toast(`That backup would break the app (${String(e.message).slice(0, 60)}). Nothing was changed.`, 'err'); return false; }
  store.replaceState(S(), { bump: true, exact: merge ? null : before });
  render();
  toast(`${merge ? 'Merged' : 'Restored'}${kept ? '' : ' (undo copy kept until you close the app)'}`, 'ok', { action: { label: 'Undo', run: undoRestore } });
  return true;
}
function undoRestore() { const snap = preRestore(); if (!snap?.state) { toast('Nothing to undo'); return; } store.replaceState(snap.state, { bump: true, exact: S() }); dropPreRestore(); render(); toast(`Back to your data from ${when(snap.at)}`, 'ok'); }
async function repairSheet() {
  const body = h('div', {}, h('div', { class: 'muted small' }, 'Looking through Drive › ' + S().settings.driveFolder + '…'));
  const { close } = sheet([h('h2', {}, 'Check Drive'), body]);
  let rep; try { rep = await G.scanDrive(S().settings.driveFolder); } catch (e) { body.replaceChildren(h('div', { class: 'small' }, e.message)); return; }
  const issues = [...rep.twinFolders, ...rep.twinFiles].filter(t => t.fixable).length;
  body.replaceChildren(...[
    h('div', { class: 'small' }, `${rep.folders} folders · ${rep.files} files · ${issues ? `${issues} duplicate${issues > 1 ? 's' : ''}` : 'no duplicates'}`),
    ...rep.twinFolders.map(t => h('div', { class: 'small', style: { marginTop: '6px' } }, t.fixable ? `▸ ${t.path} ×${t.items.length} — contents will be merged into the oldest` : `▸ ${t.path} ×${t.items.length} — belongs to its own app; open that app to tidy it`)),
    ...rep.twinFiles.filter(t => t.fixable).map(t => h('div', { class: 'small', style: { marginTop: '6px' } }, `· ${t.path} ×${t.items.length} — newest kept, others to the trash`)),
    h('pre', { class: 'tiny', style: { background: 'var(--bg2)', padding: '10px', borderRadius: '10px', overflow: 'auto', marginTop: '10px', maxHeight: '40vh' } }, rep.tree.join('\n') || '(empty)'),
    issues ? h('button', { class: 'btn primary', style: { marginTop: '10px' }, onClick: async (e) => { e.target.disabled = true; e.target.textContent = 'Fixing…'; try { const r = await G.repairDrive(rep); saveWatch(null); close(); toast(`Fixed: ${r.moved} moved, ${r.trashed} to the trash (restorable for 30 days)`, 'ok'); refreshAll(false, { full: true }); } catch (err) { toast(err.message, 'err'); e.target.disabled = false; e.target.textContent = 'Fix duplicates'; } } }, 'Fix duplicates') : null].filter(Boolean));
}

// ---------------- SETTINGS ----------------
const czOpen = new Set(['Today']);
function customiseCard() {
  const c = CZ.custom(S()), set = (part, patch) => store.update(s => CZ.setCustom(s, part, patch));
  const sec = (title, sub, ...kids) => h('details', { class: 'cz-sec', open: czOpen.has(title), onToggle: (e) => { e.currentTarget.open ? czOpen.add(title) : czOpen.delete(title); } }, h('summary', {}, h('b', {}, title), h('small', {}, sub)), ...kids);
  const chip = (on, label, onClick, extra = {}) => h('button', { class: `chip ${on ? 'sel' : ''}`, 'aria-pressed': on ? 'true' : 'false', onClick, ...extra }, label);
  const orderRow = (list, id, label, i, onMove, hidden, onToggle, fixed = false) => h('div', { class: 'cz-row' }, h('span', { class: 'grow' }, label), h('button', { class: 'btn sm ghost', 'aria-label': `Move ${label} up`, disabled: i === 0, onClick: () => onMove(-1) }, '↑'), h('button', { class: 'btn sm ghost', 'aria-label': `Move ${label} down`, disabled: i === list.length - 1, onClick: () => onMove(1) }, '↓'),
    fixed ? h('span', { class: 'tiny dim cz-fixed' }, 'always') : chip(!hidden, hidden ? 'Hidden' : 'Shown', onToggle));
  const rows = c.today.rows;
  return h('div', { class: 'card cz' }, h('div', { class: 'title' }, 'Customise'), h('div', { class: 'tiny dim' }, 'Synced to all your devices.'),
    sec('Today', 'which rows, in what order', ...rows.order.map((id, i) => orderRow(rows.order, id, CZ.ROWS.find(x => x[0] === id)[1], i, (d) => set('today', { rows: { ...rows, order: CZ.move(rows.order, id, d) } }), rows.hidden.includes(id), () => set('today', { rows: { ...rows, hidden: CZ.toggleIn(rows.hidden, id) } })))),
    sec('Kinds', 'hide what you never log', h('div', { class: 'chips' }, ...M.KINDS.map(k => chip(!c.kinds.hidden.includes(k.id), `${k.emoji} ${k.name}`, () => { const nx = CZ.toggleIn(c.kinds.hidden, k.id); if (nx.length >= M.KINDS.length) return toast('Keep at least one kind'); set('kinds', { hidden: nx }); }))), h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, 'Hidden kinds stay in your data; they just leave the screens and the picks.')),
    sec('Look', 'accent, stickers, motion, covers',
      h('div', { class: 'tiny dim' }, 'Accent colour'), h('div', { class: 'cz-accents', role: 'radiogroup', 'aria-label': 'Accent colour' }, CZ.ACCENTS.map(([id, l, hex]) => h('button', { class: `cz-acc ${c.look.accent === id ? 'sel' : ''}`, role: 'radio', 'aria-checked': String(c.look.accent === id), style: { '--c': hex }, onClick: () => set('look', { accent: id }) }, h('i'), l))),
      h('div', { class: 'cz-row' }, h('span', { class: 'grow small' }, 'Stickers (tilted covers, tape, halftone)'), chip(c.look.stickers, c.look.stickers ? 'On' : 'Off', () => set('look', { stickers: !c.look.stickers }))),
      h('div', { class: 'cz-row' }, h('span', { class: 'grow small' }, 'Motion (glow, confetti when you finish)'), chip(c.look.motion, c.look.motion ? 'On' : 'Off', () => set('look', { motion: !c.look.motion }))),
      h('div', { class: 'cz-row' }, h('span', { class: 'grow small' }, 'Real covers (off: generated stickers only)'), chip(c.look.covers, c.look.covers ? 'On' : 'Off', () => set('look', { covers: !c.look.covers })))),
    sec('Tabs', 'order, hide, start tab', ...c.tabs.order.map((id, i) => orderRow(c.tabs.order, id, CZ.TABS.find(t => t[0] === id)[1], i, (d) => set('tabs', { order: CZ.move(c.tabs.order, id, d) }), c.tabs.hidden.includes(id), () => set('tabs', { hidden: CZ.toggleIn(c.tabs.hidden, id) }), id === 'today')),
      h('div', { class: 'cz-row' }, h('span', { class: 'grow small' }, 'Open on'), h('select', { 'aria-label': 'Open on', onChange: (e) => set('start', e.target.value) }, CZ.TABS.filter(([id]) => !c.tabs.hidden.includes(id)).map(([id, l]) => h('option', { value: id, selected: c.start === id }, l))))),
    h('button', { class: 'btn sm ghost', style: { marginTop: '8px' }, onClick: () => { const before = S(); store.update(s => ({ ...s, settings: { ...s.settings, custom: {} } })); toast('Customise back to the defaults', '', { action: { label: 'Undo', run: () => undoTo(before) } }); } }, 'Reset Customise'));
}
function uiPicker() {
  const u = getUi(), opt = (id, name, note) => h('button', { class: `ui-opt ${u.ui === id ? 'sel' : ''}`, 'aria-pressed': u.ui === id ? 'true' : 'false', onClick: () => setUi({ ui: id }) }, h('span', { class: `ui-thumb ui-${id}` }, h('i'), h('i'), h('b', {}, 'Aa')), h('b', {}, name), h('small', {}, note));
  return h('div', { class: 'ui-pick' }, h('div', { class: 'title' }, 'Interface on this device'), h('div', { class: 'ui-opts' }, opt('sudachi', 'Sudachi', 'Cyber Pop × Pop-punk, after dark'), opt('zine', 'Zine', 'the same on cream paper'), opt('arcade', 'Arcade', '8-bit, the family look'), opt('clean', 'Clean', 'calm and plain'), opt('paper', 'Paper', 'bright, for daylight')),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'small grow' }, 'Text size'), h('div', { class: 'seg ui-size' }, [['small', 'S'], ['normal', 'M'], ['large', 'L']].map(([k, l]) => h('button', { class: u.size === k ? 'active' : '', 'aria-label': `Text size ${k}`, 'aria-pressed': String(u.size === k), onClick: () => setUi({ size: k }) }, l)))));
}
/** Steam & MyAnimeList: the relay (an Apps Script web app on your own Google account). */
function relayCard() {
  const s = S(), url = h('input', { type: 'url', value: s.meta?.relay || '', placeholder: 'https://script.google.com/macros/s/…/exec', 'aria-label': 'Relay address', spellcheck: false });
  const sid = h('input', { type: 'text', value: s.meta?.steam?.id || '', placeholder: 'SteamID64 or custom profile name', 'aria-label': 'Steam profile' });
  const mal = h('input', { type: 'text', value: s.meta?.mal?.user || '', placeholder: 'MyAnimeList username', 'aria-label': 'MyAnimeList username' });
  const st = s.meta?.steam;
  const save = async (test) => { const u = url.value.trim(); if (u && !RL.validRelay(u)) return toast('That is not an Apps Script web app address (it ends in /exec)', 'err');
    store.update(x => M.setMeta(x, { relay: u, steam: { ...(x.meta?.steam || {}), id: sid.value.trim() }, mal: { ...(x.meta?.mal || {}), user: mal.value.trim() } }));
    if (test && u) { try { const j = await RL.ping(u); toast(j?.app === 'sudachi-relay' ? `Relay works (v${j.v})${j.v < RL.RELAY_VERSION ? ': paste the new script' : ''}` : 'Something answered, but not the Sudachi relay', j?.app ? 'ok' : 'err'); } catch (e) { toast(e.message, 'err'); } } else toast('Saved', 'ok'); };
  return h('div', { class: 'card relay' }, h('div', { class: 'title' }, 'Steam & MyAnimeList'),
    h('div', { class: 'small muted' }, 'Steam and MyAnimeList don’t let web pages read them, so Sudachi uses a tiny relay you own: a free Google Apps Script on your Google account. Your Steam key stays inside it.'),
    h('details', { class: 'adv', open: !s.meta?.relay }, h('summary', { class: 'small' }, 'Set it up (about five minutes)'),
      h('ol', { class: 'small steps' },
        h('li', {}, 'Get a Steam Web API key at ', h('a', { href: 'https://steamcommunity.com/dev/apikey', target: '_blank', rel: 'noopener' }, 'steamcommunity.com/dev/apikey'), ' (domain: anything, e.g. sudachi). Skip if you only want MyAnimeList.'),
        h('li', {}, 'Open ', h('a', { href: 'https://script.google.com/home/projects/create', target: '_blank', rel: 'noopener' }, 'script.google.com › New project'), ', delete what is there and paste the relay script (button below).'),
        h('li', {}, 'Project settings (⚙) › Script properties › Add: STEAM_KEY = your key.'),
        h('li', {}, 'Deploy › New deployment › Web app. Execute as: Me. Who has access: Anyone. Authorise it.'),
        h('li', {}, 'Copy the Web app URL (ends in /exec) into the box below and tap Test.'),
        h('li', {}, 'In Steam › Profile › Edit › Privacy: My profile and Game details → Public.')),
      h('button', { class: 'btn sm', onClick: async () => { try { await navigator.clipboard.writeText(RL.RELAY_SCRIPT); toast('Relay script copied', 'ok'); } catch { const ta = h('textarea', { rows: 8, readonly: true }, RL.RELAY_SCRIPT); sheet([h('h2', {}, 'The relay script'), h('div', { class: 'tiny dim' }, 'Select all and copy.'), ta]); } } }, '⧉ Copy the relay script')),
    h('div', { class: 'field' }, h('label', {}, 'Relay address'), url),
    h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', {}, 'Steam profile'), sid), h('div', { class: 'field' }, h('label', {}, 'MyAnimeList username'), mal)),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn sm primary', onClick: () => save(true) }, 'Save & test'),
      s.meta?.relay && s.meta?.steam?.id ? h('button', { class: 'btn sm', onClick: async (e) => { e.target.disabled = true; try { await IU.steamSync(sid.value.trim()); } catch (err) { toast(err.message, 'err'); } e.target.disabled = false; } }, '🎮 Sync Steam now') : null,
      s.meta?.relay && s.meta?.mal?.user ? h('button', { class: 'btn sm', onClick: () => IU.importSheet('mal') }, '🍥 Import MyAnimeList') : null),
    st?.at ? h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, `Steam last synced ${new Date(st.at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · then every 6 hours while Sudachi syncs.`) : null);
}
function goalsCard() {
  const s = S(), g = s.meta?.goals || {}, aims = rt.hub.goals?.aims || [], links = s.meta?.goalAims || {}, y = new Date().getFullYear();
  const row = (kind, label) => h('div', { class: 'cz-row' }, h('span', { class: 'grow small' }, label),
    h('input', { type: 'number', min: '0', max: '5000', class: 'num', value: g[kind] || '', placeholder: '–', 'aria-label': `${label}: goal for ${y}`, onChange: (e) => store.update(x => M.setGoal(x, kind, +e.target.value)) }),
    aims.length ? h('select', { class: 'filter', 'aria-label': `${label}: Citrus aim`, onChange: (e) => store.update(x => M.setGoal(x, kind, g[kind] || 0, e.target.value)) }, h('option', { value: '' }, 'no aim'), ...aims.map(a => h('option', { value: a.id, selected: links[kind] === a.id }, a.title.slice(0, 40)))) : null);
  return h('div', { class: 'card' }, h('div', { class: 'title' }, `Goals for ${y}`), h('div', { class: 'tiny dim' }, 'How many to finish this year. A goal can link to an aim in Citrus Plan (Citrus shows the progress there).'),
    row('all', '✦ Anything'), ...M.KINDS.map(k => row(k.id, `${k.emoji} ${k.name}`)));
}
function diagnosticsCard() {
  const s = S(), n = (f) => Object.values(s.media || {}).filter(f).length, conv = T.convertAll(s).sites;
  const rows = [
    ['Google', G.isSignedIn() ? `signed in as ${G.accountEmail() || s.google.email || '?'}` : G.wasSignedIn() ? 'session expired — tap Sign in' : 'not signed in'],
    ['Session', G.isSignedIn() ? `${G.tokenMinutesLeft()} min left · renews on your next tap` : '—'],
    ['Last sync', s.google.lastSync ? `${new Date(s.google.lastSync).toLocaleString('en-GB')}${rt.syncMode ? ` · ${rt.syncMode}` : ''}${rt.lastSyncMs ? ` · ${(rt.lastSyncMs / 1000).toFixed(1)} s` : ''}` : 'never'],
    ['Drive requests', `${G.stats.requests} sent · ${G.stats.retries} retried · ${G.stats.errors} failed · ${G.stats.skippedWrites} unchanged writes skipped`],
    ['Last Google error', G.stats.lastError ? `${G.stats.lastError} (${new Date(G.stats.lastErrorAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})` : 'none'],
    ['Unsaved to Drive', rt.saveDirty ? 'yes — saves on the next sync' : 'no'],
    ['This device', `${store.persistence.ok ? 'saved' : '⚠ ' + store.persistence.lastError} · ${Math.round(store.persistence.bytes / 1024)} KB${rt.storagePersisted ? ' · protected from clean-up' : ''}`],
    ['Sync issues', (rt.lastProblems || []).length ? rt.lastProblems.join(' · ') : 'none'],
    ['Shifts from Mandarin', R.has() ? `you: ${R.meName() || 'not picked in Mandarin'} · to ${R.coverEnd() ? fmtDate(R.coverEnd()) : '?'} · published ${R.updatedAt() ? new Date(R.updatedAt()).toLocaleString('en-GB') : '?'}` : (rt.hub.shiftsError || 'not read yet')],
    ['Aims from Citrus Plan', rt.hub.goals ? `${rt.hub.goals.aims.length} aims${rt.hub.goalsError ? ` · ${rt.hub.goalsError}` : ''}` : (rt.hub.goalsError || 'not read yet')],
    ['Published to the hub', rt.publishedAt ? `status.json at ${new Date(rt.publishedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'not yet this session'],
    ['Your library', `${n(() => true)} titles · ${n(m => m.status === 'done')} finished · ${n(m => m.status === 'doing')} on the shelf · ${n(m => m.status === 'planned')} in the backlog`],
    ['Tiers', `${n(m => m.score > 0 && !m.auto)} yours · ${n(m => m.auto)} converted (${Object.entries(conv).map(([k, v]) => `${M.SRC_NAME[k] || k} ${v.n}`).join(', ') || 'none'})`],
    ['Relay', s.meta?.relay ? `set · Steam ${s.meta?.steam?.id ? 'yes' : 'no'} · MAL ${s.meta?.mal?.user ? 'yes' : 'no'}` : 'not set up'],
    ['Taken over from Citrus', s.migrated ? (s.migrated.from === 'skipped' ? 'skipped' : `${new Date(s.migrated.at).toLocaleDateString('en-GB')} · ${MIG.describe(s.migrated.counts || {})}`) : 'not yet'],
    ['Version', VERSION], ['Online', rt.online ? 'yes' : 'no'], ['Installed', window.matchMedia('(display-mode: standalone)').matches ? 'yes (home screen)' : 'browser tab'],
  ];
  return h('details', { class: 'card' }, h('summary', {}, h('b', {}, 'Diagnostics')), h('div', { class: 'kv' }, ...rows.flatMap(([a, b]) => [h('b', {}, a), h('span', {}, b)])),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onClick: () => refreshAll(true) }, 'Sync now'), h('button', { class: 'btn sm', onClick: async () => { const regs = await navigator.serviceWorker?.getRegistrations?.() || []; for (const r of regs) await r.unregister(); const ks = await caches.keys(); for (const k of ks) await caches.delete(k); location.reload(); } }, 'Reinstall app files')));
}
function renderMore() {
  const s = S(), signed = G.isSignedIn();
  const out = [h('h1', {}, 'Settings'), h('div', { class: 'card' }, uiPicker()), customiseCard(), relayCard(), goalsCard()];
  const cid = h('input', { type: 'text', value: s.settings.clientId, placeholder: '1234567890-xxxx.apps.googleusercontent.com', spellcheck: false, 'aria-label': 'OAuth client ID' });
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Google'),
    h('div', { class: 'small muted' }, 'Drive keeps Sudachi in step on all your devices and with your other apps (My Apps › hub › sudachi), brings your shifts from Mandarin for the picks, and your aims from Citrus Plan.'),
    h('div', { class: 'row wrap', style: { marginTop: '8px' } },
      signed ? h('button', { class: 'btn', onClick: () => { G.signOut(); saveWatch(null); render(); } }, 'Sign out') : h('button', { class: 'btn primary', onClick: async () => { try { if (cid.value.trim() !== s.settings.clientId) { store.update(x => ({ ...x, settings: { ...x.settings, clientId: cid.value.trim() } }), { remote: false }); } await G.init(cid.value.trim() || s.settings.clientId); await G.signIn({ renew: G.wasSignedIn() }).catch(() => G.signIn()); toast('Signed in', 'ok'); refreshAll(true, { full: true }); } catch (e) { toast(e.message, 'err'); } } }, G.wasSignedIn() ? 'Reconnect Google' : 'Sign in with Google'),
      signed ? h('button', { class: 'btn', onClick: () => refreshAll(true) }, '↻ Sync now') : null,
      signed ? h('button', { class: 'btn', onClick: backupsSheet }, '⟲ Daily backups') : null, signed ? h('button', { class: 'btn', onClick: repairSheet }, '🩺 Check Drive') : null),
    signed ? h('div', { class: 'small muted', style: { marginTop: '8px' } }, `${s.google.email || 'signed in'}${s.google.lastSync ? ` · last sync ${new Date(s.google.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`) : null,
    h('details', { class: 'adv' }, h('summary', { class: 'small' }, 'Advanced'), h('div', { class: 'field' }, h('label', {}, 'OAuth client ID (the one Google Cloud client all your apps share)'), cid, h('div', { class: 'tiny dim' }, 'Only the client ID, never the secret. This site must be in the client’s "Authorised JavaScript origins".')),
      h('button', { class: 'btn sm', onClick: async () => { store.update(x => ({ ...x, settings: { ...x.settings, clientId: cid.value.trim() } }), { remote: false }); try { await G.init(cid.value.trim()); toast('Saved', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Save ID'),
      h('div', { class: 'field', style: { marginTop: '10px' } }, h('label', {}, 'Drive folder'), h('input', { value: s.settings.driveFolder, 'aria-label': 'Drive folder', onChange: (e) => { const v = e.target.value.trim() || 'My Apps'; if (/[\/\\]/.test(v) || v.length > 60) { e.target.value = s.settings.driveFolder; return toast('One folder name only (no “/”)', 'err'); } if (v !== 'My Apps' && !confirm(`Your apps share one folder, “My Apps”. Use “${v}” for Sudachi anyway? Mandarin's shifts and Citrus will not be found there.`)) { e.target.value = s.settings.driveFolder; return; } store.update(x => ({ ...x, settings: { ...x.settings, driveFolder: v } })); } }), h('div', { class: 'tiny dim' }, 'Keep “My Apps”: every app reads the hub there. Sudachi keeps its files in My Apps/hub/sudachi/.')))));
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Your apps'),
    h('div', { class: 'small muted' }, 'Sudachi owns all your media: titles, statuses, tiers, progress, the backlog and your yearly goals. It writes hub/sudachi/status.json (what Citrus shows: this week’s counts, what you are on, one pick for today; titles only, never your notes). It reads Mandarin’s shifts and the aims in Citrus Plan, and never writes into another app’s files.'),
    R.has() ? null : h('div', { class: 'small', style: { marginTop: '6px' } }, rt.hub.shiftsError ? `Shifts: ${rt.hub.shiftsError}. The picks treat every day as unknown until then.` : 'Shifts: sign in to read them from Mandarin.'),
    h('div', { class: 'row wrap', style: { marginTop: '8px' } }, h('a', { class: 'btn sm', href: `${CITRUS_URL}?from=sudachi`, target: '_blank', rel: 'noopener' }, '🍊 Open Citrus'), h('a', { class: 'btn sm', href: `${MANDARIN_URL}?from=sudachi`, target: '_blank', rel: 'noopener' }, '🍊 Open Mandarin'), signed ? h('button', { class: 'btn sm', onClick: () => publish().then(() => toast('Published', 'ok')).catch(e => toast(e.message, 'err')) }, 'Publish now') : null)));
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Backup and data'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onClick: () => IU.importSheet() }, '⇣ Import lists'),
      CZ.custom(s).look.covers ? h('button', { class: 'btn', title: 'Look for covers for every title without one', onClick: () => { const n = CV.needing(S()).length; if (!n) return toast('Every title has a cover (or was tried this month)'); ctx.findCovers(); toast(`Looking for ${n} cover${n === 1 ? '' : 's'} in the background`, 'ok'); } }, '🖼 Find covers') : null,
      M.needsEnglish(s).length ? h('button', { class: 'btn', onClick: () => IU.englishOffer() }, `🌐 English titles (${M.needsEnglish(s).length})`) : null,
      h('button', { class: 'btn', onClick: downloadBackup }, '⬇ Backup'),
      (() => { const inp = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; let j; try { j = JSON.parse(await f.text()); } catch { return toast(`${f.name} is not a backup file (it isn’t JSON)`, 'err'); } if (MIG.looksLikeCitrus(j)) { migrationOffered = false; offerMigration(j, f.name); return; } restoreSheet(j, { source: f.name }); } }); return h('span', {}, inp, h('button', { class: 'btn', title: 'A Sudachi backup, or a Citrus backup to bring the Library over', onClick: () => inp.click() }, '⬆ Restore')); })(),
      preRestore() ? h('button', { class: 'btn', onClick: undoRestore }, '↶ Undo restore') : null,
      signed ? h('button', { class: 'btn', onClick: migrateNow }, '🍊 Bring the Library over from Citrus') : null,
      h('button', { class: 'btn danger', onClick: eraseSheet }, 'Erase this device…')),
    h('div', { class: 'tiny dim', style: { marginTop: '10px' } }, `Sudachi ${VERSION} · your library lives in this browser and your own Google Drive.`)));
  out.push(diagnosticsCard());
  return out;
}
function downloadBackup() { const blob = new Blob([store.exportJSON()], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: `sudachi-backup-${keyOf(new Date())}.json` }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
const ownKeys = () => { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('sudachi.')) out.push(k); } } catch {} return out; };
function eraseSheet() {
  const signed = G.isSignedIn() || G.wasSignedIn();
  const { close } = sheet([h('h2', {}, 'Erase Sudachi on this device?'),
    h('p', { class: 'small' }, `This removes Sudachi's data from this browser only: your library, settings and the interface choice (${ownKeys().length} saved items).`),
    h('p', { class: 'small muted' }, signed ? 'Your Google Drive copy is not touched. If you sign in again here, the next sync brings everything back from Drive.' : 'You are not using Google sync, so nothing else holds a copy: download a backup first if you may want it back.'),
    h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn', onClick: downloadBackup }, '⬇ Backup first'), h('button', { class: 'btn danger grow', onClick: () => { for (const k of ownKeys()) try { localStorage.removeItem(k); } catch {} close(); location.reload(); } }, 'Erase this device'), h('button', { class: 'btn ghost', onClick: () => close() }, 'Cancel'))]);
}

window.__sudachi = { refreshAll, publish, saveStateNow, pullState, store, G, R, rt, VERSION, HUB, M, T, IU };   // for the console and the tests
boot();
