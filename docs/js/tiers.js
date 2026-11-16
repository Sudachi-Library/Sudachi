// The owner's own rating scale (agreed 16/11/2026, to keep developing): one S–F tier scale for every kind of media.
// A score is stored as a number 0–10 in half steps (0 = not rated); the tier is how it is shown. Scores from other sites
// (IMDb /10, MyAnimeList /10, Goodreads /5, Citrus /10) are converted by where each one sits among YOUR OWN ratings on that
// site (its percentile), not by plain arithmetic: most people give 4–5★ on Goodreads, so 4★ is not an 8. Converted scores are
// marked `auto` and are recomputed when more ratings arrive; a score you set yourself is never touched. Pure (no DOM).

/** Highest first. `score` is what a tap on the tier stores; `min` is where the tier starts. */
export const TIERS = [
  { id: 'S', score: 10, min: 9.75, label: 'All-time', means: 'All-time, part of who I am', color: '#ff2e88' },
  { id: 'A+', score: 9, min: 8.75, label: 'Loved it', means: 'Loved it, would push on friends', color: '#ff7a1a' },
  { id: 'A', score: 8.5, min: 8.25, label: 'Loved it', means: 'Loved it', color: '#ffb000' },
  { id: 'B+', score: 8, min: 7.5, label: 'Really good', means: 'Really good', color: '#b8f03c' },
  { id: 'B', score: 7, min: 6.5, label: 'Solid', means: 'Solid', color: '#3cf0c8' },
  { id: 'C', score: 6, min: 5.5, label: 'Fine', means: 'Fine, glad I finished', color: '#5aa9ff' },
  { id: 'D', score: 4.5, min: 3.75, label: 'Not for me', means: 'Didn’t work for me', color: '#a77bff' },
  { id: 'F', score: 2, min: 0.5, label: 'Regret', means: 'Regret', color: '#8a8fa3' },
];
export const tierById = (id) => TIERS.find(t => t.id === id) || null;
/** The tier a score falls in (null when unrated). */
export function tierOf(score) { const x = +score || 0; if (x <= 0) return null; return TIERS.find(t => x >= t.min) || TIERS[TIERS.length - 1]; }
/** "A+" or "" */
export const tierText = (score) => tierOf(score)?.id || '';
/** Clamp to 0–10 in half steps. */
export const cleanScore = (v) => { const x = Math.round((+v || 0) * 2) / 2; return Math.max(0, Math.min(10, x)); };

/** Where each tier starts as a share of your ratings on one site, from the top: top 5% S, next 10% A+, next 15% A, next 20% B+,
 *  next 20% B, next 15% C, next 10% D, bottom 5% F. */
export const BANDS = [['S', 0.95], ['A+', 0.85], ['A', 0.70], ['B+', 0.50], ['B', 0.30], ['C', 0.15], ['D', 0.05], ['F', 0]];
/** Below this many ratings from a site, a percentile means little: convert in proportion instead. */
export const MIN_FOR_PERCENTILE = 8;

/** One site's raw ratings → a function raw → score. `scale`: the site's top (5 for stars, 10, 100). */
export function converter(raws, scale = 10) {
  const vals = raws.map(Number).filter(x => x > 0).sort((a, b) => a - b), n = vals.length;
  const linear = (r) => cleanScore(Math.max(1, Math.min(10, (+r / scale) * 10)));
  if (n < MIN_FOR_PERCENTILE) return { mode: 'linear', n, of: linear };
  const map = new Map();
  for (const v of new Set(vals)) {
    let below = 0, same = 0; for (const x of vals) { if (x < v) below++; else if (x === v) same++; }
    const p = (below + same / 2) / n;                      // mid-rank: everyone with the same raw rating shares one place
    let id = BANDS.find(([, at]) => p >= at)[0];
    // the very top and bottom of the site's own scale keep their meaning however common they are
    if (v >= scale && ['B+', 'B', 'C', 'D', 'F'].includes(id)) id = 'A';
    if (v <= scale * 0.2 && ['S', 'A+', 'A', 'B+'].includes(id)) id = 'D';
    map.set(v, tierById(id).score);
  }
  // keep the order: a higher raw rating never lands in a lower tier than a lower one
  let lo = 0; for (const v of [...map.keys()].sort((a, b) => a - b)) { if (map.get(v) < lo) map.set(v, lo); lo = map.get(v); }
  return { mode: 'percentile', n, of: (r) => map.has(+r) ? map.get(+r) : linear(r) };
}

/** The site a record's raw rating came from (null for your own). */
export const sourceOf = (m) => (m?.srcRating > 0 && m.src && m.src !== 'manual') ? m.src : null;
/** Recompute every converted score from your ratings per site. Your own scores (not `auto`) are never changed.
 *  → { state, changed, sites: {src: {mode, n}} } */
export function convertAll(s, now = Date.now()) {
  const by = {}; for (const m of Object.values(s.media || {})) { const src = sourceOf(m); if (src) (by[src] ||= []).push(m); }
  const media = { ...(s.media || {}) }, sites = {}; let changed = 0;
  for (const [src, list] of Object.entries(by)) {
    const scale = Math.max(...list.map(m => +m.srcScale || 10)), c = converter(list.map(m => m.srcRating), scale); sites[src] = { mode: c.mode, n: c.n };
    for (const m of list) {
      if (m.score > 0 && !m.auto) continue;
      const sc = c.of(m.srcRating); if (sc === m.score && m.auto) continue;
      media[m.id] = { ...m, score: sc, auto: true, at: now }; changed++;
    }
  }
  return { state: changed ? { ...s, media } : s, changed, sites };
}
/** How many of your scores sit in each tier (for the scale screen and the reviews). */
export function spread(list) { const out = Object.fromEntries(TIERS.map(t => [t.id, 0])); for (const m of list) { const t = tierOf(m.score); if (t) out[t.id]++; } return out; }
