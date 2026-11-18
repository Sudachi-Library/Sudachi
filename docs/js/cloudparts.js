// How the library is laid out on Drive: one small core file (state.json: settings, goals, tombstones, edit times) and the titles
// split over 16 part files (media-00.json … media-15.json) by a hash of each title's id. Logging an episode changes one
// part, so one ~5% file is uploaded instead of the whole library; a sync where another device changed one title downloads one
// part. Every part carries its own revision (appProperties.rev), so a device sees which parts moved from a single folder
// listing. A state.json from before the split (media inside it) is still read, and merges the same way. Pure (no network).

export const PARTS = 16;
export const LAYOUT = 2;                 // 1 = everything in state.json, 2 = core + parts
export const partName = (i) => `media-${String(i).padStart(2, '0')}.json`;
export const isPart = (name) => /^media-\d\d\.json$/.test(name || '');
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
/** Which part a record id lives in (stable forever: never change PARTS without a migration). */
export const partOf = (id) => hash(String(id)) % PARTS;

/** A state → { core, parts: { 'media-00.json': {part, media}, … } } (all 16 parts, empty ones included, so a part emptied by
 *  deletes is written empty rather than left with stale titles). */
export function split(state) {
  const { media = {}, ...rest } = state || {};
  const parts = {};
  for (let i = 0; i < PARTS; i++) parts[partName(i)] = { part: i, layout: LAYOUT, media: {} };
  for (const [id, m] of Object.entries(media)) parts[partName(partOf(id))].media[id] = m;
  return { core: { ...rest, layout: LAYOUT, parts: PARTS }, parts };
}
/** core (may be a legacy state.json with media inside) + any parts read → one state for the merge. Records from parts win over
 *  the same id in a legacy core when newer (they are merged record by record afterwards anyway). */
export function join(core, parts = {}) {
  const media = { ...((core && core.media) || {}) };
  for (const p of Object.values(parts)) if (p && typeof p === 'object' && p.media && typeof p.media === 'object') for (const [id, m] of Object.entries(p.media)) { if (!media[id] || (+m?.at || 0) >= (+media[id]?.at || 0)) media[id] = m; }
  const { layout, parts: _n, ...rest } = core || {};
  return { ...rest, media };
}
