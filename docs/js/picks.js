// What's next, planned around your shifts (Mandarin's shifts.json through day.js): a short comfort episode after a night,
// episode-sized picks on 12-hour days, a film or a long session on days off. Candidates are what you are on (continue),
// your backlog ranked by taste, and comfort rewatches. Game length (hours, when known) is respected: a 60-hour game is never
// started before a night stretch. Pure (no DOM).
import * as M from './media.js';
import * as D from './day.js';
import { keyOf, addDays, fmtDur } from './util.js';
import { tierText } from './tiers.js';

/** How much time a kind of day leaves for media, and what fits. */
export const BUDGET = {
  postnight: { min: 35, size: 'short', why: 'After a night: something short and easy', comfort: 1.2 },
  night: { min: 40, size: 'short', why: 'Between nights: an episode before you rest', comfort: 0.8 },
  'first-night': { min: 45, size: 'short', why: 'Night shift ahead: an episode, then rest', comfort: 0.4 },
  day: { min: 45, size: 'episode', why: 'Long day: an episode-sized pick', comfort: 0.5 },
  evening: { min: 40, size: 'episode', why: 'Evening shift: something before you go', comfort: 0.3 },
  off: { min: 180, size: 'long', why: 'Day off: time for a film or a long session', comfort: 0 },
  leave: { min: 240, size: 'long', why: 'On leave: start something big', comfort: 0 },
  unknown: { min: 90, size: 'any', why: 'Something that fits tonight', comfort: 0 },
};
/** Today's kind of day (and the run it belongs to): 12-hour day shifts in a row count as a run. */
export function dayFor(date) {
  let k; try { k = D.dayKind(date); } catch { k = { kind: 'unknown' }; }
  const b = BUDGET[k.kind] || BUDGET.unknown;
  let nightsAhead = 0; try { for (let i = 1; i <= 4; i++) { const n = D.dayKind(addDays(date, i)); if (n.kind === 'night' || n.kind === 'first-night') nightsAhead++; else break; } } catch {}
  return { kind: k.kind, label: D.KIND_LABEL?.[k.kind] || 'Today', ...b, nightsAhead };
}
const lenH = (m) => m.kind === 'game' ? (m.length || 0) : 0;
/** Minutes a pick takes in one sitting, and how big the whole thing is. */
export function sitting(m, budget) {
  const per = M.perUnit(m), left = m.total ? Math.max(0, m.total - (m.progress || 0)) : 0;
  if (m.kind === 'movie') return { minutes: m.runtime || per, label: fmtDur(m.runtime || per), units: 1 };
  if (m.kind === 'album') { const mins = m.runtime || (m.total || 10) * per; return { minutes: mins, label: `the album · ${fmtDur(mins)}`, units: m.total || 1 }; }
  if (m.kind === 'show' || m.kind === 'anime') { const n = Math.max(1, Math.min(left || 99, Math.floor(budget / per) || 1)); return { minutes: n * per, label: `${n} ep${n > 1 ? 's' : ''} · ${fmtDur(n * per)}`, units: n }; }
  if (m.kind === 'book') { const pages = Math.max(10, Math.round(Math.min(budget, 60) / per / 5) * 5); return { minutes: Math.round(pages * per), label: `${Math.min(pages, left || pages)} pages`, units: pages }; }
  if (m.kind === 'manga') { const n = Math.max(1, Math.min(left || 99, Math.floor(Math.min(budget, 60) / per))); return { minutes: n * per, label: `${n} ch`, units: n }; }
  const mins = Math.min(budget, 180); return { minutes: mins, label: `${fmtDur(mins)} session`, units: Math.round(mins / 6) / 10 };
}
/** Score one candidate for a day. Higher is better; -Infinity never fits. */
function fit(m, day, base, source) {
  const size = day.size, per = M.perUnit(m);
  let sc = base;
  if (m.kind === 'movie') { const rt = m.runtime || per; if (rt > day.min + 15) return -Infinity; sc += size === 'long' ? 1.2 : -0.4; }
  if (m.kind === 'show' || m.kind === 'anime') { if (per > day.min + 10) return -Infinity; sc += size === 'short' || size === 'episode' ? 0.8 : 0.3; if (per <= 30 && size === 'short') sc += 0.4; }
  if (m.kind === 'game') {
    if (source !== 'continue' && size !== 'long' && size !== 'any') return -Infinity;   // new games start on days off, not before rest or after a long day
    if (source !== 'continue' && lenH(m) > 30 && (size !== 'long' || day.nightsAhead)) return -Infinity;   // nothing huge before a night stretch
    sc += size === 'long' ? 0.8 : size === 'episode' ? -0.3 : -0.8;
  }
  if (m.kind === 'book') sc += size === 'long' ? 0.4 : size === 'short' ? 0.2 : 0.3;
  if (m.kind === 'manga') sc += size === 'short' ? 0.5 : 0.2;
  if (m.kind === 'album') { const mins = m.runtime || (m.total || 10) * per; if (mins > day.min + 30) return -Infinity; sc += size === 'short' ? 0.6 : 0.4; }   // an album fits a commute, a wind-down, a chore
  if (m.flags?.comfort) sc += day.comfort;
  return sc;
}
/** The picks for a day, best first: [{id, kind, title, why, minutes, label, source}] */
export function picksFor(s, date = new Date(), { n = 6, kinds = null } = {}) {
  const day = dayFor(date), seen = new Set(), out = [], ok = (m) => !kinds || kinds.includes(m.kind);
  const push = (m, sc, source, reason) => { if (!ok(m) || seen.has(m.id) || !Number.isFinite(sc)) return; seen.add(m.id); const st = sitting(m, day.min); out.push({ id: m.id, kind: m.kind, title: M.shown(m), why: reason, minutes: st.minutes, label: st.label, source, sc }); };
  const cont = M.nowPlaying(s), last = (m) => M.lastActivity(m) || '';
  for (const m of cont) { const recent = last(m) >= keyOf(addDays(date, -7)) ? 0.8 : 0; push(m, fit(m, day, 2 + recent, 'continue'), 'continue', `${day.why}. Carry on with it.`); }
  if (day.comfort > 0.5) for (const m of Object.values(s.media || {}).filter(m => m.status === 'done' && (m.flags?.comfort || m.flags?.rewatch) && m.score >= 7.5)) push(m, fit(m, day, 1 + day.comfort, 'comfort'), 'comfort', `${day.why}: a comfort ${M.kindOf(m.kind).one} (${tierText(m.score)})`);
  for (const r of M.rankPlanned(s, kinds, 60).filter(r => r.media.triage !== 'someday' && !(r.media.src === 'steam' && !r.media.triage))) push(r.media, fit(r.media, day, 1 + Math.max(-1, Math.min(2, r.score)), 'backlog'), 'backlog', `${day.why}. ${r.reason}.`);
  return { day, picks: out.sort((a, b) => b.sc - a.sc).slice(0, n).map(({ sc, ...p }) => p) };
}
/** The single pick for today (for Citrus's tile). */
export const pickToday = (s, now = new Date()) => picksFor(s, now, { n: 1 }).picks[0] || null;
