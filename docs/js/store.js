// Single source of truth for Sudachi (the media library: books, comics & manga, games, anime, films, series). Persists to localStorage immediately and to Google Drive (My Apps/hub/sudachi/state.json) when signed in.
// Three promises: a malformed record never reaches the views (sanitize on load, restore and merge), a merge of two devices
// never drops an edit (every collection merges per record or per field, by edit time), and a damaged localStorage copy is
// kept and recovered instead of silently replaced.
import { uid } from './util.js';
import { createDevStore, createTabChannel } from './devstore.js';

const KEY = 'sudachi.state.v1';
const BAK = 'sudachi.state.v1.bak';        // this device's last copy that loaded cleanly (written once per app start)
const CORRUPT = 'sudachi.state.corrupt.';  // + ISO time: a copy that could not be read, kept for download
const TOMBSTONE_DAYS = 400;
const BIG = 'sudachi.state.inIdb';            // set when the library is too big for localStorage and lives in IndexedDB only
const LS_MAX = 1.2e6;                       // characters (≈2.4 MB as UTF-16): above this localStorage is not used for the library                 // a device can be offline this long and still not bring deleted things back

const DEFAULT_SETTINGS = { clientId: '753489712404-ra7ahu34gjl305b4ss1765idmqg7am5s.apps.googleusercontent.com', calendarIds: ['primary'], planCalendarId: 'primary', alarmPlan: 10, driveFolder: 'My Apps', theme: 'dark' };

function defaults() {
  return {
    version: 1,
    app: 'sudachi',
    updatedAt: 0,
    media: {},                // id -> {kind, title, orig, en, status, score 0-10 (½ steps), auto (score converted from srcRating), srcRating, flags {comfort, rewatch, recommend}, progress, total, unit, creator, genres[], year, cover, src, extId, malId, startedAt, finishedAt, minutes, runtime, length (h), log[{d, n, m}], plays[{d, score}], quotes[], review, createdAt, at}
    meta: {},                 // goals {book, film, game, anime, all}, dismissed[], steam {id, url, last {appid: minutes}}, mal {user}, triage[] — field by field, edit times in stamps 'meta:<k>'
    deleted: {},              // tombstones 'media:<id>' -> time, so deletions survive merges
    stamps: {},               // edit times of values that have no `at` of their own: 'set:<k>'
    migrated: null,           // {from: 'citrus', at, counts} once the Library was taken over from Citrus
    settings: { ...DEFAULT_SETTINGS },
    outbox: [],               // calendar writes waiting for the network (never synced between devices)
    google: { email: '', lastSync: 0 },
  };
}

// ════════════════════════════════════════ shapes
// Map collections whose values are records (objects): collection -> tombstone prefix. The merge and the sanitizer both read this table,
// so a collection added here is cleaned on load and merged record by record.
export const RECORD_MAPS = { media: 'media' };
// Fields the views use without checking (`.toLowerCase()`, `.filter()`): repaired to the right type rather than dropping the record.
const FIELDS = { media: { title: 's', kind: 's', status: 's', genres: 'a', log: 'a', plays: 'a', quotes: 'a', creator: 's', finishedAt: 's', startedAt: 's' } };
const CELL_MAPS = [];
const NUM_MAPS = ['deleted', 'stamps'];          // key -> number
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, d = '') => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d);

/** A clean copy of a state: every collection has the right container type, records that are not objects are dropped, and the
 *  few fields the views read without checking (names, lists, schedules) are repaired.
 *  Unknown top-level keys are kept as they are. `report.fixed` counts records dropped, `report.repaired` fields quietly put back in shape. Never throws. */
export function sanitize(input, report = { fixed: 0, notes: [] }) {
  const s = isObj(input) ? { ...input } : {};
  // `fixed`: records dropped (worth telling the user); `repaired`: fields put back in shape, quietly (old or odd but not lost)
  const fix = (what, dropped = true) => { if (dropped) report.fixed++; else report.repaired = (report.repaired || 0) + 1; if (report.notes.length < 20) report.notes.push(what); };
  const mapOf = (k, keep) => {
    if (s[k] === undefined) return;
    if (!isObj(s[k])) { fix(`${k}: not a collection`); delete s[k]; return; }
    const out = {}; let changed = false;
    for (const [id, v] of Object.entries(s[k])) { const r = keep(v, id); if (r === undefined) fix(`${k}.${id}`); else out[id] = r; if (r !== v) changed = true; }
    if (changed) s[k] = out;   // untouched collections keep their identity (cheap, and callers can compare by reference)
  };
  for (const k of Object.keys(RECORD_MAPS)) mapOf(k, (v, id) => {
    if (!isObj(v)) return undefined;
    if (typeof v.title !== 'string' && typeof v.title !== 'number') return undefined;   // nothing to show for a record without a title
    if (!String(v.title).trim()) return undefined;
    let r = v;
    for (const [f, t] of Object.entries(FIELDS[k] || {})) if (t === 's' ? typeof r[f] !== 'string' : !Array.isArray(r[f])) { if (r === v) { r = { ...v }; fix(`${k}.${id}.${f}`, false); } r[f] = t === 's' ? str(r[f]) : []; }
    if (!(+r.score >= 0 && +r.score <= 10)) { if (r === v) r = { ...v }; r.score = 0; fix(`${k}.${id}.score`, false); }
    if (r.flags !== undefined && !isObj(r.flags)) { if (r === v) r = { ...v }; r.flags = {}; fix(`${k}.${id}.flags`, false); }
    return r;
  });
  if (s.meta !== undefined && !isObj(s.meta)) { fix('meta'); delete s.meta; }
  for (const k of CELL_MAPS) mapOf(k, (cells, id) => { if (!isObj(cells)) return undefined; if (Object.values(cells).every(isObj)) return cells; const o = {}; for (const [d, c] of Object.entries(cells)) if (isObj(c)) o[d] = c; else fix(`${k}.${id}.${d}`); return o; });
  for (const k of NUM_MAPS) mapOf(k, (v) => (Number.isFinite(+v) && v !== null && v !== '' && typeof v !== 'object' ? +v : undefined));
  if (s.migrated !== undefined && s.migrated !== null && !isObj(s.migrated)) { fix('migrated', false); s.migrated = null; }
  if (s.settings !== undefined) {
    if (!isObj(s.settings)) { fix('settings'); delete s.settings; }
    else if (s.settings.calendarIds !== undefined && !(Array.isArray(s.settings.calendarIds) && s.settings.calendarIds.every(x => typeof x === 'string'))) {
      fix('settings.calendarIds', false); const ids = Array.isArray(s.settings.calendarIds) ? s.settings.calendarIds.filter(x => typeof x === 'string' && x) : [];
      s.settings = { ...s.settings, calendarIds: ids.length ? ids : ['primary'] };
    }
  }
  if (s.outbox !== undefined) { if (!Array.isArray(s.outbox)) { fix('outbox'); delete s.outbox; } else if (!s.outbox.every(isObj)) { fix('outbox[]'); s.outbox = s.outbox.filter(isObj); } }
  if (s.google !== undefined && !isObj(s.google)) { fix('google'); delete s.google; }
  if (s.updatedAt !== undefined && !Number.isFinite(s.updatedAt)) { s.updatedAt = Number.isFinite(+s.updatedAt) ? +s.updatedAt : 0; }
  return s;
}

// Fill in the defaults around a clean state (nested settings too).
function complete(s) {
  const d = defaults();
  const st = { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
  if (!st.settings.clientId) st.settings.clientId = d.settings.clientId;
  return st;
}

// ════════════════════════════════════════ this device
/** What happened at start-up when the saved copy could not be read: null when all was well.
 *  {at, reason, kept: localStorage key of the damaged copy (or ''), from: ['backup' | 'readable part'], fixed: records repaired} */
export let recovery = null;
let lsOk = true;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { lsOk = false; return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch {} };

let state;                                  // loaded at the end of this module, once every helper below exists
const listeners = new Set();

function parseState(raw) { try { const s = JSON.parse(raw); return isObj(s) ? s : null; } catch { return null; } }

function load() {
  const raw = lsGet(KEY);
  if (!raw) return complete({});
  const report = { fixed: 0, notes: [] };
  const parsed = parseState(raw);
  if (parsed) {
    const s = complete(sanitize(parsed, report));
    if (report.fixed) { recovery = { at: Date.now(), reason: 'repaired', kept: keepCorrupt(raw), from: [], fixed: report.fixed, notes: report.notes }; }
    else if (raw.length < 1.5e6) lsSet(BAK, raw);   // a known-good copy for the day this one gets damaged (skipped for huge states: quota)
    return s;
  }
  // unreadable: keep it, then rebuild from what can still be read — the last clean copy and the readable part of this one, merged
  const kept = keepCorrupt(raw);
  const bak = parseState(lsGet(BAK) || '');
  const part = salvageJSON(raw);
  const from = [];
  let s = null;
  if (bak) { s = sanitize(bak, report); from.push('backup'); }
  if (part) { const p = sanitize(part, report); s = s ? mergeStates(complete(s), complete(p)) : p; from.push('readable part'); }
  recovery = { at: Date.now(), reason: 'unreadable', kept, from, fixed: report.fixed, notes: report.notes };
  return complete(s || {});
}

// Keep the damaged text under its own key (the newest two), so the next save cannot overwrite what might be recovered.
function keepCorrupt(raw) {
  const key = CORRUPT + new Date().toISOString();
  let old = [];
  try { old = Object.keys(localStorage).filter(k => k.startsWith(CORRUPT)).sort(); } catch {}
  for (const k of old.slice(0, Math.max(0, old.length - 1))) lsDel(k);
  if (lsSet(key, raw)) return key;
  lsDel('sudachi.events'); lsDel(BAK);
  return lsSet(key, raw) ? key : '';
}
/** The damaged copy kept at start-up, for download (null when there is none). */
export function corruptCopy() { return recovery?.kept ? lsGet(recovery.kept) : null; }
export function dismissRecovery() { if (recovery?.kept) lsDel(recovery.kept); recovery = null; }

/** Best effort for JSON cut off mid-way (a full disk, a crash while writing): close it at the last complete value. */
export function salvageJSON(raw) {
  if (typeof raw !== 'string' || raw[0] !== '{') return null;
  const cuts = []; const stack = []; let inStr = false, esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { stack.pop(); if (stack.length) cuts.push([i + 1, stack.slice().reverse().join('')]); }
    else if (c === ',') cuts.push([i, stack.slice().reverse().join('')]);
  }
  for (let n = cuts.length - 1, tries = 0; n >= 0 && tries < 60; n--, tries++) {
    const [at, close] = cuts[n];
    const s = parseState(raw.slice(0, at) + close);
    if (s) return s;
  }
  return null;
}

// Save to this device. When the browser's storage is full, drop what can be fetched again (the calendar cache, the start-up copy) and retry.
export const persistence = { ok: true, lastError: '', bytes: 0, since: 0 };
const persistListeners = new Set();
export function onPersistence(fn) { persistListeners.add(fn); return () => persistListeners.delete(fn); }
// Two places on this device: IndexedDB (the durable copy, any size, two slots so a cut-off save never loses the last good one)
// and, while the library is small, localStorage too (read at once on start-up, and the fallback where IndexedDB is missing).
export const device = { idb: false, idbError: '', lastIdbSave: 0, slot: '', bytes: 0, tabs: 1 };
const dev = createDevStore('sudachi');
const tabs = createTabChannel('sudachi.state');
let idbTimer = null, idbRaw = null, idbWriting = null;
function idbQueue(raw) { if (!dev.ok) return; idbRaw = raw; clearTimeout(idbTimer); idbTimer = setTimeout(() => { flushDevice().catch(() => {}); }, 200); }
/** Write the waiting copy to IndexedDB now (on leaving the page, before a risky step). */
export async function flushDevice() {
  clearTimeout(idbTimer); if (idbWriting) await idbWriting.catch(() => {});
  if (idbRaw == null || !dev.ok) return;
  const raw = idbRaw; idbRaw = null;
  idbWriting = dev.write(raw, highestSeen(state)).then(slot => { device.idb = true; device.idbError = ''; device.lastIdbSave = Date.now(); device.slot = slot; device.bytes = raw.length * 2; tabs.post({ type: 'saved', hi: highestSeen(state) }); refreshOk(); })
    .catch(e => { device.idb = false; device.idbError = e?.message || 'IndexedDB save failed'; refreshOk(); })
    .finally(() => { idbWriting = null; });
  return idbWriting;
}
let lsSaved = true;
function refreshOk() {
  const was = persistence.ok, ok = lsSaved || device.idb;
  if (ok) { persistence.ok = true; persistence.lastError = ''; persistence.since = 0; } else { persistence.ok = false; persistence.since ||= Date.now(); }
  if (was !== persistence.ok) { for (const fn of persistListeners) try { fn(persistence); } catch {} alerts(); }
}
function persist() {
  const raw = JSON.stringify(state);
  const was = persistence.ok;
  persistence.bytes = raw.length * 2;
  let saved = false;
  const big = raw.length > LS_MAX && dev.ok && !device.idbError;
  if (big) { lsDel(KEY); lsDel(BAK); lsSet(BIG, String(Date.now())); saved = true; }   // too big for localStorage: IndexedDB carries it (refreshOk corrects this if its save fails)
  else for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    try { localStorage.setItem(KEY, raw); saved = true; lsDel(BIG); }
    catch (e) {
      persistence.lastError = e?.name === 'QuotaExceededError' || /quota/i.test(e?.message || '') ? 'This device\'s storage is full' : (e?.message || 'save failed');
      if (attempt === 0) lsDel('sudachi.events'); else if (attempt === 1) lsDel(BAK); else console.warn('persist failed', e);
    }
  }
  lsSaved = saved && !big;
  idbQueue(raw);
  if (!saved && device.idb) saved = true;   // IndexedDB holds it
  if (saved) { persistence.ok = true; persistence.lastError = ''; persistence.since = 0; }
  else { persistence.ok = false; persistence.since ||= Date.now(); }
  if (was !== persistence.ok) { for (const fn of persistListeners) try { fn(persistence); } catch {} alerts(); }
  return saved;
}

export function get() { return state; }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let syncHook = null;
export function onRemoteSync(fn) { syncHook = fn; }

// ════════════════════════════════════════ one clock for every edit time
/** The highest edit time or tombstone this device has seen (its own and every merged copy). */
const seenCache = new WeakMap();
export function highestSeen(s) {
  if (!isObj(s)) return 0; if (seenCache.has(s)) return seenCache.get(s);
  let hi = num(s.updatedAt, 0);
  for (const coll of Object.keys(RECORD_MAPS)) for (const v of Object.values(s[coll] || {})) if (isObj(v)) hi = Math.max(hi, num(v.at, 0), num(v.at2, 0));
  for (const k of CELL_MAPS) for (const cells of Object.values(s[k] || {})) if (isObj(cells)) for (const c of Object.values(cells)) if (isObj(c)) hi = Math.max(hi, num(c.at, 0));
  for (const t of Object.values(s.deleted || {})) hi = Math.max(hi, num(t, 0));
  for (const t of Object.values(s.stamps || {})) hi = Math.max(hi, num(t, 0));
  seenCache.set(s, hi); return hi;
}
/** A hybrid clock: real time, but never earlier than anything already seen, so a device whose clock is behind still writes
 *  the newest edit (beta T5-04: a phone 10 min behind lost its own later edit and its deletes came back). */
export function clock(s = state) { return Math.max(Date.now(), highestSeen(s) + 1); }
// Every record or tombstone that a change wrote gets an edit time past everything seen, whoever wrote the `at`.
function clockChanges(prev, next) {
  if (!prev || !next) return;
  const hi = highestSeen(prev); if (Date.now() > hi) return;   // the real clock is already ahead: nothing to fix
  const t = hi + 1;
  for (const coll of Object.keys(RECORD_MAPS)) {
    const a = prev[coll] || {}, b = next[coll]; if (!b || a === b) continue;
    let m = null;
    for (const [k, v] of Object.entries(b)) if (isObj(v) && v !== a[k] && num(v.at, 0) <= hi) (m ||= { ...b })[k] = { ...v, at: t, ...(v.at2 ? { at2: t } : {}) };
    if (m) next[coll] = m;
  }
  if (next.deleted && next.deleted !== prev.deleted) {
    let d = null; const pd = prev.deleted || {};
    for (const [k, v] of Object.entries(next.deleted)) if (v !== pd[k] && num(v, 0) <= hi) (d ||= { ...next.deleted })[k] = t;
    if (d) next.deleted = d;
  }
}
/** For a Replace or an Undo: the result must hold on every device, not only here. Whatever `prev` had that `next` lacks gets a
 *  tombstone, whatever differs gets a fresh edit time (beta T5-02/03: rolled-back items came back at the next sync). */
function exactChanges(prev, next, t) {
  const deleted = { ...(next.deleted || {}) };
  for (const [coll, pre] of Object.entries(RECORD_MAPS)) {
    const a = prev?.[coll] || {}, b = { ...(next[coll] || {}) };
    for (const k of Object.keys(a)) if (!(k in b)) deleted[`${pre}:${k}`] = t;
    for (const [k, v] of Object.entries(b)) {
      if (same(v, a[k])) continue;
      delete deleted[`${pre}:${k}`];
      if (isObj(v)) b[k] = { ...v, at: t, ...(v.at2 ? { at2: t } : {}) };
    }
    next[coll] = b;
  }
  // habit ticks: a cell that changed gets the fresh time, a cell that went away becomes an explicit "not done"
  for (const k of CELL_MAPS) {
    const a = prev?.[k] || {}, b = { ...(next[k] || {}) };
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const ca = a[id] || {}, cb = { ...(b[id] || {}) }; let ch = false;
      for (const d of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
        if (!(d in cb)) { cb[d] = { v: 0, at: t }; ch = true; }
        else if (!same(cb[d], ca[d])) { cb[d] = { ...cb[d], at: t }; ch = true; }
      }
      if (ch) b[id] = cb;
    }
    next[k] = b;
  }
  next.deleted = deleted;
}
/** After a recovery from a damaged copy, the next sync must merge with Drive whatever the edit times say (beta T5-01). */
let mergePending = false;
export function needsMerge() { return mergePending; }
export function merged() { mergePending = false; }

export function update(mutator, { silent = false, remote = true } = {}) {
  const prev = state;
  const next = typeof mutator === 'function' ? (mutator(state) || state) : { ...state, ...mutator };
  if (remote && next !== prev) clockChanges(prev, next);
  // edit time only moves forward: a device whose clock is behind another's must still make its copy newer, or the other
  // device would read "same updatedAt, nothing new" and skip the change (found with two devices, 16/11/2026)
  if (remote) { next.updatedAt = Math.max(Date.now(), (prev?.updatedAt || 0) + 1); stampChanges(prev, next, next.updatedAt); }   // local-only bookkeeping (sync time, app cache, outbox) must not make this copy look newer
  state = next;
  persist();
  if (!silent) for (const fn of listeners) fn(state);
  if (remote && syncHook) syncHook(state);
  return state;
}

let beforeReplace = null;
/** Replace the whole state (a merge from Drive, a restored backup). The incoming copy is sanitized first, so a malformed file
 *  cannot blank the app. `bump`: this is the user's own choice (a restore): it becomes the newest copy and is pushed to the others. */
export function replaceState(s, { bump = false, exact = null } = {}) {
  const prev = state;
  const next = complete(sanitize(s));
  if (exact) exactChanges(exact, next, clock(mergeAll(prev, exact)));
  if (bump) { beforeReplace = prev; next.updatedAt = Math.max(Date.now(), (prev?.updatedAt || 0) + 1, (next.updatedAt || 0) + 1); next.stamps = { ...(next.stamps || {}) }; stampChanges(prev, next, next.updatedAt); }
  state = next;
  if (bump && syncHook) syncHook(state);
  persist();
  for (const fn of listeners) fn(state);
}
/** Undo the last restore (the copy from just before it), or false when there is nothing to undo. */
export function undoReplace() { if (!beforeReplace) return false; const b = beforeReplace; beforeReplace = null; replaceState(b, { bump: true, exact: state }); beforeReplace = null; return true; }

export function exportJSON() { return JSON.stringify(state, null, 2); }

export function newId(prefix = '') { return prefix + uid(); }

/** Undo for one record: put back `prev` (or remove the record when it did not exist before), so that the result survives a
 *  merge on every device. A restored record gets a fresh edit time and loses its tombstone; a removed one gets a tombstone.
 *  (An Undo that only put the old record back was deleted again by the next sync: beta T4-01.) */
export function revert(s, coll, prefix, key, prev) {
  const m = { ...(s[coll] || {}) }, deleted = { ...(s.deleted || {}) }, now = clock(s);
  if (prev === undefined || prev === null) { delete m[key]; deleted[`${prefix}:${key}`] = now; }
  else { m[key] = { ...prev, at: now }; delete deleted[`${prefix}:${key}`]; }
  return { ...s, [coll]: m, deleted };
}

// Mark something deleted so a merge with an older copy does not bring it back
export function tombstone(s, key) { return { ...(s.deleted || {}), [key]: clock(s) }; }
const mergeAll = (a, b) => ({ updatedAt: Math.max(highestSeen(a), highestSeen(b)) });

// ════════════════════════════════════════ edit times for values without their own `at`
// Settings are plain values: their edit times are kept in `stamps`, written here
// for every change that goes through update(), so no caller has to remember it.
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
function stampChanges(prev, next, t) {
  if (!prev || !next) return;
  let stamps = null, deleted = null;
  const stamp = (k) => { (stamps ||= { ...(next.stamps || {}) })[k] = t; };
  const tomb = (k) => { (deleted ||= { ...(next.deleted || {}) })[k] = t; };
  for (const [field, pre] of [['settings', 'set'], ['meta', 'meta']]) {
    if (prev[field] === next[field]) continue;
    const a = prev[field] || {}, b = next[field] || {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[k], b[k])) stamp(`${pre}:${k}`);
  }
  if (stamps) next.stamps = stamps;
  if (deleted) next.deleted = deleted;
}

// ════════════════════════════════════════ merging two devices
/** Merge this device's state (local) with Drive's (remote). Every collection merges record by record, newest edit wins; values
 *  without an `at` of their own (settings) follow their edit time in `stamps`. Tombstones remove what
 *  either side deleted, unless it was edited again after the deletion. The outbox and sign-in never leave this device.
 *  Copies from before `stamps` existed have no edit times: then a set value beats an empty or default one, and the newer copy
 *  decides the rest — so a fresh device can never wipe settings from Drive. */
export function mergeStates(local, remote) {
  if (!isObj(remote)) return local; if (!isObj(local)) return remote;
  local = sanitize(local); remote = sanitize(remote);
  const lt = num(local.updatedAt, 0), rt = num(remote.updatedAt, 0);
  const [older, newer] = lt > rt ? [remote, local] : [local, remote];
  const out = { ...older, ...newer };   // unknown keys from either copy survive; known ones are merged below
  const deleted = { ...(older.deleted || {}) };
  for (const [k, t] of Object.entries(newer.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, t);
  const alive = (key, at) => !(deleted[key] && deleted[key] >= (at || 0));
  const stamps = { ...(older.stamps || {}) };
  for (const [k, t] of Object.entries(newer.stamps || {})) stamps[k] = Math.max(stamps[k] || 0, t);
  const so = older.stamps || {}, sn = newer.stamps || {};
  // a value with an edit time beats one without; with equal times, a set value beats an empty/default one, then the newer copy wins
  const pick = (key, a, b, isBlank) => {
    const ta = so[key] || 0, tb = sn[key] || 0;
    if (ta !== tb) return ta > tb ? a : b;
    if (b === undefined) return a;
    if (a !== undefined && isBlank(b) && !isBlank(a)) return a;
    return b;
  };

  const mergeMap = (prefix, a = {}, b = {}, atOf = (v) => v?.at || 0) => {
    const m = {};
    for (const src of [a, b]) for (const [k, v] of Object.entries(src)) { const cur = m[k]; if (cur === undefined || atOf(v, k) >= atOf(cur, k)) m[k] = v; }
    for (const k of Object.keys(m)) if (!alive(`${prefix}:${k}`, atOf(m[k], k))) delete m[k];
    return m;
  };
  for (const [coll, prefix] of Object.entries(RECORD_MAPS)) out[coll] = mergeMap(prefix, older[coll], newer[coll]);
  // habit ticks: cell by cell (one day of one habit), newest tap wins; a deleted habit takes its ticks with it
  for (const k of CELL_MAPS) {
    const a = older[k] || {}, b = newer[k] || {}, m = {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const cells = { ...(a[id] || {}) };
      for (const [d, c] of Object.entries(b[id] || {})) if (!cells[d] || num(c?.at, 0) >= num(cells[d]?.at, 0)) cells[d] = c;
      m[id] = cells;
    }
    out[k] = m;
  }
  // settings: field by field
  for (const [field, pre, dflt] of [['settings', 'set', DEFAULT_SETTINGS], ['meta', 'meta', {}]]) {
    const a = older[field] || {}, b = newer[field] || {}, o = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const v = pick(`${pre}:${k}`, a[k], b[k], (x) => x === undefined || same(x, dflt[k])); if (v !== undefined) o[k] = v; }
    out[field] = o;
  }
  out.settings.clientId = out.settings.clientId || newer.settings?.clientId || older.settings?.clientId || '';
  out.migrated = newer.migrated || older.migrated || null;
  // collections this version doesn't know yet (a newer build on another device): merge them record by record too, never drop one side
  for (const k of new Set([...Object.keys(older), ...Object.keys(newer)])) {
    if (k in KNOWN) continue;
    const a = older[k], b = newer[k];
    if (isObj(a) && isObj(b) && Object.values(a).every(isObj) && Object.values(b).every(isObj)) out[k] = mergeMap(k, a, b);
  }
  const horizon = Date.now() - TOMBSTONE_DAYS * 86400000;
  out.deleted = Object.fromEntries(Object.entries(deleted).filter(([, t]) => t > horizon));
  out.stamps = stamps;
  out.outbox = local.outbox || [];
  out.google = local.google || {};
  return out;
}
const KNOWN = Object.fromEntries(Object.keys(defaults()).map(k => [k, 1]));

// ════════════════════════════════════════ telling the user (only in a browser; the banner module loads on demand)
function alerts() {
  if (typeof document === 'undefined') return;
  if (!recovery && persistence.ok && !document.querySelector('.d10-alert')) return;
  import('./store-alerts.js').then(m => m.showStoreAlerts({ recovery: () => recovery, persistence, corruptCopy, dismissRecovery, exportJSON })).catch(() => {});
}
/** Start-up, after the quick localStorage read: take in IndexedDB's copy if it holds anything newer (another tab, or a library
 *  too big for localStorage), and listen for saves from other tabs. Awaited by app.js before the first screen. */
export async function init() {
  if (!dev.ok) return false;
  try {
    const best = await bestDeviceCopy();
    device.idb = true;
    if (best && highestSeen(best) > highestSeen(state)) {
      state = complete(sanitize(lsGet(KEY) ? mergeStates(state, best) : best));
      persist(); for (const fn of listeners) fn(state);
    } else if (!best || highestSeen(state) > highestSeen(best)) { idbQueue(JSON.stringify(state)); await flushDevice(); }
  } catch (e) { device.idb = false; device.idbError = e?.message || 'IndexedDB unavailable'; }
  tabs.on(async (msg) => {
    if (msg?.type !== 'saved' || !(msg.hi > highestSeen(state))) return;
    try { const best = await bestDeviceCopy(); if (best && highestSeen(best) > highestSeen(state)) { state = complete(sanitize(mergeStates(state, best))); persist(); for (const fn of listeners) fn(state); } } catch {}
  });
  return true;
}
async function bestDeviceCopy() {
  for (const s of await dev.slots()) { const p = parseState(s.raw); if (p) return sanitize(p); }
  return null;
}
state = load();
if (recovery) mergePending = true;
if (recovery?.kept) persist();                 // write the repaired copy (the damaged one is kept under its own key)
if (recovery) { if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', alerts, { once: true }); else setTimeout(alerts, 0); } }
if (!lsOk) { persistence.ok = false; persistence.lastError = 'This browser blocks saving on this device'; }
