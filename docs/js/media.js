// The library: what you watch, read and play. Records, imports (Goodreads / IMDb CSV, MyAnimeList, Steam), progress and the
// shelf, finishing (and finishing again: rewatches and rereads), the backlog and its brain dump, "still on this?", and the
// numbers every screen and the hub file use. Ported from Citrus Maxima's media.js (16/11/2026): ratings became the S–F tier
// scale (tiers.js), MAL is imported directly, memos went to Bergamot. Records are maps id → {…, at}, so devices merge record
// by record and deletions leave tombstones ('media:<id>'). Pure (no DOM).
import { keyOf, fromKey, addDays, startOfDay, uid, safeUrl } from './util.js';
import { cleanScore, convertAll } from './tiers.js';

const rec = (o) => Object.values(o || {});
export const KINDS = [
  { id: 'anime', name: 'Anime', one: 'anime', emoji: '🍥', color: '#ff4fa3', unit: 'ep', units: 'eps', per: 24 },
  { id: 'show', name: 'Series', one: 'series', emoji: '📺', color: '#7c6cff', unit: 'ep', units: 'eps', per: 45 },
  { id: 'movie', name: 'Films', one: 'film', emoji: '🎬', color: '#ffb000', unit: '', units: '', per: 115 },
  { id: 'manga', name: 'Comics & manga', one: 'comic', emoji: '🗯', color: '#c47bff', unit: 'ch', units: 'ch', per: 8 },
  { id: 'book', name: 'Books', one: 'book', emoji: '📚', color: '#b8f03c', unit: 'p', units: 'pages', per: 1.5 },
  { id: 'game', name: 'Games', one: 'game', emoji: '🎮', color: '#21d4fd', unit: 'h', units: 'h', per: 60 },
  { id: 'album', name: 'Albums', one: 'album', emoji: '💿', color: '#ff7a1a', unit: 'track', units: 'tracks', per: 4 },
];
const READ = (k) => k === 'book' || k === 'manga';
export const kindOf = (id) => KINDS.find(k => k.id === id) || KINDS[0];
export const STATUS = { planned: 'Backlog', doing: 'On the shelf', done: 'Finished', paused: 'On hold', dropped: 'Dropped' };
const HEAR = (k) => k === 'album';
export const statusWord = (kind, st) => ({ planned: READ(kind) ? 'Want to read' : HEAR(kind) ? 'Want to hear' : kind === 'game' ? 'Backlog' : 'Want to watch', doing: READ(kind) ? 'Reading' : HEAR(kind) ? 'Listening' : kind === 'game' ? 'Playing' : 'Watching', done: READ(kind) ? 'Read' : HEAR(kind) ? 'Heard' : kind === 'game' ? 'Played' : 'Watched', paused: 'On hold', dropped: 'Dropped' }[st] || st);
export const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9؀-ۿ぀-ヿ一-鿿]+/g, ' ').trim();
const lc = (x) => String(x || '').toLowerCase().trim();
export const IMPORTED = new Set(['goodreads', 'imdb', 'anilist', 'steam', 'mal', 'citrus', 'rym']);
export const SRC_NAME = { goodreads: 'Goodreads', imdb: 'IMDb', rym: 'RateYourMusic', musicbrainz: 'MusicBrainz', mal: 'MyAnimeList', anilist: 'AniList', steam: 'Steam', manual: 'you', citrus: 'Citrus', dump: 'brain dump', openlibrary: 'Open Library', googlebooks: 'Google Books' };

// ───────────────────────────── records
/** The MyAnimeList id of an anime/manga: MAL rows carry it as extId, AniList rows as idMal. It is how the two recognise the same work. */
const malIdOf = (f) => (f.kind === 'anime' || f.kind === 'manga') ? String(f.malId || (f.src === 'mal' && f.extId) || '') : '';
const today = () => keyOf(new Date());
const flagsOf = (f) => ({ comfort: !!f?.comfort, rewatch: !!f?.rewatch, recommend: ['yes', 'no'].includes(f?.recommend) ? f.recommend : '' });
/** A clean record from loose fields (imports, the add sheet, the brain dump). */
export function makeRecord(f, now = Date.now()) {
  const title = String(f.title || '').trim().slice(0, 160); if (!title) return null;
  const kind = KINDS.some(k => k.id === f.kind) ? f.kind : 'book', id = f.id || uid();
  const m = { id, kind, title, orig: String(f.orig || '').slice(0, 160), en: String(f.en || '').slice(0, 160), status: STATUS[f.status] ? f.status : 'planned',
    score: cleanScore(f.score), auto: !!f.auto, srcRating: Math.max(0, +f.srcRating || 0), srcScale: [5, 10, 100].includes(+f.srcScale) ? +f.srcScale : 10, flags: flagsOf(f.flags),
    progress: Math.max(0, +f.progress || 0), total: Math.max(0, +f.total || 0), year: +f.year || 0, creator: String(f.creator || '').slice(0, 100), genres: (f.genres || []).map(g => String(g).slice(0, 30)).slice(0, 8),
    cover: f.cover ? safeUrl(f.cover) : '', src: f.src || 'manual', extId: f.extId ? String(f.extId) : '', malId: malIdOf(f), format: ['paper', 'ebook', 'audio'].includes(f.format) ? f.format : '',
    log: Array.isArray(f.log) ? f.log.slice(-500) : [], plays: Array.isArray(f.plays) ? f.plays.slice(-50) : [], quotes: Array.isArray(f.quotes) ? f.quotes.slice(-100) : [],
    startedAt: f.startedAt || '', finishedAt: f.finishedAt || '', droppedAt: f.droppedAt || '', minutes: Math.max(0, +f.minutes || 0), runtime: Math.max(0, Math.min(900, +f.runtime || 0)), length: Math.max(0, Math.min(2000, +f.length || 0)),
    review: String(f.review || '').slice(0, 2000), pub: Math.max(0, Math.min(10, +f.pub || 0)), enChecked: !!f.enChecked, triage: ['want', 'someday', 'no'].includes(f.triage) ? f.triage : '', nudged: f.nudged || '',
    ach: f.ach && typeof f.ach === 'object' ? { done: +f.ach.done || 0, total: +f.ach.total || 0 } : null, createdAt: f.createdAt || now, at: now };
  if (m.status === 'done' && !m.finishedAt && !IMPORTED.has(m.src)) m.finishedAt = today();   // imports without a date stay undated rather than becoming "today"
  if (m.status === 'doing' && !m.startedAt && !IMPORTED.has(m.src)) m.startedAt = today();
  if (m.status === 'dropped' && !m.droppedAt && !IMPORTED.has(m.src)) m.droppedAt = today();
  if (m.score && !f.auto) m.auto = false;
  return m;
}
export function addMedia(s, f) { const m = makeRecord(f); return m ? { ...s, media: { ...s.media, [m.id]: m } } : s; }
function applyPatch(m, patch) {
  const n = { ...m, ...patch, at: Date.now() };
  if (patch.score !== undefined) { n.score = cleanScore(patch.score); if (patch.auto === undefined) n.auto = false; }
  if (patch.flags) n.flags = flagsOf({ ...m.flags, ...patch.flags });
  if (patch.status === 'done' && !n.finishedAt && !(IMPORTED.has(n.src) && patch.finishedAt === '')) n.finishedAt = today();
  if (patch.status === 'done' && n.total && !patch.progress && n.kind !== 'game') n.progress = n.total;
  if (patch.status === 'doing' && !n.startedAt) n.startedAt = today();
  if (patch.status === 'dropped' && !n.droppedAt) n.droppedAt = today();
  if (patch.status && patch.status !== 'dropped' && m.status === 'dropped' && patch.droppedAt === undefined) n.droppedAt = '';
  if (patch.status && patch.status !== 'doing') n.nudged = '';
  return n;
}
export function updateMedia(s, id, patch) { const m = s.media?.[id]; if (!m) return s; return { ...s, media: { ...s.media, [id]: applyPatch(m, patch) } }; }
export function deleteMedia(s, id) { const media = { ...s.media }; delete media[id]; return { ...s, media, deleted: { ...(s.deleted || {}), [`media:${id}`]: Date.now() } }; }
export const mediaList = (s, kind = '') => rec(s.media).filter(m => !kind || m.kind === kind);
const sameWork = (m, { kind, title, year, src, extId, malId }, nt) => (extId && m.kind === kind && m.src === src && m.extId === String(extId)) || (m.kind === kind && m.malId && m.malId === malIdOf({ kind, src, extId, malId })) || (m.kind === kind && (norm(m.title) === nt || (m.orig && norm(m.orig) === nt) || (m.en && norm(m.en) === nt)) && (!year || !m.year || m.year === year));
export function findMedia(s, f) { const nt = norm(f.title); return rec(s.media).find(m => sameWork(m, f, nt)); }
/** "Original title (English title)": the English part only when it differs. */
export function composeTitle(orig, en) { const o = String(orig || '').trim(), e = String(en || '').trim(); return e && norm(e) !== norm(o) ? `${o} (${e})`.slice(0, 160) : o; }
/** Shown title: original-language title with the English one in brackets when it differs. */
export const shown = (m) => m.orig && m.en ? composeTitle(m.orig, m.en) : m.title;

/** What an import changes on an existing record. Your own score/status are never overwritten unless the record has none (or you ask for sync). */
function importPatch(cur, f, opts) {
  const patch = {};
  if (opts.sync && cur.src === f.src && IMPORTED.has(cur.src) && f.status) {   // the file is the source of truth for what came from it
    if (cur.status !== f.status && !(cur.status === 'done' && f.status === 'doing' && cur.plays?.length)) patch.status = f.status;
    if (f.status === 'done' && (cur.finishedAt || '') !== (f.finishedAt || '') && f.finishedAt) patch.finishedAt = f.finishedAt;
  } else if (opts.dropped && f.status === 'dropped' && !(cur.status === 'done' && cur.score)) { if (cur.status !== 'dropped') patch.status = 'dropped'; }
  if (f.srcRating && (!cur.srcRating || (cur.src === f.src && cur.srcRating !== f.srcRating)) && (cur.auto || !cur.score)) { patch.srcRating = f.srcRating; patch.srcScale = f.srcScale || 10; if (!cur.srcRating) patch.src = cur.src === 'manual' || cur.src === 'dump' ? f.src : cur.src; }
  if (!cur.total && f.total) patch.total = f.total; if (!cur.creator && f.creator) patch.creator = f.creator;
  if (!cur.extId && f.extId) { patch.extId = String(f.extId); if (!patch.src && (cur.src === 'manual' || cur.src === 'dump')) patch.src = f.src; }
  if (!cur.cover && f.cover) patch.cover = safeUrl(f.cover) || undefined;
  if (!cur.genres?.length && f.genres?.length) patch.genres = f.genres; if (!cur.finishedAt && f.finishedAt && (f.status === 'done' || cur.status === 'done')) patch.finishedAt = f.finishedAt;
  if (!cur.startedAt && f.startedAt) patch.startedAt = f.startedAt; if (!cur.year && f.year) patch.year = f.year;
  if (f.minutes && f.minutes > (cur.minutes || 0)) patch.minutes = f.minutes;
  if (!cur.runtime && f.runtime) patch.runtime = f.runtime; if (!cur.pub && f.pub) patch.pub = f.pub;
  if (!cur.orig && f.orig && norm(f.orig) !== norm(cur.title)) patch.orig = f.orig; if (!cur.en && f.en) patch.en = f.en;
  if (f.ach && (!cur.ach || cur.ach.done !== f.ach.done || cur.ach.total !== f.ach.total)) patch.ach = f.ach;
  const mid = malIdOf(f); if (mid && !cur.malId) patch.malId = mid;
  if (f.progress && f.progress > (cur.progress || 0)) patch.progress = f.progress;
  if (cur.status === 'planned' && f.status && f.status !== 'planned' && !patch.status) patch.status = f.status;
  if (f.review && !cur.review) patch.review = f.review;
  for (const k of Object.keys(patch)) if (patch[k] === undefined || (k !== 'finishedAt' && JSON.stringify(patch[k]) === JSON.stringify(cur[k]))) delete patch[k];
  return patch;
}
/** Bulk import. One pass with an index, so thousands of rows stay fast. Converted scores are recomputed at the end.
 *  → { state, added, updated, skipped } */
export function upsertMany(s, list, opts = {}) {
  const media = { ...(s.media || {}) }, byExt = new Map(), byTitle = new Map(), byMal = new Map(); let added = 0, updated = 0, deleted = s.deleted;
  const ek = (m) => `${m.kind}|${m.src}|${m.extId}`;   // MAL numbers anime and manga separately, so the kind is part of the key
  const index = (m) => { if (m.extId) byExt.set(ek(m), m.id); if (m.malId && !byMal.has(`${m.kind}|${m.malId}`)) byMal.set(`${m.kind}|${m.malId}`, m.id); for (const t of [m.title, m.orig, m.en]) if (t) { const k = `${m.kind}|${norm(t)}`; (byTitle.get(k) || byTitle.set(k, []).get(k)).push(m.id); } };
  for (const m of Object.values(media)) index(m);
  for (const f of list) {
    const nt = norm(f.title), mk = malIdOf(f) ? `${f.kind}|${malIdOf(f)}` : '';
    let cur = f.extId && byExt.has(ek(f)) ? media[byExt.get(ek(f))] : null;
    if (!cur && mk && byMal.has(mk)) cur = media[byMal.get(mk)] || null;
    if (!cur) for (const t of [f.title, f.orig, f.en].filter(Boolean)) { for (const id of byTitle.get(`${f.kind}|${norm(t)}`) || []) { const m = media[id]; if (m && sameWork(m, { ...f, title: t }, norm(t))) { cur = m; break; } } if (cur) break; }
    if (!cur) { const n = makeRecord(f); if (n) { media[n.id] = n; index(n); added++; } continue; }
    // the same work imported earlier from AniList (found only now that both carry the MAL id): fold it in, so it counts once
    const twinId = mk && byMal.get(mk), twin = twinId && twinId !== cur.id ? media[twinId] : null;
    if (twin) { const r = foldTwin(cur, twin); delete media[twin.id]; deleted = { ...(deleted || {}), [`media:${twin.id}`]: Date.now() }; media[cur.id] = cur = r; byMal.set(mk, cur.id); if (twin.extId) byExt.set(ek(twin), cur.id); }
    const patch = importPatch(cur, f, opts); if (!Object.keys(patch).length) { if (twin) { index(cur); updated++; } continue; }
    media[cur.id] = applyPatch(cur, patch); index(media[cur.id]); updated++;
  }
  const conv = convertAll({ ...s, media });
  return { state: { ...s, media: conv.state.media, ...(deleted !== s.deleted ? { deleted } : {}) }, added, updated, skipped: list.length - added - updated, sites: conv.sites };
}
export function upsertMedia(s, f, opts = {}) { const r = upsertMany(s, [f], opts); return { state: r.state, added: r.added, updated: r.updated }; }
/** Keep `a`, fill what it lacks from its twin `b` (your score, dates, review, progress, log). */
function foldTwin(a, b) {
  const n = { ...a, at: Date.now() };
  for (const k of ['finishedAt', 'startedAt', 'review', 'total', 'cover', 'creator', 'year']) if (!n[k] && b[k]) n[k] = b[k];
  if ((!n.score || n.auto) && b.score && !b.auto) { n.score = b.score; n.auto = false; } else if (!n.srcRating && b.srcRating) { n.srcRating = b.srcRating; n.srcScale = b.srcScale; }
  if (!n.genres?.length && b.genres?.length) n.genres = b.genres;
  if ((b.progress || 0) > (n.progress || 0)) n.progress = b.progress;
  if (n.status === 'planned' && b.status !== 'planned') n.status = b.status;
  if (!n.malId) n.malId = b.malId; if (!n.orig && norm(b.title) !== norm(n.title)) n.orig = b.title;
  if (b.log?.length) n.log = [...(n.log || []), ...b.log].sort((x, y) => x.d.localeCompare(y.d)).slice(-500);
  if (b.plays?.length) n.plays = [...(n.plays || []), ...b.plays].sort((x, y) => x.d.localeCompare(y.d)).slice(-50);
  if (b.quotes?.length) n.quotes = [...(n.quotes || []), ...b.quotes].slice(-100);
  n.createdAt = Math.min(a.createdAt || Infinity, b.createdAt || Infinity) || a.createdAt;
  return n;
}

// ───────────────────────────── the shelf: progress, finishing, again, "still on this?"
/** Minutes one unit of progress takes (an episode, a chapter, a page, an hour of play). */
export function perUnit(m) { const k = kindOf(m.kind); if (m.kind === 'album') return m.runtime && m.total ? Math.max(1, Math.round(m.runtime / m.total)) : k.per; if (m.kind === 'show' || m.kind === 'anime') return m.runtime && m.runtime < 120 ? m.runtime : k.per; if (m.kind === 'movie') return m.runtime || k.per; return k.per; }
/** Move progress on: +n units (episodes, chapters, pages, hours) or to `to`. Logged for the week counts.
 *  Reaching the total finishes it (except games: playing more never "finishes" a game). → { state, finished } */
export function logProgress(s, id, { n = 0, to = null, minutes = null, date = '' } = {}) {
  const m = s.media?.[id]; if (!m) return { state: s, finished: false };
  const before = m.progress || 0; let add = Math.round((+n || 0) * 10) / 10; if (to != null && to !== '') add = Math.round((+to - before) * 10) / 10;
  const mins = minutes != null ? Math.max(0, Math.min(1440, Math.round(+minutes || 0))) : Math.round(Math.max(0, add) * perUnit(m));
  if (!add && !mins) return { state: s, finished: false };
  const progress = Math.max(0, m.total && m.kind !== 'game' ? Math.min(m.total, before + add) : before + add);
  const finished = m.kind !== 'game' && !!m.total && progress >= m.total && before < m.total;
  const log = [...(m.log || []), { d: date || today(), n: add, m: mins }].slice(-500);
  const patch = { log, progress, ...(m.kind === 'game' ? { minutes: (m.minutes || 0) + (minutes != null ? mins : Math.round(add * 60)) } : {}) };
  if (!finished && m.status !== 'doing') patch.status = 'doing';
  return { state: updateMedia(s, id, patch), finished };
}
/** Put a title on the shelf ("currently on"). */
export const start = (s, id) => updateMedia(s, id, { status: 'doing', startedAt: s.media?.[id]?.startedAt || today(), nudged: '' });
/** Finish: date (today), score, flags, note. The start date is kept, so you can see how long it took. */
export function finish(s, id, { date = '', score, flags, review } = {}) {
  const m = s.media?.[id]; if (!m) return s;
  const patch = { status: 'done', finishedAt: date || today() };
  if (score !== undefined) patch.score = score; if (flags) patch.flags = flags; if (review !== undefined) patch.review = String(review).slice(0, 2000);
  if (m.total && m.kind !== 'game') patch.progress = m.total;
  return updateMedia(s, id, patch);
}
/** Watch / read / play it again: the earlier finish is kept in `plays` (date and score), and it goes back on the shelf. */
export function again(s, id) {
  const m = s.media?.[id]; if (!m || m.status !== 'done') return s;
  const plays = [...(m.plays || []), { d: m.finishedAt || '', score: m.score || 0 }].slice(-50);
  return updateMedia(s, id, { plays, status: 'doing', progress: 0, finishedAt: '', startedAt: today() });
}
/** Every finish of a record: earlier plays and the current one. [{d, score, again}] */
export const finishesOf = (m) => [...(m.plays || []).map((p, i) => ({ d: p.d || '', score: p.score || 0, again: i > 0 })), ...(m.status === 'done' ? [{ d: m.finishedAt || '', score: m.score || 0, again: (m.plays || []).length > 0 }] : [])];
/** The last day anything happened on a record. */
export const lastActivity = (m) => [m.startedAt || '', m.nudged || '', ...(m.log || []).map(x => x.d)].sort().pop() || (m.createdAt ? keyOf(new Date(m.createdAt)) : '');
export const STALE_DAYS = { game: 45, book: 30, manga: 30, anime: 21, show: 30, movie: 7, album: 14 };
/** On the shelf but untouched for a long while: a gentle "still on this?" (never a nag: once per stretch). */
export function stale(s, now = new Date()) {
  const t = keyOf(now);
  return rec(s.media).filter(m => m.status === 'doing').map(m => ({ m, last: lastActivity(m) })).filter(({ m, last }) => last && Math.round((fromKey(t) - fromKey(last)) / 86400000) >= (STALE_DAYS[m.kind] || 30))
    .sort((a, b) => a.last.localeCompare(b.last)).map(({ m, last }) => ({ ...m, idle: Math.round((fromKey(t) - fromKey(last)) / 86400000) }));
}
/** "Still on it": the nudge waits for another stretch. */
export const stillOn = (s, id) => updateMedia(s, id, { nudged: today() });
export const nowPlaying = (s) => rec(s.media).filter(m => m.status === 'doing').sort((a, b) => (lastActivity(b).localeCompare(lastActivity(a))) || b.at - a.at);

// ───────────────────────────── the backlog
/** Your backlog: planned, not marked "not for me". triage '' = still to sort (Steam's low-playtime pile, the brain dump). */
export const backlog = (s, kinds = null) => rec(s.media).filter(m => m.status === 'planned' && m.triage !== 'no' && (!kinds || kinds.includes(m.kind)));
export const toTriage = (s) => rec(s.media).filter(m => m.status === 'planned' && m.src === 'steam' && !m.triage).sort((a, b) => (b.minutes || 0) - (a.minutes || 0) || a.title.localeCompare(b.title));
export const triage = (s, id, t) => updateMedia(s, id, { triage: t });
const KIND_WORDS = { anime: /^(anime|🍥)$/i, show: /^(series|show|tv|📺)$/i, movie: /^(film|movie|🎬)$/i, manga: /^(manga|comic|comics|manhwa|🗯)$/i, book: /^(book|novel|📚)$/i, game: /^(game|🎮)$/i, album: /^(album|music|lp|ep|record|vinyl|💿|🎵|🎶)$/i };
const kindWord = (w) => Object.entries(KIND_WORDS).find(([, re]) => re.test(String(w).trim()))?.[0] || '';
/** The brain dump: one title per line, any kind. "Dune (book)", "film: Perfect Days", "🎮 Hades", "Frieren [anime]",
 *  "The Bear - series", "Piranesi by Susanna Clarke", "Alien (1979)". Lines without a kind take `fallback`. → [{kind, title, creator, year, guessed}] */
export function parseDump(text, fallback = 'movie') {
  const out = [], seen = new Set();
  for (let raw of String(text || '').split(/\r?\n/)) {
    let line = raw.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim(); if (!line) continue;
    let kind = '', creator = '', year = 0, m;
    if ((m = /^(\S+?)\s*[:：]\s*(.+)$/.exec(line)) && kindWord(m[1])) { kind = kindWord(m[1]); line = m[2]; }
    else if ((m = /^(\p{Extended_Pictographic}️?)\s*(.+)$/u.exec(line)) && kindWord(m[1])) { kind = kindWord(m[1]); line = m[2]; }
    if ((m = /^(.+?)\s*[([]\s*([^)\]]+?)\s*[)\]]\s*$/.exec(line)) && kindWord(m[2])) { kind ||= kindWord(m[2]); line = m[1]; }
    if ((m = /^(.+?)\s+[-–—]\s+(\S+)\s*$/.exec(line)) && kindWord(m[2])) { kind ||= kindWord(m[2]); line = m[1]; }
    if ((m = /^(.+?)\s*\((\d{4})\)\s*$/.exec(line))) { year = +m[2]; line = m[1]; }
    if ((m = /^(.+?)\s+by\s+(.+)$/i.exec(line))) { creator = m[2].trim(); line = m[1]; kind ||= 'book'; }
    const title = line.replace(/\s+/g, ' ').trim().slice(0, 160); if (!title) continue;
    const k = kind || fallback, key = `${k}|${norm(title)}`; if (seen.has(key)) continue; seen.add(key);
    out.push({ kind: k, title, creator, year, guessed: !kind });
  }
  return out.slice(0, 300);
}
/** Add the dumped titles to the backlog; ones already in the library are left alone. → { state, added, already[] } */
export function addDump(s, items) {
  const fresh = [], already = [];
  for (const it of items) { const m = findMedia(s, it); if (m) already.push(m); else fresh.push({ ...it, status: 'planned', src: 'dump', triage: 'want' }); }
  const r = upsertMany(s, fresh);
  return { state: r.state, added: r.added, already };
}

// ───────────────────────────── time: what a record (or a stretch of days) took
/** Minutes spent on a record overall (estimates: an episode, a page, a film's runtime; games: playtime). */
export function minutesOf(m) {
  const k = m.kind, fin = finishesOf(m).length;
  if (k === 'game') return m.minutes || Math.round((m.progress || 0) * 60);
  if (k === 'movie') return (m.runtime || kindOf(k).per) * Math.max(1, fin) * (m.status === 'done' || fin ? 1 : 0);
  if (k === 'album' && !(m.log || []).length) return (m.runtime || (m.total || 10) * kindOf(k).per) * fin;
  const logged = (m.log || []).reduce((a, x) => a + (x.m || 0), 0);
  if (logged) return logged;
  const units = (m.status === 'done' ? (m.total || m.progress || 0) : (m.progress || 0)) + (m.plays || []).length * (m.total || 0);
  return Math.round(units * perUnit(m));
}
/** What happened between two day keys (inclusive): episodes, chapters, pages, hours from the log; films, books and the rest
 *  finished. → { eps, ch, pages, films, books, games, finished[], minutes, hours, byKind, days:Set } */
export function between(s, from, to) {
  const out = { eps: 0, ch: 0, pages: 0, films: 0, books: 0, games: 0, shows: 0, anime: 0, manga: 0, albums: 0, tracks: 0, finished: [], minutes: 0, hours: 0, byKind: Object.fromEntries(KINDS.map(k => [k.id, 0])), days: new Set(), gameMinutes: 0 };
  for (const m of rec(s.media)) {
    for (const x of m.log || []) {
      if (!x.d || x.d < from || x.d > to) continue;
      const n = +x.n || 0; out.days.add(x.d); out.minutes += +x.m || 0;
      if (m.kind === 'show' || m.kind === 'anime') out.eps += Math.max(0, n); else if (m.kind === 'manga') out.ch += Math.max(0, n); else if (m.kind === 'book') out.pages += Math.max(0, n); else if (m.kind === 'game') out.gameMinutes += +x.m || 0; else if (m.kind === 'album') out.tracks += Math.max(0, n);
    }
    for (const f of finishesOf(m)) {
      if (!f.d || f.d < from || f.d > to) continue;
      out.finished.push({ ...m, finishedOn: f.d, finishScore: f.score, again: f.again }); out.byKind[m.kind]++; out.days.add(f.d);
      if (m.kind === 'movie') { out.films++; out.minutes += m.runtime || kindOf('movie').per; }
      else if (m.kind === 'book') out.books++; else if (m.kind === 'game') out.games++; else if (m.kind === 'show') out.shows++; else if (m.kind === 'anime') out.anime++; else if (m.kind === 'album') { out.albums++; out.minutes += m.runtime || (m.total || 10) * kindOf('album').per; } else out.manga++;
    }
  }
  out.hours = Math.round(out.minutes / 6) / 10;
  out.finished.sort((a, b) => b.finishedOn.localeCompare(a.finishedOn) || (b.finishScore || 0) - (a.finishScore || 0));
  return out;
}
/** Sunday on or before `d` (the family's week starts on Sunday). */
export const weekStart = (d) => addDays(startOfDay(d), -d.getDay());
export const thisWeek = (s, now = new Date()) => between(s, keyOf(weekStart(now)), keyOf(now));
export const thisMonth = (s, now = new Date()) => between(s, `${keyOf(now).slice(0, 7)}-01`, keyOf(now));
/** "3 eps · 1 film · 6h played" (nothing → ''). */
export function countLine(w) {
  const p = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`, bits = [];
  if (w.eps) bits.push(p(w.eps, 'ep')); if (w.films) bits.push(p(w.films, 'film')); if (w.books) bits.push(p(w.books, 'book')); if (w.ch) bits.push(`${w.ch} ch`);
  if (w.pages && !w.books) bits.push(`${w.pages} pages`); if (w.albums) bits.push(p(w.albums, 'album')); if (w.games) bits.push(p(w.games, 'game') + ' done');
  const gh = Math.round(w.gameMinutes / 6) / 10; if (gh >= 0.5) bits.push(`${gh % 1 ? gh.toFixed(1) : gh}h played`);
  return bits.join(' · ');
}

// ───────────────────────────── goals for the year (Sudachi's own reading/watching targets; a goal can link to a Citrus aim)
export function setMeta(s, patch) { return { ...s, meta: { ...(s.meta || {}), ...patch } }; }
export function setGoal(s, kind, n, aimId) { const g = { ...(s.meta?.goals || {}) }; g[kind] = Math.max(0, Math.min(5000, +n || 0)); const aims = { ...(s.meta?.goalAims || {}) }; if (aimId !== undefined) { if (aimId) aims[kind] = aimId; else delete aims[kind]; } return setMeta(s, { goals: g, goalAims: aims }); }
export function goalsProgress(s, now = new Date()) {
  const y = String(now.getFullYear()), g = s.meta?.goals || {}, done = between(s, `${y}-01-01`, `${y}-12-31`), doy = Math.floor((startOfDay(now) - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const count = { book: done.books, movie: done.films, game: done.games, anime: done.anime, show: done.shows, manga: done.manga, album: done.albums, all: done.finished.length };
  return Object.entries(g).filter(([, n]) => n > 0).map(([k, target]) => ({ kind: k, target, done: count[k] || 0, expected: Math.round(target * doy / 365 * 10) / 10, aimId: s.meta?.goalAims?.[k] || '' }));
}

// ───────────────────────────── CSV (Goodreads / IMDb exports), MyAnimeList XML or list JSON, Steam
export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false; const t = String(text).replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; } else cur += c;
  }
  row.push(cur); if (row.some(x => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(x => x.trim()); return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const dateKeyOf = (v) => { const m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(v || ''); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : ''; };
const unExcel = (v) => String(v || '').replace(/^="?|"$/g, '');
const DE_GENRE = { Krimi: 'Crime', Kriegsfilm: 'War', Familienfilm: 'Family', Abenteuer: 'Adventure', Komödie: 'Comedy', Liebesfilm: 'Romance', Dokumentarfilm: 'Documentary', Biografie: 'Biography', Geschichte: 'History', Historienfilm: 'History', Musikfilm: 'Music', Sportfilm: 'Sport', Zeichentrick: 'Animation', Kurzfilm: 'Short', Nachrichten: 'News', Talkshow: 'Talk-Show' };
const MAL_ST = { completed: 'done', watching: 'doing', reading: 'doing', 'on-hold': 'paused', dropped: 'dropped', 'plan to watch': 'planned', 'plan to read': 'planned', 1: 'doing', 2: 'done', 3: 'paused', 4: 'dropped', 6: 'planned' };
/** MyAnimeList export (animelist / mangalist XML). */
export function parseMAL(text) {
  const t = String(text || ''), blocks = [...t.matchAll(/<(anime|manga)>([\s\S]*?)<\/\1>/g)];
  const tag = (x, n) => { const r = new RegExp(`<${n}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${n}>`, 'i').exec(x); return r ? r[1].trim() : ''; };
  const date = (v) => /^\d{4}-\d\d-\d\d$/.test(v) && !v.startsWith('0000') && !/-00/.test(v) ? v : '';
  const items = blocks.map(([, kindTag, body]) => { const manga = kindTag === 'manga', id = tag(body, manga ? 'manga_mangadb_id' : 'series_animedb_id'), title = tag(body, manga ? 'manga_title' : 'series_title'); if (!title) return null;
    const status = MAL_ST[tag(body, 'my_status').toLowerCase()] || 'planned', score = Math.min(10, +tag(body, 'my_score') || 0);
    return { kind: manga ? 'manga' : 'anime', title, orig: title, total: +(manga ? tag(body, 'manga_chapters') || tag(body, 'manga_volumes') : tag(body, 'series_episodes')) || 0, progress: +(manga ? tag(body, 'my_read_chapters') : tag(body, 'my_watched_episodes')) || 0,
      status, srcRating: score, srcScale: 10, finishedAt: status === 'done' ? date(tag(body, 'my_finish_date')) : '', startedAt: date(tag(body, 'my_start_date')), review: tag(body, 'my_comments').replace(/^<!\[CDATA\[|\]\]>$/g, '').slice(0, 800), genres: [], src: 'mal', extId: id, malId: id }; }).filter(Boolean);
  return items.length ? { source: 'MyAnimeList', items } : { error: 'No anime or manga entries found in that file.' };
}
/** A MAL list date as the list JSON gives it ("11-02-26", "2026-11-02", "02-11-2026"): day-first when the first part is over 12. */
export function malDate(v) {
  const t = String(v || '').trim(); if (!t || /^0+[-/]0+/.test(t)) return '';
  let m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(t); if (m) return m[2] === '00' || m[3] === '00' ? '' : t;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t); if (!m) return '';
  let [a, b, y] = [+m[1], +m[2], +m[3]]; if (y < 100) y += y > 70 ? 1900 : 2000;
  const [mo, d] = a > 12 ? [b, a] : [a, b]; if (!mo || !d || mo > 12 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** MyAnimeList's public list JSON (what the relay brings back: animelist/<user>/load.json and mangalist). */
export function parseMALList({ anime = [], manga = [] } = {}) {
  const items = [];
  for (const a of Array.isArray(anime) ? anime : []) { const t = String(a.anime_title || '').trim(); if (!t) continue; const st = MAL_ST[a.status] || 'planned', en = String(a.anime_title_eng || '').trim();
    items.push({ kind: 'anime', title: composeTitle(t, en), orig: t, en: en && norm(en) !== norm(t) ? en : '', total: +a.anime_num_episodes || 0, progress: +a.num_watched_episodes || 0, status: st, srcRating: Math.min(10, +a.score || 0), srcScale: 10,
      finishedAt: st === 'done' ? malDate(a.finish_date_string) : '', startedAt: malDate(a.start_date_string), genres: (a.genres || []).map(g => g?.name).filter(Boolean).slice(0, 6), cover: a.anime_image_path || '', src: 'mal', extId: String(a.anime_id || ''), malId: String(a.anime_id || ''), review: String(a.tags || '').slice(0, 200) }); }
  for (const a of Array.isArray(manga) ? manga : []) { const t = String(a.manga_title || '').trim(); if (!t) continue; const st = MAL_ST[a.status] || 'planned', en = String(a.manga_english || '').trim();
    items.push({ kind: 'manga', title: composeTitle(t, en), orig: t, en: en && norm(en) !== norm(t) ? en : '', total: +a.manga_num_chapters || 0, progress: +a.num_read_chapters || 0, status: st, srcRating: Math.min(10, +a.score || 0), srcScale: 10,
      finishedAt: st === 'done' ? malDate(a.finish_date_string) : '', startedAt: malDate(a.start_date_string), genres: (a.genres || []).map(g => g?.name).filter(Boolean).slice(0, 6), cover: a.manga_image_path || '', src: 'mal', extId: String(a.manga_id || ''), malId: String(a.manga_id || '') }); }
  return items.length ? { source: 'MyAnimeList', items } : { error: 'MyAnimeList sent back an empty list. Is the list public (MAL › Settings › Privacy)?' };
}
/** Detects which export it is by its contents. → {source, items} or {error}. mode (IMDb): 'auto' | 'done' (rated) | 'planned' (watchlist) | 'dropped'. */
export function parseExport(text, { mode = 'auto' } = {}) {
  const head = String(text).slice(0, 4000);
  if (/<myanimelist>|<series_animedb_id>|<manga_mangadb_id>/i.test(head)) return parseMAL(text);
  if (/<gamesList>|<steamID64>/i.test(head)) return parseSteam(text);
  if (/^\s*[[{]/.test(head)) { try { const j = JSON.parse(text); if (j?.response?.games || j?.steam) return parseSteam(text); if (Array.isArray(j) && j[0]?.anime_title) return parseMALList({ anime: j }); if (Array.isArray(j) && j[0]?.manga_title) return parseMALList({ manga: j }); if (j?.mal) return parseMALList(j.mal); } catch {} }
  const rows = parseCSV(text); if (!rows.length) return { error: 'That file has no rows.' };
  const cols = Object.keys(rows[0]);
  if (cols.includes('RYM Album') && cols.includes('Title')) {   // RateYourMusic › your profile › Export your data (ratings are 1–10, half stars ×2)
    const items = rows.filter(r => r.Title).map(r => { const artist = [r['First Name'], r['Last Name']].filter(Boolean).join(' ').trim(), rated = +r.Rating || 0, y = +String(r.Release_Date || '').slice(0, 4) || 0;
      return { kind: 'album', title: r.Title.trim(), creator: artist.slice(0, 100), year: y, status: rated ? 'done' : 'planned', srcRating: rated, srcScale: 10, review: r.Review || '', src: 'rym', extId: String(r['RYM Album'] || '') }; });
    return { source: 'RateYourMusic', items };
  }
  if (cols.includes('Exclusive Shelf') && cols.includes('Title')) {
    const items = rows.filter(r => r.Title).map(r => {
      const shelf = r['Exclusive Shelf'], stars = +r['My Rating'] || 0, isbn = unExcel(r.ISBN13 || r.ISBN);
      return { kind: 'book', title: r.Title.replace(/\s*\([^)]*#\d+[^)]*\)\s*$/, ''), creator: r.Author, year: +r['Original Publication Year'] || +r['Year Published'] || 0, total: +r['Number of Pages'] || 0,
        genres: (r.Bookshelves || '').split(',').map(x => x.trim()).filter(x => x && !/^(to-read|read|currently-reading)$/.test(x)).slice(0, 8), status: shelf === 'read' ? 'done' : shelf === 'currently-reading' ? 'doing' : shelf === 'did-not-finish' || /^(dnf|abandoned)$/i.test(shelf) ? 'dropped' : 'planned',
        srcRating: stars, srcScale: 5, finishedAt: dateKeyOf(r['Date Read']), review: r['My Review'] || '', src: 'goodreads', extId: r['Book Id'] || isbn, plays: +r['Read Count'] > 1 ? Array.from({ length: Math.min(10, +r['Read Count'] - 1) }, () => ({ d: '', score: 0 })) : [] };
    });
    return { source: 'Goodreads', items };
  }
  if (cols.includes('Const') && cols.includes('Title Type')) {
    const items = rows.filter(r => r.Title && !/episode|video ?game|videospiel|podcast/i.test(r['Title Type'])).map(r => {
      const rated = +r['Your Rating'] || 0, type = r['Title Type'], status = mode === 'planned' ? 'planned' : mode === 'dropped' ? 'dropped' : mode === 'done' ? 'done' : rated ? 'done' : 'planned';
      const orig = (r['Original Title'] || r.Title || '').trim(), en = (r.Title || '').trim();
      return { kind: /serie|mini/i.test(type) ? 'show' : 'movie', title: orig, orig, en: en && norm(en) !== norm(orig) ? en : '', creator: r.Directors || r.Creators || '', year: +r.Year || 0, genres: (r.Genres || '').split(',').map(x => x.trim()).filter(Boolean).map(g => DE_GENRE[g] || g),
        status, srcRating: rated, srcScale: 10, finishedAt: status === 'done' ? dateKeyOf(r['Date Rated']) : '', droppedAt: status === 'dropped' ? dateKeyOf(r['Date Rated'] || r.Created) : '', src: 'imdb', extId: r.Const, runtime: +r['Runtime (mins)'] || 0, pub: +r['IMDb Rating'] || 0 };
    });
    return { source: 'IMDb', items };
  }
  return { error: 'Not recognised. Use the Goodreads library export, an IMDb ratings / watchlist / list export, a RateYourMusic export, a MyAnimeList export (.xml or .xml.gz) or a Steam games list.' };
}
const steamCover = (id) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
/** One owned game → a record. Steam says what you own and how long you played, not whether you finished:
 *  played in the last 2 weeks → on the shelf; under 2 h → the backlog pile to sort; more → On hold ("played a while"). */
export const LOW_PLAY = 120;
function steamItem(appid, name, minutes, last, recent, ach) {
  const mins = Math.max(0, Math.round(minutes || 0)), d = last ? new Date(last * 1000) : null;
  return { kind: 'game', title: String(name).trim(), minutes: mins, cover: steamCover(appid), src: 'steam', extId: String(appid),
    status: recent ? 'doing' : mins < LOW_PLAY ? 'planned' : 'paused', startedAt: '', lastPlayed: d && !isNaN(d) && last ? keyOf(d) : '', ...(ach ? { ach } : {}) };
}
/** Steam: the relay's JSON ({steam:{games, achievements}}), the Web API's GetOwnedGames JSON, or the community games-list XML. */
export function parseSteam(text) {
  const t = String(text || '').trim(); if (!t) return { error: 'Nothing from Steam yet.' };
  if (t[0] === '<') {
    const items = [], re = /<game>([\s\S]*?)<\/game>/g; let m; const tag = (x, n) => { const r = new RegExp(`<${n}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${n}>`, 'i').exec(x); return r ? r[1].trim() : ''; };
    while ((m = re.exec(t))) { const name = tag(m[1], 'name'), id = tag(m[1], 'appID'); if (!name || !id) continue; items.push(steamItem(id, name, parseFloat(tag(m[1], 'hoursOnRecord').replace(/,/g, '')) * 60 || 0, 0, parseFloat(tag(m[1], 'hoursLast2Weeks')) > 0)); }
    return items.length ? { source: 'Steam', items } : { error: /private|not public/i.test(t) ? 'That profile’s game details are private. Set Game details to Public in Steam › Privacy settings.' : 'No games found in that XML.' };
  }
  let j; try { j = JSON.parse(t); } catch { return { error: 'That is not Steam’s JSON or its games-list XML.' }; }
  if (j?.error) return { error: String(j.error).slice(0, 200) };
  const ach = j?.steam?.achievements || {};
  const games = j?.steam?.games || j?.response?.games; if (!Array.isArray(games)) return { error: j?.response && !Object.keys(j.response).length ? 'Steam returned nothing. Set your Game details to Public in Steam › Privacy.' : 'No games found in that.' };
  return { source: 'Steam', items: games.filter(g => g.name).map(g => steamItem(g.appid, g.name, g.minutes ?? g.playtime_forever, g.last ?? g.rtime_last_played, (g.recent ?? g.playtime_2weeks) > 0, ach[g.appid] ? { done: +ach[g.appid].done || 0, total: +ach[g.appid].total || 0 } : null)) };
}
/** After a Steam sync: time played since the last one becomes a play session today (so "6h played this week" is real).
 *  `last`: appid → minutes at the previous sync (meta.steam.last). → { state, played: [{id, minutes}], last } */
export function steamDeltas(s, items, last = {}, date = '') {
  let st = s; const played = [], next = { ...last };
  for (const it of items) {
    const was = last[it.extId], m = findMedia(st, it); next[it.extId] = it.minutes;
    if (was == null || !m || it.minutes <= was) continue;
    const add = it.minutes - was; st = { ...st, media: { ...st.media, [m.id]: { ...m, log: [...(m.log || []), { d: date || today(), n: Math.round(add / 6) / 10, m: add }].slice(-500), status: m.status === 'planned' || m.status === 'paused' ? 'doing' : m.status, startedAt: m.startedAt || date || today(), at: Date.now() } } };
    played.push({ id: m.id, minutes: add });
  }
  return { state: st, played, last: next };
}
/** What a parsed file will do, in plain words, before anything is saved. */
export function summariseImport(items) {
  const by = (st) => items.filter(i => i.status === st), dated = items.filter(i => i.status === 'done' && i.finishedAt).map(i => i.finishedAt).sort();
  return { n: items.length, done: by('done').length, doing: by('doing').length, planned: by('planned').length, dropped: by('dropped').length, paused: by('paused').length, undated: by('done').filter(i => !i.finishedAt).length, rated: items.filter(i => i.srcRating).length,
    from: dated[0] || '', to: dated[dated.length - 1] || '', kinds: countOf(items.map(i => i.kind)) };
}

// ───────────────────────────── analysis for every kind: stats, taste, ranking, feedback (all offline, from your own scores)
export const splitNames = (x) => String(x || '').split(',').map(v => v.trim()).filter(Boolean);
export const countOf = (arr) => { const o = {}; arr.forEach(k => { if (k) o[k] = (o[k] || 0) + 1; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
export const listOf = (s, kinds) => rec(s.media).filter(m => !kinds || (Array.isArray(kinds) ? kinds : [kinds]).includes(m.kind));
export const yearOf = (m) => (m.finishedAt || '').slice(0, 4);
/** Genres/makers you score highly or poorly, weighted by how far each score is from "meh" (6). */
export function tasteOf(s, kinds) {
  const gen = {}, mk = {}, loved = [];
  for (const m of listOf(s, kinds)) {
    if (m.status !== 'done' || !m.score) continue; const w = (m.score - 6.5) / 3.5; if (w >= 0.4) loved.push(m);
    for (const g of m.genres || []) gen[g] = (gen[g] || 0) + w;
    for (const d of splitNames(m.creator)) mk[d] = (mk[d] || 0) + w;
  }
  const rank = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  return { genres: rank(gen), makers: rank(mk).filter(([, w]) => w >= 1), genreW: gen, makerW: mk, loved: loved.sort((a, b) => b.score - a.score) };
}
/** Your backlog ordered by fit: genres and makers you scored highly, nudged by the public score. */
export function rankPlanned(s, kinds, n = 10) {
  const t = tasteOf(s, kinds), out = [];
  for (const m of backlog(s, kinds ? (Array.isArray(kinds) ? kinds : [kinds]) : null)) {
    const gs = m.genres || [], g = gs.length ? gs.reduce((x, k) => x + (t.genreW[k] || 0), 0) / Math.sqrt(gs.length) : 0;
    const d = splitNames(m.creator).reduce((x, k) => x + Math.max(0, t.makerW[k] || 0), 0), q = m.pub ? (m.pub - 6.5) / 3 : 0, want = m.triage === 'want' ? 0.3 : 0, score = g + d * 0.6 + q + want;
    const topG = gs.filter(k => (t.genreW[k] || 0) > 0).sort((a, b) => t.genreW[b] - t.genreW[a]).slice(0, 2), dd = splitNames(m.creator).find(k => (t.makerW[k] || 0) >= 1);
    out.push({ media: m, score, reason: dd ? `You loved ${dd} before` : topG.length ? `Your kind of thing: ${topG.join(', ')}` : m.pub >= 8 ? 'Very well rated' : m.triage === 'want' ? 'You said you want this' : 'From your backlog' });
  }
  return out.sort((a, b) => b.score - a.score || b.media.at - a.media.at).slice(0, n);
}
/** Everything the stats screen needs for a set of kinds (optionally one finish-year). */
export function statsOf(s, kinds, { year = '' } = {}, now = new Date()) {
  const all = listOf(s, kinds).filter(m => m.status === 'done'), done = year ? all.filter(m => yearOf(m) === String(year)) : all, rated = done.filter(m => m.score);
  const gAvg = {}; rated.forEach(m => (m.genres || []).forEach(g => { (gAvg[g] ||= []).push(m.score); }));
  const genreAvg = Object.entries(gAvg).filter(([, a]) => a.length >= 3).map(([g, a]) => [g, a.reduce((x, y) => x + y, 0) / a.length, a.length]).sort((a, b) => b[1] - a[1]);
  const vs = rated.filter(m => m.pub), gap = vs.length ? vs.reduce((t, m) => t + (m.score - m.pub), 0) / vs.length : null, hot = vs.map(m => ({ m, d: m.score - m.pub })).sort((a, b) => b.d - a.d);
  return { n: done.length, byKind: Object.fromEntries(KINDS.map(k => [k.id, done.filter(m => m.kind === k.id).length])), avg: rated.length ? rated.reduce((t, m) => t + m.score, 0) / rated.length : null, ratedN: rated.length,
    years: countOf(all.map(yearOf)).sort((a, b) => a[0].localeCompare(b[0])), hours: Math.round(done.reduce((t, m) => t + minutesOf(m), 0) / 60),
    genres: countOf(done.flatMap(m => m.genres || [])).slice(0, 10), genreAvg, makers: countOf(done.flatMap(m => splitNames(m.creator))).filter(([, n]) => n > 1).slice(0, 8),
    decades: countOf(done.filter(m => m.year).map(m => `${Math.floor(m.year / 10) * 10}s`)).sort((a, b) => a[0].localeCompare(b[0])), gap, overrated: hot.slice(-3).reverse().filter(x => x.d <= -2).map(x => x.m), underrated: hot.slice(0, 3).filter(x => x.d >= 2).map(x => x.m),
    top: rated.slice().sort((a, b) => b.score - a.score || (b.finishedAt || '').localeCompare(a.finishedAt || '')).slice(0, 8) };
}
/** Plain-language read-outs of your taste: patterns, not just numbers. */
export function feedbackOf(s, kinds, now = new Date()) {
  const st = statsOf(s, kinds, {}, now), out = []; if (st.ratedN < 5) return ['Rate five or more finished things and Sudachi will start telling you what it notices.'];
  const rated = listOf(s, kinds).filter(m => m.status === 'done' && m.score), high = rated.filter(m => m.score >= 8.5).length / rated.length, low = rated.filter(m => m.score <= 6).length / rated.length;
  out.push(high > 0.5 ? `Generous: ${Math.round(high * 100)}% of your scores are A or better. An S from you is rare, keep it that way.` : low > 0.4 ? `Tough crowd: ${Math.round(low * 100)}% of your scores are C or lower.` : `Your tiers are balanced, centred on ${st.avg.toFixed(1)}.`);
  if (st.genreAvg.length > 1) { const hi = st.genreAvg[0], lo = st.genreAvg[st.genreAvg.length - 1]; out.push(`${hi[0]} is where you’re happiest (avg ${hi[1].toFixed(1)} over ${hi[2]}).${hi[1] - lo[1] >= 1 ? ` ${lo[0]} lets you down most (avg ${lo[1].toFixed(1)}).` : ''}`); }
  if (st.genres[0] && st.n > 20 && st.genres[0][1] / st.n > 0.5) out.push(`${Math.round(st.genres[0][1] / st.n * 100)}% of what you finish is ${st.genres[0][0]}. Something far outside it might surprise you.`);
  if (st.gap != null && Math.abs(st.gap) >= 0.4) out.push(st.gap > 0 ? `You score ${st.gap.toFixed(1)} points above the public rating on average.` : `You score ${(-st.gap).toFixed(1)} points below the public rating on average.`);
  const t = tasteOf(s, kinds); if (t.makers.length) out.push(`Names you keep coming back to and loving: ${t.makers.slice(0, 3).map(([n]) => n).join(', ')}.`);
  return out;
}
/** Shelf filter: free text, kinds, status, genre, tier floor, finish year, flags, sort. */
export function filterShelf(list, { q = '', genre = '', min = 0, year = '', sort = 'recent', status = '', flag = '' } = {}) {
  const nq = norm(q); let out = list.filter(m => (!nq || norm(`${m.title} ${m.orig} ${m.en} ${m.creator}`).includes(nq)) && (!genre || (m.genres || []).includes(genre)) && (!min || m.score >= min) && (!year || yearOf(m) === String(year)) && (!status || m.status === status) && (!flag || m.flags?.[flag] === true || (flag === 'recommend' && m.flags?.recommend === 'yes')));
  const by = { recent: (a, b) => (b.finishedAt || lastActivity(b)).localeCompare(a.finishedAt || lastActivity(a)) || b.at - a.at, score: (a, b) => b.score - a.score || (b.finishedAt || '').localeCompare(a.finishedAt || ''), title: (a, b) => shown(a).localeCompare(shown(b)), year: (a, b) => b.year - a.year, added: (a, b) => (b.createdAt || 0) - (a.createdAt || 0), time: (a, b) => minutesOf(b) - minutesOf(a) }[sort];
  return by ? out.slice().sort(by) : out;
}
export const genresOf = (list) => countOf(list.flatMap(m => m.genres || [])).slice(0, 30);
export function addQuote(s, id, { text, page = 0 }) { const b = s.media?.[id], t = String(text || '').trim().slice(0, 600); return b && t ? updateMedia(s, id, { quotes: [...(b.quotes || []), { id: uid(), t, p: +page || 0, d: today() }].slice(-100) }) : s; }
export function removeQuote(s, id, qid) { const b = s.media?.[id]; return b ? updateMedia(s, id, { quotes: (b.quotes || []).filter(q => q.id !== qid) }) : s; }
export function dismissSuggestion(s, key) { return setMeta(s, { dismissed: [...new Set([...(s.meta?.dismissed || []), key])].slice(-400) }); }

// ───────────────────────────── English titles (Wikidata SPARQL: free, no key, CORS) for films imported under their original title
export const needsEnglish = (s) => rec(s.media).filter(m => m.src === 'imdb' && /^tt\d+$/.test(m.extId) && !m.enChecked && !m.en);
export async function fetchEnglishTitles(ids, { batch = 80, onProgress } = {}) {
  const out = new Map(), done = [];
  for (let i = 0; i < ids.length; i += batch) {
    const part = ids.slice(i, i + batch), q = `SELECT ?id ?l WHERE { VALUES ?id { ${part.map(x => `"${x}"`).join(' ')} } ?i wdt:P345 ?id . ?i rdfs:label ?l . FILTER(LANG(?l) = "en") }`;
    const r = await fetch(`https://query.wikidata.org/sparql?format=json&origin=*&query=${encodeURIComponent(q)}`, { headers: { Accept: 'application/sparql-results+json' } });
    if (!r.ok) throw new Error(`Wikidata ${r.status}`);
    const j = await r.json(); for (const b of j.results?.bindings || []) if (!out.has(b.id.value)) out.set(b.id.value, b.l.value);
    done.push(...part); onProgress?.(Math.min(ids.length, i + batch), ids.length);
  }
  return { titles: out, checked: done };
}
/** Writes "Original (English)" onto films whose English title differs from their original one. Looked-up items are marked. */
export function applyEnglish(s, { titles, checked }) {
  const media = { ...s.media }, seen = new Set(checked); let named = 0;
  for (const m of rec(s.media)) {
    if (!seen.has(m.extId) || m.src !== 'imdb') continue; const en = titles.get(m.extId) || '', orig = m.orig || m.title, title = composeTitle(orig, en);
    if (title !== orig) named++; media[m.id] = { ...m, orig, en: title !== orig ? en : '', enChecked: true, title, at: Date.now() };
  }
  return { state: { ...s, media }, named };
}
