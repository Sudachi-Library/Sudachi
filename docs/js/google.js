// Google for Sudachi: sign-in (Google Identity Services token client), Calendar and Drive.
// One Cloud project / web client for all the apps (Yuzu, Mephisto, Orange, Sinus…), no backend, no secret.
//
// Sign-in: the first connect shows Google's consent window. Afterwards a renewal (`prompt: ''`) goes through without a
// screen, but phones only let Google's window open inside a tap — so renewals happen on the next tap anywhere in the
// app (see renewOnTap), never from a timer. The one-hour token lives in localStorage on this device only.
//
// Drive layout (HUB.md): My Apps/hub/sudachi/{state,status}.json · My Apps/hub/sudachi/backups/state-YYYY-MM-DD.json.
// Sudachi only READS other apps' files (mandarin/shifts.json for your shifts, citrus/state.json once for the migration,
// citrus/plan.json for Plan's blocks);
// it never writes into another app's folder, and never touches My Apps/Rotas (Mandarin's).
//
// What keeps it fast and solid:
//  - folder ids cached by path and verified once per app session (one request for the deepest folder vouches for the path)
//  - one in-flight lookup per path (parallel steps never create twin folders); writes to one file are queued
//  - the Drive changes feed answers "anything new?" in one request; only what changed is read again
//  - every file Sudachi writes carries a content fingerprint (appProperties.h): identical content is never re-uploaded,
//    and other devices can tell what changed from the changes feed without downloading
//  - state.json is written only after checking nobody else wrote it since we read it (else: pull, merge, write)
//  - duplicates (a create whose answer was lost) are healed: newest wins, the rest go to the trash
//  - retries with jittered backoff for dropped connections (~25 s), rate limits and 5xx; offline fails fast

import { salvageJSON } from './store.js';

const SCOPES = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email';
const TOKEN_KEY = 'sudachi.google';     // {access_token, exp, email}
const IDS_KEY = 'sudachi.drive.ids';    // path → folder id, file ids by "path/name"
export const DRIVE = 'https://www.googleapis.com/drive/v3';
export const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';

export class GoogleError extends Error {
  constructor(message, { status = 0, auth = false, retryable = false, network = false } = {}) { super(message); this.status = status; this.auth = auth; this.retryable = retryable; this.network = network; }
}
export const stats = { requests: 0, retries: 0, errors: 0, lastError: '', lastErrorAt: 0, skippedWrites: 0, bytesUp: 0, bytesDown: 0, healed: 0 };
export const auth = { needsSignIn: false, lastError: '' };

// ════════════════════════════════════════ token & sign-in
let token = loadToken();
let clientId = '';
let tokenClient = null;
let pending = null;            // {resolve, reject} of the request in flight
const authListeners = new Set();

function loadToken() { try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; } }
function saveToken(t) {
  token = t ? { ...(token || {}), ...t } : null;
  try { token ? localStorage.setItem(TOKEN_KEY, JSON.stringify(token)) : localStorage.removeItem(TOKEN_KEY); } catch {}
  for (const fn of authListeners) fn(isSignedIn());
}
function expireToken() { if (token) { auth.needsSignIn = true; saveToken({ access_token: '', exp: 0 }); } }
export function onAuthChange(fn) { authListeners.add(fn); return () => authListeners.delete(fn); }
export function isSignedIn() { return !!(token?.access_token && token.exp - Date.now() > 60000); }
export function wasSignedIn() { return !!(token?.email); }
export function accountEmail() { return token?.email || ''; }
export function tokenMinutesLeft() { return token?.exp ? Math.max(0, Math.round((token.exp - Date.now()) / 60000)) : 0; }

let gisLoading = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => { gisLoading = null; rej(new GoogleError('Google sign-in did not load. Are you online?', { retryable: true, network: true })); };
    document.head.append(s);
  });
  return gisLoading;
}

/** Prepare sign-in: load Google's script and the token client now, so a later tap can open the window at once. */
export async function init(id) {
  clientId = id; if (!clientId) return false;
  await loadGis();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId, scope: SCOPES, include_granted_scopes: true,
    callback: async (r) => {
      const p = pending; pending = null; if (!p) return;
      if (r.error) { auth.lastError = r.error_description || r.error; return p.reject(new GoogleError(/interaction|login_required|consent/.test(r.error) ? 'Google needs you to sign in again.' : `Google sign-in: ${auth.lastError}`, { status: 401, auth: true })); }
      saveToken({ access_token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
      auth.needsSignIn = false; auth.lastError = '';
      if (!token.email) { try { const u = await userInfo(); saveToken({ email: u.email || '' }); } catch {} }
      p.resolve(token);
    },
    error_callback: (e) => {
      const p = pending; pending = null; if (!p) return;
      p.reject(new GoogleError(e?.type === 'popup_closed' ? 'Sign-in window closed.' : e?.type === 'popup_failed_to_open' ? 'The browser blocked Google\'s window — tap again.' : `Google sign-in: ${e?.message || e?.type || 'failed'}`, { auth: true }));
    },
  });
  return true;
}

/** Get a token. Must run inside a tap on phones. `renew`: the account already agreed, so no consent screen. */
export function signIn({ renew = false } = {}) {
  if (pending) return pending.promise;
  if (!tokenClient) return Promise.reject(new GoogleError(clientId ? 'Google sign-in is still loading — tap again.' : 'Add the Google client ID in Settings first.', { auth: true }));
  let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
  pending = { resolve, reject, promise };
  const timer = setTimeout(() => { if (pending?.promise === promise) { pending = null; reject(new GoogleError('Sign-in took too long — tap again.', { auth: true })); } }, renew ? 20000 : 180000);
  promise.finally(() => clearTimeout(timer)).catch(() => {});
  tokenClient.requestAccessToken({ prompt: renew ? '' : 'consent', ...(token?.email ? { hint: token.email } : {}) });   // synchronous: keeps the tap's permission to open a window
  return promise;
}

/** The token expires after an hour. The next tap anywhere renews it (no screen), so syncs keep working on phones. */
let tapHooked = false;
export function renewOnTap(onRenewed) {
  if (tapHooked) return; tapHooked = true;
  document.addEventListener('pointerdown', () => {
    if (isSignedIn() || !wasSignedIn() || !tokenClient || pending || navigator.onLine === false) return;
    signIn({ renew: true }).then(() => onRenewed?.()).catch(() => { auth.needsSignIn = true; for (const fn of authListeners) fn(false); });
  }, { capture: true });
}

export function signOut() {
  if (token?.access_token && window.google?.accounts?.oauth2) try { window.google.accounts.oauth2.revoke(token.access_token, () => {}); } catch {}
  saveToken(null); auth.needsSignIn = false; ids = {}; persistIds(); verified.clear();
}

// ════════════════════════════════════════ requests
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const backoff = (attempt, retryAfter) => sleep(retryAfter ? Math.min(30000, retryAfter * 1000) : Math.min(16000, 800 * 2 ** attempt) * (0.75 + Math.random() * 0.5));
const SAFE = /^(GET|HEAD|PATCH|PUT|DELETE)$/i;

/** Authenticated fetch: retries what can be retried, plain-word errors, a 401 asks for a tap. `raw` returns bytes. */
async function gfetch(url, opts = {}) {
  if (!isSignedIn()) { if (wasSignedIn()) auth.needsSignIn = true; throw new GoogleError(wasSignedIn() ? 'Google needs a tap to reconnect.' : 'Not signed in to Google.', { status: 401, auth: true }); }
  if (navigator.onLine === false) throw new GoogleError('You\'re offline — nothing is lost; Sudachi syncs when you\'re back.', { network: true, retryable: true });
  const method = opts.method || 'GET';
  let res, msg = '';
  for (let attempt = 0; ; attempt++) {
    stats.requests++;
    try { res = await fetch(url, { ...opts, cache: 'no-store', headers: { ...(opts.headers || {}), Authorization: `Bearer ${token.access_token}` } }); }
    catch (e) {
      // a dropped connection: repeat requests that are safe to send twice, for ~25 s
      if ((SAFE.test(method) || opts.retrySafe) && attempt < 5) { stats.retries++; await backoff(attempt); continue; }
      fail('Network error'); throw new GoogleError('Google couldn\'t be reached — the connection dropped.', { network: true, retryable: true });
    }
    msg = '';
    if (res.status === 403 || res.status === 429) { try { const j = await res.clone().json(); msg = `${j?.error?.message || ''} ${(j?.error?.errors || []).map(x => x.reason).join(' ')}`; } catch {} }
    const slowDown = res.status === 429 || (res.status === 403 && /rate ?limit|quota|userRateLimitExceeded|rateLimitExceeded/i.test(msg));
    if ((slowDown || res.status >= 500) && attempt < 6) { stats.retries++; await backoff(attempt + 1, +res.headers.get('retry-after') || 0); continue; }
    break;
  }
  if (res.ok) {
    if (res.status === 204) return null;
    if (opts.raw) { const b = await res.arrayBuffer(); stats.bytesDown += b.byteLength; return b; }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.arrayBuffer();
  }
  if (!msg) { try { msg = (await res.clone().json())?.error?.message || ''; } catch {} }
  if (res.status === 401 || (res.status === 403 && /insufficient|scope/i.test(msg))) { expireToken(); fail('Sign-in expired'); throw new GoogleError('Google needs a tap to reconnect.', { status: res.status, auth: true }); }
  fail(`${res.status} ${msg.trim() || res.statusText}`);
  throw new GoogleError(res.status === 404 ? 'Not found on Drive.' : res.status >= 500 || res.status === 429 ? `Google is busy (${res.status}) — Sudachi tries again later.` : `Google ${res.status}: ${msg.trim() || res.statusText}`, { status: res.status, retryable: res.status >= 500 || res.status === 429 });
}
function fail(m) { stats.errors++; stats.lastError = m; stats.lastErrorAt = Date.now(); }

export async function userInfo() { return gfetch('https://www.googleapis.com/oauth2/v3/userinfo'); }

// ════════════════════════════════════════ Calendar
const CAL = 'https://www.googleapis.com/calendar/v3';
export async function listCalendars() {
  const j = await gfetch(`${CAL}/users/me/calendarList?minAccessRole=reader`);
  return (j.items || []).map(c => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary, color: c.backgroundColor, accessRole: c.accessRole }));
}
export async function listEvents(calendarId, from, to) {
  const out = []; let page = '';
  do {
    const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', ...(page ? { pageToken: page } : {}) });
    const j = await gfetch(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
    out.push(...(j.items || []).filter(e => e.status !== 'cancelled').map(e => normalizeEvent(e, calendarId)));
    page = j.nextPageToken || '';
  } while (page);
  return out;
}
function normalizeEvent(e, calendarId) {
  const allDay = !!e.start?.date;
  const start = allDay ? new Date(e.start.date + 'T00:00:00') : new Date(e.start.dateTime);
  const end = allDay ? new Date(e.end.date + 'T00:00:00') : new Date(e.end.dateTime);
  return { id: e.id, calendarId, title: e.summary || '(no title)', start, end, allDay, location: e.location || '', tag: e.extendedProperties?.private?.sudachi || '', citrus: e.extendedProperties?.private?.citrus || '', htmlLink: e.htmlLink, color: e.colorId };
}
export async function createEvent(calendarId, { title, start, end, description = '', location = '', tag = '', colorId, key = '', reminders = null, recurrence = null, timeZone = '' }) {
  const body = { summary: title, description, location, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, extendedProperties: { private: { sudachi: tag || 'event', ...(key ? { key } : {}) } } };
  if (colorId) body.colorId = colorId;
  // alarms: minutes before the start, as pop-ups (your phone's Calendar app rings them even when Sudachi is closed)
  if (Array.isArray(reminders)) body.reminders = { useDefault: false, overrides: reminders.slice(0, 5).map(m => ({ method: 'popup', minutes: Math.max(0, Math.min(40320, +m || 0)) })) };
  if (Array.isArray(recurrence) && recurrence.length) { const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; body.recurrence = recurrence; body.start = { dateTime: start.toISOString(), timeZone: tz }; body.end = { dateTime: end.toISOString(), timeZone: tz }; }
  const j = await gfetch(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return normalizeEvent(j, calendarId);
}
/** Find an event Sudachi created earlier by its key (so a create whose answer was lost isn't made twice). */
export async function findEventByKey(calendarId, key, from, to) {
  const q = new URLSearchParams({ privateExtendedProperty: `key=${key}`, timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', maxResults: '5' });
  const j = await gfetch(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
  const e = (j.items || []).find(x => x.status !== 'cancelled'); return e ? normalizeEvent(e, calendarId) : null;
}
export async function patchEvent(calendarId, eventId, patch) {
  const body = {};
  if (patch.title) body.summary = patch.title;
  if (patch.start) body.start = { dateTime: patch.start.toISOString() };
  if (patch.end) body.end = { dateTime: patch.end.toISOString() };
  const j = await gfetch(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return normalizeEvent(j, calendarId);
}
export async function deleteEvent(calendarId, eventId) {
  try { await gfetch(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }); }
  catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }   // already gone is fine
}
export async function ensureCalendar(name) {
  const cals = await listCalendars();
  const found = cals.find(c => c.name === name);
  if (found) return found.id;
  const j = await gfetch(`${CAL}/calendars`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: name, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
  return j.id;
}
/** Make the Sudachi-tagged events in a range match `wanted` (creates the missing, deletes the extra, leaves the rest). */
export async function syncTaggedEvents(calendarId, tag, from, to, wanted) {
  const existing = (await listEvents(calendarId, from, to)).filter(e => e.tag === tag);
  const key = (e) => `${e.title}|${e.start.toISOString()}|${e.end.toISOString()}`;
  const have = new Map(); const extra = [];
  for (const e of existing) { if (have.has(key(e))) extra.push(e); else have.set(key(e), e); }   // twins from an earlier lost answer
  const want = new Map(wanted.map(e => [key(e), e]));
  let created = 0, deleted = 0;
  for (const e of extra) { await deleteEvent(calendarId, e.id); deleted++; }
  for (const [k, e] of have) if (!want.has(k)) { await deleteEvent(calendarId, e.id); deleted++; }
  for (const [k, e] of want) if (!have.has(k)) { await createEvent(calendarId, { ...e, tag }); created++; }
  return { created, deleted };
}

// ════════════════════════════════════════ Drive basics
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
let ids = {};
try { ids = JSON.parse(localStorage.getItem(IDS_KEY) || '{}') || {}; } catch {}
function persistIds() { try { localStorage.setItem(IDS_KEY, JSON.stringify(ids)); } catch {} }
const verified = new Set();       // ids confirmed to exist this session
export function knownFolderIds() { return { ...ids }; }
/** Check every cached folder id again on next use (a full sync does this). */
export function reverify() { verified.clear(); }
/** Forget every cached id (a watched folder was deleted or moved): paths are looked up again, created if missing. */
export function forgetFolders() { ids = {}; persistIds(); verified.clear(); seenState = null; for (const k of Object.keys(tagCache)) delete tagCache[k]; }

const FIELDS = 'id,name,mimeType,createdTime,modifiedTime,size,md5Checksum,appProperties,parents,trashed';
async function list(parentId, { name, folders, extra, all } = {}) {
  const parts = ['trashed = false', `'${q(parentId)}' in parents`];
  if (name) parts.push(`name = '${q(name)}'`);
  if (folders) parts.push(`mimeType = '${FOLDER}'`);
  if (extra) parts.push(extra);
  const out = []; let page = '';
  do {
    const p = new URLSearchParams({ q: parts.join(' and '), fields: `nextPageToken,files(${FIELDS})`, pageSize: all ? '1000' : '100', orderBy: 'modifiedTime desc', spaces: 'drive', ...(page ? { pageToken: page } : {}) });
    const j = await gfetch(`${DRIVE}/files?${p}`);
    out.push(...(j.files || []));
    page = all ? j.nextPageToken || '' : '';
  } while (page);
  return out;
}
export async function fileMeta(id, fields = FIELDS) { return gfetch(`${DRIVE}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`); }
async function mkdir(name, parentId, description = '') {
  const j = await gfetch(`${DRIVE}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId], ...(description ? { description } : {}) }) });
  return j.id;
}
async function trash(id) { await gfetch(`${DRIVE}/files/${encodeURIComponent(id)}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); }

async function exists(id) {
  if (verified.has(id)) return true;
  try { const f = await fileMeta(id, 'id,trashed'); if (f && !f.trashed) { verified.add(id); return true; } } catch (e) { if (e.status !== 404) throw e; }
  return false;
}
// Folder id for a path like ['My Apps','hub','sudachi'], created where missing. Each level is resolved once at a time.
const pathInflight = new Map();
export async function ensurePath(parts, { create = true } = {}) {
  const key = parts.join('/');
  // fast path: the cached deepest id, checked once per session, vouches for the whole path
  if (ids[key] && await exists(ids[key])) return ids[key];
  if (ids[key]) { for (const k of Object.keys(ids)) if (k === key || k.startsWith(key + '/')) delete ids[k]; persistIds(); }
  return resolve(parts, create);
}
function resolve(parts, create) {
  if (!parts.length) return Promise.resolve('root');
  const key = parts.join('/');
  if (ids[key] && verified.has(ids[key])) return Promise.resolve(ids[key]);
  if (pathInflight.has(key)) return pathInflight.get(key);
  if (!create && pathInflight.has(key + '?')) return pathInflight.get(key + '?');
  const flight = key + (create ? '' : '?');
  const p = (async () => {
    const parent = await resolve(parts.slice(0, -1), create);
    if (!parent) return null;
    if (ids[key] && await exists(ids[key])) return ids[key];
    const name = parts[parts.length - 1];
    const found = await list(parent, { name, folders: true });
    // twins (an earlier race): the oldest is the real one; Repair Drive merges the others into it
    const pick = found.sort((a, b) => (a.createdTime || a.modifiedTime || '').localeCompare(b.createdTime || b.modifiedTime || ''))[0];
    const id = pick ? pick.id : create ? await mkdir(name, parent) : null;
    if (id) { ids[key] = id; verified.add(id); persistIds(); }
    return id;
  })().finally(() => pathInflight.delete(flight));
  pathInflight.set(flight, p);
  return p;
}

/** The newest file called `name` in a folder; older twins are returned so the caller can heal them. */
async function findFile(folderId, name) {
  const files = await list(folderId, { name });
  files.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
  return { file: files[0] || null, twins: files.slice(1) };
}
export async function downloadFile(fileId) { return gfetch(`${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media`, { raw: true }); }
const decode = (buf) => new TextDecoder().decode(buf);

// Fingerprint of a JSON payload (FNV-1a over canonical JSON: keys sorted, so key order never matters), stored as appProperties.h
export function fingerprint(obj, omit = ['updatedAt']) {
  const s = JSON.stringify(obj, (k, v) => (omit.includes(k) ? undefined : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v));
  let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16) + ':' + s.length;
}

// One write at a time per file; the same content is never uploaded twice.
const writeQueue = new Map();
const lastWritten = new Map();   // "folder/name" → fingerprint we last uploaded
function putJson(folderId, name, obj, { props = {}, fileId = null, healTwins = false, omit, always = false } = {}) {
  const key = `${folderId}/${name}`;
  const prev = writeQueue.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => putJsonOnce(folderId, name, obj, props, fileId, healTwins, key, omit, always));
  writeQueue.set(key, next);
  next.finally(() => { if (writeQueue.get(key) === next) writeQueue.delete(key); }).catch(() => {});
  return next;
}
async function putJsonOnce(folderId, name, obj, props, fileId, healTwins, key, omit, always) {
  const h = fingerprint(obj, omit);
  const idKey = `file:${key}`;
  let id = fileId || ids[idKey] || null;
  let twins = [];
  if (!id) { const r = await findFile(folderId, name); id = r.file?.id || null; twins = r.twins; if (!always && r.file?.appProperties?.h === h) { ids[idKey] = id; persistIds(); lastWritten.set(key, h); stats.skippedWrites++; return { id, modifiedTime: r.file.modifiedTime, skipped: true }; } }
  else if (!always && lastWritten.get(key) === h) { stats.skippedWrites++; return { id, skipped: true }; }
  const body = JSON.stringify(obj);
  const boundary = 'sudachi' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const meta = id ? { appProperties: { ...props, h } } : { name, parents: [folderId], mimeType: 'application/json', appProperties: { ...props, h } };
  const payload = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  let r;
  try { r = await gfetch(`${UPLOAD}/files${id ? '/' + encodeURIComponent(id) : ''}?uploadType=multipart&fields=id,modifiedTime`, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: payload }); }
  catch (e) {
    if (e.status === 404 && id) { delete ids[idKey]; persistIds(); return putJsonOnce(folderId, name, obj, props, null, healTwins, key, omit, always); }   // deleted on Drive: create again
    if (e.network && !id) {   // a create whose answer was lost may have happened: look before trying again
      const again = await findFile(folderId, name).catch(() => null);
      if (again?.file?.appProperties?.h === h) { ids[idKey] = again.file.id; persistIds(); lastWritten.set(key, h); return { id: again.file.id, modifiedTime: again.file.modifiedTime }; }
    }
    throw e;
  }
  stats.bytesUp += body.length;
  ids[idKey] = r.id; persistIds(); lastWritten.set(key, h);
  if (healTwins && twins.length) for (const t of twins) trash(t.id).catch(() => {});
  return r;
}
async function readJsonFile(file) {
  const buf = await downloadFile(file.id);
  try { return JSON.parse(decode(buf)); } catch { return null; }
}

// ════════════════════════════════════════ changes feed
/** A token marking "now" in the Drive changes feed. */
export async function startToken() { return (await gfetch(`${DRIVE}/changes/startPageToken`))?.startPageToken || ''; }
/** Everything that changed in My Drive since `token` (one request when nothing did). null when the token expired (start over). */
export async function changesSince(tokenStr, maxPages = 20) {
  const out = []; let t = tokenStr; let next = tokenStr;
  for (let i = 0; i < maxPages && t; i++) {
    let page;
    try { page = await gfetch(`${DRIVE}/changes?pageToken=${encodeURIComponent(t)}&fields=${encodeURIComponent('nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents,trashed,modifiedTime,appProperties))')}&pageSize=1000&spaces=drive&includeRemoved=true`); }
    catch (e) { if (e.status === 404 || e.status === 410 || e.status === 400) return null; throw e; }
    for (const c of page.changes || []) { const f = c.file || {}; out.push({ id: f.id || c.fileId, removed: !!c.removed, name: f.name, mimeType: f.mimeType, parents: f.parents || [], trashed: !!f.trashed, modifiedTime: f.modifiedTime, props: f.appProperties || {} }); }
    if (page.newStartPageToken) { next = page.newStartPageToken; t = ''; } else { t = page.nextPageToken || ''; next = t || next; }
  }
  return { changes: out, token: next, more: !!t };
}

// ════════════════════════════════════════ the hub
export const APP = 'sudachi';
// Folders are found by their tag, never by path (claude/drive-layout.md, 17/11/2026): every app folder carries
// appProperties.citrusApp = "<id>", so Citrus can move and rename it under Citrus/… and Sudachi still finds it. Only when nothing
// is tagged yet does Sudachi fall back to the old path (My Apps/hub/<id>); its own folder is then created there if missing and
// tagged at once. Sudachi never renames or moves a folder, and never creates one by path once a tagged one exists anywhere.
const P = (root) => ({ hub: [root, 'hub'], other: (app) => [root, 'hub', app] });
export const TAG = 'citrusApp';
const tagCache = {};   // app → folder id (or null), checked once per app session
const tagInflight = new Map();
/** The folder tagged citrusApp=<app> (the oldest when there are several), or null. */
export function findTagged(app) {
  if (app in tagCache) return Promise.resolve(tagCache[app]);
  if (tagInflight.has(app)) return tagInflight.get(app);
  const p = (async () => {
    const cached = ids[`tag:${app}`];
    if (cached && await exists(cached)) { const f = await fileMeta(cached, 'id,appProperties,trashed').catch(() => null); if (f && !f.trashed && f.appProperties?.[TAG] === app) return (tagCache[app] = cached); }
    const qs = new URLSearchParams({ q: `mimeType = '${FOLDER}' and trashed = false and appProperties has { key='${TAG}' and value='${q(app)}' }`, fields: 'files(id,name,parents,createdTime)', spaces: 'drive', pageSize: '20' });
    const j = await gfetch(`${DRIVE}/files?${qs}`);
    const pick = (j.files || []).sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || ''))[0];
    if (pick) { ids[`tag:${app}`] = pick.id; verified.add(pick.id); } else delete ids[`tag:${app}`];
    persistIds();
    return (tagCache[app] = pick ? pick.id : null);
  })().finally(() => tagInflight.delete(app));
  tagInflight.set(app, p); return p;
}
async function tagFolder(id, app) { await gfetch(`${DRIVE}/files/${encodeURIComponent(id)}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appProperties: { [TAG]: app } }) }); ids[`tag:${app}`] = id; persistIds(); tagCache[app] = id; }
/** A folder by tag; else the old path. own: create it there if missing and tag it. */
export async function folderOf(root, app, { own = false } = {}) {
  const t = await findTagged(app); if (t) return t;
  const id = await ensurePath(P(root).other(app), { create: own });
  if (id && own) await tagFolder(id, app).catch(e => console.warn('tag', e.message));
  return id || null;
}
const meDir = (root) => folderOf(root, APP, { own: true });
/** A sub-folder (backups) inside a folder found by id, created when asked. */
async function childFolder(parentId, name, create = true) {
  const key = `child:${parentId}/${name}`;
  if (ids[key] && await exists(ids[key])) return ids[key];
  const found = (await list(parentId, { name, folders: true })).sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || ''))[0];
  const id = found ? found.id : create ? await mkdir(name, parentId) : null;
  if (id) { ids[key] = id; verified.add(id); persistIds(); }
  return id;
}
const backupsDir = async (root, create = true) => { const me = await meDir(root); return childFolder(me, 'backups', create); };
/** Whether Sudachi found its own folder by tag this session (for status.json › drive). */
export const ownTagged = () => !!tagCache[APP];

/** Folder ids Sudachi watches in the changes feed: its own folder, and the folders of the apps it reads (Mandarin, Citrus). */
export async function watchedFolders(root) {
  const [me, mandarin, citrus] = await Promise.all([meDir(root), folderOf(root, 'mandarin'), folderOf(root, 'citrus')]);
  const hub = await ensurePath(P(root).hub, { create: false }).catch(() => null);
  return { hub: hub || '', me, mandarin: mandarin || '', citrus: citrus || '' };
}

/** Sudachi's small public file in its own folder: status.json (what Citrus shows). */
export async function writeOwnFile(root, name, obj, { omit = ['updatedAt'] } = {}) { const dir = await meDir(root); return putJson(dir, name, obj, { omit, healTwins: true }); }

/** Another app's JSON file, read only, from its tagged folder (or hub/<app>). null when it is not there. Twins are left alone (not ours to tidy). */
export async function readOtherFile(root, app, name) {
  const dir = await folderOf(root, app); if (!dir) return null;
  const { file } = await findFile(dir, name); if (!file) return null;
  const data = await readJsonFile(file);
  return data && typeof data === 'object' ? { data, modifiedTime: file.modifiedTime, id: file.id } : null;
}

// ── Sudachi's own state: read with its revision, written only if nobody else wrote it since
let seenState = null;   // {id, rev, modifiedTime} of the state.json we last read or wrote
export async function loadRemoteState(root) {
  const dir = await meDir(root);
  const { file, twins } = await findFile(dir, 'state.json');
  if (!file) { seenState = null; return null; }
  for (const t of twins) trash(t.id).catch(() => {});
  ids[`file:${dir}/state.json`] = file.id; persistIds();
  let data = await readJsonFile(file);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    // unreadable (cut off, garbage): merge in whatever can still be read, and move the damaged file aside instead of overwriting it
    let text = ''; try { text = decode(await downloadFile(file.id)); } catch {}
    data = salvageJSON(text);
    await gfetch(`${DRIVE}/files/${encodeURIComponent(file.id)}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `state.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}.json` }) }).catch(() => {});
    delete ids[`file:${dir}/state.json`]; persistIds(); lastWritten.delete(`${dir}/state.json`); seenState = null; stats.healed++;
    return data;
  }
  seenState = { id: file.id, rev: file.appProperties?.rev || '', modifiedTime: file.modifiedTime };
  if (file.appProperties?.h) lastWritten.set(`${dir}/state.json`, file.appProperties.h); else lastWritten.delete(`${dir}/state.json`);
  return data;
}
/** Has another device written state.json since we last read it? (one metadata request) */
export async function remoteStateMoved() {
  if (!seenState?.id) return false;
  try { const m = await fileMeta(seenState.id, 'id,modifiedTime,trashed,appProperties'); return !m || m.trashed ? true : (m.appProperties?.rev || '') !== seenState.rev; }
  catch (e) { if (e.status === 404) return true; throw e; }
}
export async function saveRemoteState(root, state, { force = false } = {}) {
  const dir = await meDir(root);
  if (!force && await remoteStateMoved()) { const e = new GoogleError('Another device saved first.', { status: 409 }); e.conflict = true; throw e; }
  const rev = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 7)}`;
  const r = await putJson(dir, 'state.json', state, { props: { rev }, fileId: seenState?.id || null, always: force });
  if (!r.skipped) seenState = { id: r.id, rev, modifiedTime: r.modifiedTime };
  return r;
}
export function seenStateRev() { return seenState?.rev || ''; }

// ── daily backups of state.json: hub/sudachi/backups/state-YYYY-MM-DD.json, the newest 14 kept
export async function backupDaily(root, state, dayKey) {
  const dir = await backupsDir(root);
  const name = `state-${dayKey}.json`, size = JSON.stringify(state).length;
  // today's copy is taken again when the data has grown a lot since (the first sync of day one was an empty 717 B: beta T5-07)
  const had = +ids[`backup:${name}`] || 0;
  if (had && (had === 1 || size < had * 1.5 + 4000)) return false;
  const existing = await list(dir, { extra: "name contains 'state-'" });
  const same = existing.find(f => f.name === name);
  if (same && !had) { ids[`backup:${name}`] = String(+same.size || 1); persistIds(); return backupDaily(root, state, dayKey); }
  if (same) await trash(same.id).catch(() => {});
  await putJson(dir, name, state);
  ids[`backup:${name}`] = String(size); persistIds();
  const old = existing.filter(f => f.name !== name).sort((a, b) => b.name.localeCompare(a.name)).slice(13);
  for (const f of old) trash(f.id).catch(() => {});
  return true;
}
/** A copy kept just before a risky step (migration, restore, replace): hub/sudachi/backups/state-YYYY-MM-DD-before-<what>.json. */
export async function backupBefore(root, state, what) {
  const dir = await backupsDir(root);
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  await putJson(dir, `state-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-before-${what}-${p2(d.getHours())}${p2(d.getMinutes())}.json`, state);
}
export async function listBackups(root) {
  const dir = await backupsDir(root, false); if (!dir) return [];
  return (await list(dir, { extra: "name contains 'state-'" })).sort((a, b) => b.name.localeCompare(a.name)).map(f => ({ id: f.id, name: f.name, date: f.name.slice(6, 16), size: +f.size || 0 }));
}
export async function readBackup(id) { return readJsonFile({ id }); }

// ════════════════════════════════════════ scan & repair the whole My Apps tree
/** Walk My Apps and report what's out of place: twin folders, twin files, stray old roots. Read-only. */
export async function scanDrive(root) {
  const report = { folders: 0, files: 0, twinFolders: [], twinFiles: [], strayRoots: [], tree: [] };
  const rootId = await ensurePath([root], { create: false });
  if (!rootId) return report;
  const walk = async (id, path, depth) => {
    const kids = await list(id, { all: true });
    const byName = new Map();
    for (const k of kids) { const key = `${k.mimeType === FOLDER ? 'd' : 'f'}:${k.name}`; (byName.get(key) || byName.set(key, []).get(key)).push(k); }
    for (const [key, group] of byName) {
      const isDir = key.startsWith('d:'); const name = key.slice(2);
      if (isDir) report.folders += group.length; else report.files += group.length;
      // Sudachi fixes what it owns (hub/sudachi/); every other app's folder is shown, never touched
      const ours = (depth === 1 && path[1] === 'hub' && name === 'sudachi') || (depth > 1 && path[2] === 'sudachi');
      if (group.length > 1) (isDir ? report.twinFolders : report.twinFiles).push({ path: [...path, name].join('/'), fixable: ours, items: group.map(g => ({ id: g.id, modifiedTime: g.modifiedTime, createdTime: g.createdTime, size: +g.size || 0 })) });
      if (depth < 3) report.tree.push(`${'  '.repeat(depth)}${isDir ? '▸' : '·'} ${name}${group.length > 1 ? ` ×${group.length}` : ''}${ours || (depth === 0 && name === 'hub') ? '' : isDir ? '  (its app looks after it)' : ''}`);
      if (isDir && (ours || (depth === 0 && name === 'hub')) && depth < 4) for (const g of group) await walk(g.id, [...path, name], depth + 1);
    }
  };
  await walk(rootId, [root], 0);
  for (const stray of ['Citrus Maxima']) { const f = await list('root', { name: stray, folders: true }); if (f.length) report.strayRoots.push({ name: stray, items: f.map(x => x.id) }); }
  const rootTwins = await list('root', { name: root, folders: true }); if (rootTwins.length > 1) report.twinFolders.unshift({ path: root, fixable: true, items: rootTwins.map(g => ({ id: g.id, modifiedTime: g.modifiedTime })) });
  return report;
}
/** Fix what scanDrive found: twin files → newest kept, others trashed; twin folders → contents moved into the oldest, empty twins trashed. */
export async function repairDrive(report) {
  let moved = 0, trashed = 0;
  for (const t of report.twinFiles.filter(x => x.fixable)) {
    const keep = [...t.items].sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''))[0];
    for (const it of t.items) if (it.id !== keep.id) { await trash(it.id); trashed++; }
  }
  for (const t of report.twinFolders.filter(x => x.fixable)) {
    const keep = [...t.items].sort((a, b) => (a.createdTime || a.modifiedTime || '').localeCompare(b.createdTime || b.modifiedTime || ''))[0];
    for (const it of t.items) {
      if (it.id === keep.id) continue;
      for (const child of await list(it.id, { all: true })) {
        await gfetch(`${DRIVE}/files/${encodeURIComponent(child.id)}?addParents=${encodeURIComponent(keep.id)}&removeParents=${encodeURIComponent(it.id)}&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        moved++;
      }
      await trash(it.id); trashed++;
    }
  }
  ids = {}; persistIds(); verified.clear();   // folder ids may have changed
  return { moved, trashed };
}
