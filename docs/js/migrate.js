// Taking over the Library from Citrus (pure). Sudachi reads My Apps/hub/citrus/state.json (or a Citrus backup file) once and
// copies what it now owns: `media` (every title with its status, progress, reading log and quotes), `mediaMeta` (yearly goals,
// dismissed suggestions) and the `media:` tombstones — so something you deleted in Citrus stays deleted. Ratings that came
// from an import (Goodreads, IMDb, MAL, AniList, Steam) become that site's raw rating and are converted to tiers by percentile;
// ratings you gave in Citrus by hand are kept as your own scores. Memos already went to Bergamot. It never writes into
// Citrus's file. Running it twice is harmless: newest edit wins.
import { mergeStates, sanitize } from './store.js';
import { makeRecord } from './media.js';
import { convertAll, cleanScore } from './tiers.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const FROM_IMPORT = new Set(['goodreads', 'imdb', 'mal', 'anilist', 'steam']);
/** One Citrus media record → a Sudachi record (same id, so a second run lands on the same record). */
export function fromCitrus(m) {
  if (!isObj(m) || !(typeof m.title === 'string' || typeof m.title === 'number') || !String(m.title).trim()) return null;
  const r = +m.rating || 0, imported = FROM_IMPORT.has(m.src);
  // Citrus stored Goodreads stars ×2 and AniList scores /10: all on a 10 scale
  const f = { ...m, title: String(m.title), score: imported ? 0 : cleanScore(r), auto: false, srcRating: imported && r ? r : 0, srcScale: 10, log: (Array.isArray(m.log) ? m.log : []).filter(isObj).map(x => ({ d: String(x.d || ''), n: +x.p || 0, m: +x.m || 0 })) };
  const rec = makeRecord(f, +m.at || +m.createdAt || 1);
  if (!rec) return null;
  rec.at = +m.at || +m.createdAt || 1; rec.createdAt = +m.createdAt || rec.at;
  if (m.status === 'done' && !m.finishedAt) rec.finishedAt = '';      // Citrus left undated finishes undated: keep it so
  if (m.kind === 'game' && m.src === 'steam' && m.status === 'planned') rec.triage = '';
  return rec;
}
/** The Library part of a Citrus state, shaped as a Sudachi state. → {part, counts} (part is null when there is nothing to take). */
export function libraryPart(citrus) {
  if (!isObj(citrus)) return { part: null, counts: {} };
  const part = { updatedAt: +citrus.updatedAt || 0, stamps: {}, deleted: {}, settings: {}, media: {}, meta: {} }, counts = {};
  for (const [id, m] of Object.entries(isObj(citrus.media) ? citrus.media : {})) { const r = fromCitrus({ ...m, id }); if (r) { part.media[id] = r; counts[r.kind] = (counts[r.kind] || 0) + 1; counts.titles = (counts.titles || 0) + 1; } }
  for (const [k, t] of Object.entries(isObj(citrus.deleted) ? citrus.deleted : {})) if (k.startsWith('media:') && Number.isFinite(+t)) part.deleted[k] = +t;
  const mm = isObj(citrus.mediaMeta) ? citrus.mediaMeta : {};
  if (isObj(mm.goals)) { const g = {}; for (const [k, n] of Object.entries(mm.goals)) if (+n > 0) g[k] = Math.round(+n); if (Object.keys(g).length) { part.meta.goals = g; counts.goals = Object.keys(g).length; } }
  if (Array.isArray(mm.dismissed)) part.meta.dismissed = mm.dismissed.filter(x => typeof x === 'string').slice(-400);
  return { part: counts.titles ? sanitize(part) : null, counts };
}
/** Merge the Library part into this device's state. Local edits that are newer win; nothing local is lost. Then convert scores. */
export function applyMigration(local, citrus, { source = 'citrus' } = {}) {
  const { part, counts } = libraryPart(citrus);
  if (!part) return { state: local, counts, changed: false };
  const meta = { ...(part.meta || {}), ...(local.meta || {}) };
  const merged = mergeStates(local, { ...local, ...part, meta, stamps: { ...(local.stamps || {}) }, deleted: { ...(local.deleted || {}), ...part.deleted }, updatedAt: Math.max(local.updatedAt || 0, part.updatedAt) });
  merged.meta = meta;
  const conv = convertAll(merged);
  conv.state.migrated = { from: source, at: Date.now(), counts };
  return { state: conv.state, counts, changed: true, sites: conv.sites };
}
const ORDER = [['titles', 'title'], ['book', 'book'], ['movie', 'film'], ['show', 'series', 'series'], ['anime', 'anime', 'anime'], ['manga', 'comic'], ['game', 'game'], ['album', 'album']];
/** "412 titles: 120 books · 200 films · 60 anime" for the confirmation and the toast. */
export function describe(counts) {
  if (!counts?.titles) return 'nothing from the Library';
  const kinds = ORDER.slice(1).filter(([k]) => counts[k]).map(([k, one, many]) => `${counts[k]} ${counts[k] === 1 ? one : many || one + 's'}`);
  return `${counts.titles} title${counts.titles === 1 ? '' : 's'}${kinds.length ? `: ${kinds.join(' · ')}` : ''}`;
}
const CITRUS_ONLY = ['rotas', 'goals', 'plan', 'aims', 'study', 'swaps', 'friends', 'chores', 'resolutions', 'reflections', 'memos', 'mediaMeta'];
/** A backup that is not Sudachi's own: anything without app:"sudachi" that holds a Citrus-only key. */
export function looksLikeCitrus(j) { return isObj(j) && j.app !== 'sudachi' && (j.app === 'citrus' || CITRUS_ONLY.some(k => k in j)); }
