// Checks a backup / restored state before it replaces this device's copy. Pure (no DOM, no storage).
// A file that parses as JSON can still blank every tab: `{"media":{"x":"no"}}` is valid JSON but not a title.
// The rules mirror store.js sanitize() and go one level deeper, so whatever survives here also survives a reload.

// collections that are maps id → record
const MAPS = ['media', 'deleted', 'stamps'];
const NAME = { media: 'title' };
const OWN = new Set([...MAPS, 'app', 'version', 'updatedAt', 'settings', 'meta', 'migrated', 'outbox', 'google']);
const SCALAR_MAPS = new Set(['deleted', 'stamps']);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * json: the parsed file. → { ok, error, state (cleaned copy), dropped: [what was left out], summary: { savedAt, counts: {..} } }
 * ok is false (and state null) only when nothing usable is in it; otherwise bad records are dropped and listed.
 */
export function checkBackup(json) {
  if (!isObj(json)) return { ok: false, error: 'This is not a Sudachi backup (no data in it).', state: null, dropped: [], summary: null };
  if (json.app && json.app !== 'sudachi') return { ok: false, error: `This is a backup of ${String(json.app).slice(0, 20)}, not Sudachi. To bring the Library over from Citrus, use Settings › Backup and data › Bring the Library over.`, state: null, dropped: [], summary: null };
  if (!isObj(json.media)) return { ok: false, error: 'This is not a Sudachi backup: it has no library in it.', state: null, dropped: [], summary: null };
  const s = JSON.parse(JSON.stringify(json)), dropped = [];
  for (const k of MAPS) {
    if (!(k in s)) continue;
    if (!isObj(s[k])) { dropped.push(`${k} (not a list)`); delete s[k]; continue; }
    if (SCALAR_MAPS.has(k)) continue;
    let bad = 0; for (const [id, v] of Object.entries(s[k])) if (!isObj(v) || (NAME[k] && typeof v[NAME[k]] !== 'string')) { delete s[k][id]; bad++; }
    if (bad) dropped.push(`${bad} unreadable ${k} entr${bad > 1 ? 'ies' : 'y'}`);
  }
  if ('outbox' in s && !Array.isArray(s.outbox)) delete s.outbox;
  // only what Sudachi owns comes in: rotas, goals, journal and the rest stay with their own app
  const foreign = Object.keys(s).filter(k => !OWN.has(k)); for (const k of foreign) delete s[k];
  if (foreign.length) dropped.push(`not Sudachi's: ${foreign.slice(0, 6).join(', ')}${foreign.length > 6 ? '…' : ''}`);
  for (const k of ['settings', 'meta', 'google']) if (k in s && !isObj(s[k])) { delete s[k]; dropped.push(`${k} (unreadable)`); }
  const n = (k) => isObj(s[k]) ? Object.keys(s[k]).length : 0;
  const vals = isObj(s.media) ? Object.values(s.media) : [], k = (f) => vals.filter(f).length;
  const counts = { titles: vals.length, finished: k(m => m.status === 'done'), 'on the shelf': k(m => m.status === 'doing'), 'in the backlog': k(m => m.status === 'planned') };
  return { ok: true, error: '', state: s, dropped, summary: { savedAt: +s.updatedAt || 0, counts } };
}

/** One line for the preview: "120 titles · 80 finished" (zeros left out). */
export const describeCounts = (c) => Object.entries(c || {}).filter(([, v]) => v).map(([k, v]) => `${v} ${v === 1 ? k.replace(/ies$/, 'y').replace(/s$/, '') : k}`).join(' · ') || 'nothing but settings';
