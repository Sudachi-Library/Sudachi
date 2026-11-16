// Months and years in review: the numbers behind the Wrapped-style story and the stats pages — counts and hours by kind,
// genres, how your tiers spread, best of the period, streaks, how often you abandon things, rewatches, and what you watch
// after nights (Mandarin's shifts, through day.js). Pure (no DOM).
import * as M from './media.js';
import * as D from './day.js';
import { TIERS, tierOf, spread } from './tiers.js';
import { keyOf, fromKey, addDays, MONTHS, DAY_NAMES } from './util.js';

const pad = (n) => String(n).padStart(2, '0');
/** The period for a key: 'YYYY' (a year) or 'YYYY-MM' (a month). */
export function periodOf(key) {
  if (/^\d{4}$/.test(key)) return { key, kind: 'year', from: `${key}-01-01`, to: `${key}-12-31`, label: key, prev: String(+key - 1) };
  const [y, m] = key.split('-').map(Number), last = new Date(y, m, 0).getDate(), pm = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  return { key, kind: 'month', from: `${key}-01`, to: `${key}-${pad(last)}`, label: `${MONTHS[m - 1]} ${y}`, prev: pm };
}
/** Periods that have anything in them, newest first. */
export function periodsWithData(s, kind = 'month') {
  const keys = new Set();
  for (const m of Object.values(s.media || {})) { for (const f of M.finishesOf(m)) if (f.d) keys.add(kind === 'year' ? f.d.slice(0, 4) : f.d.slice(0, 7)); for (const x of m.log || []) if (x.d) keys.add(kind === 'year' ? x.d.slice(0, 4) : x.d.slice(0, 7)); }
  return [...keys].sort().reverse();
}
const longestRun = (days) => { const l = [...days].sort(); let best = 0, cur = 0, prev = ''; for (const d of l) { cur = prev && keyOf(addDays(fromKey(prev), 1)) === d ? cur + 1 : 1; best = Math.max(best, cur); prev = d; } return best; };
/** Everything about one period. */
export function review(s, key, now = new Date()) {
  const p = periodOf(key), to = p.to > keyOf(now) ? keyOf(now) : p.to, w = M.between(s, p.from, to), prev = M.between(s, periodOf(p.prev).from, periodOf(p.prev).to);
  const fin = w.finished, scored = fin.filter(x => x.finishScore > 0), best = scored.slice().sort((a, b) => b.finishScore - a.finishScore || a.finishedOn.localeCompare(b.finishedOn));
  const started = Object.values(s.media || {}).filter(m => m.startedAt >= p.from && m.startedAt <= to).length;
  const dropped = Object.values(s.media || {}).filter(m => m.status === 'dropped' && m.droppedAt >= p.from && m.droppedAt <= to);
  const genres = M.countOf(fin.flatMap(m => m.genres || [])).slice(0, 6), makers = M.countOf(fin.flatMap(m => M.splitNames(m.creator))).filter(([, n]) => n > 1).slice(0, 4);
  // after nights: anything logged or finished on a day you came off a night
  const after = new Set(); let afterN = 0, afterTitles = [];
  try { for (const d of w.days) if (D.dayKind(fromKey(d)).afterNight) after.add(d); } catch {}
  if (after.size) { const by = {}; for (const m of Object.values(s.media || {})) { for (const x of m.log || []) if (after.has(x.d)) by[m.id] = (by[m.id] || 0) + 1; for (const f of M.finishesOf(m)) if (after.has(f.d)) by[m.id] = (by[m.id] || 0) + 1; }
    afterN = Object.values(by).reduce((a, b) => a + b, 0); afterTitles = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => M.shown(s.media[id])); }
  const dow = Array(7).fill(0); for (const d of w.days) dow[fromKey(d).getDay()]++;
  const busiest = dow.indexOf(Math.max(...dow));
  const months = p.kind === 'year' ? Array.from({ length: 12 }, (_, i) => fin.filter(m => +m.finishedOn.slice(5, 7) === i + 1).length) : null;
  const hours = Math.round((w.minutes) / 60);
  return { ...p, to, w, n: fin.length, prevN: prev.finished.length, hours, prevHours: Math.round(prev.minutes / 60), finished: fin, best: best.slice(0, 5), top: best[0] || null,
    spread: spread(scored.map(x => ({ score: x.finishScore }))), avg: scored.length ? scored.reduce((a, x) => a + x.finishScore, 0) / scored.length : null,
    genres, makers, streak: longestRun(w.days), activeDays: w.days.size, dropped, abandon: started + fin.length ? dropped.length / Math.max(1, dropped.length + fin.length) : 0,
    again: fin.filter(x => x.again).length, afterNights: after.size, afterN, afterTitles, busiestDay: w.days.size >= 3 ? DAY_NAMES[busiest] : '', months,
    byKind: M.KINDS.map(k => ({ kind: k, n: w.byKind[k.id] })).filter(x => x.n) };
}
/** The story: one slide per thing worth saying. [{id, kicker, big, sub, items?, tone}] */
export function story(r) {
  const sl = [], plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  sl.push({ id: 'open', kicker: r.kind === 'year' ? 'Your year on the shelf' : 'Your month on the shelf', big: r.label, sub: r.n ? `${plural(r.n, 'thing')} finished. Let’s go.` : 'A quiet one. Here’s what happened anyway.', tone: 'pink' });
  if (r.n) sl.push({ id: 'count', kicker: 'You finished', big: String(r.n), sub: r.prevN ? `${r.n >= r.prevN ? '▲' : '▼'} ${Math.abs(r.n - r.prevN)} vs ${periodOf(r.prev).label}` : r.byKind.map(x => `${x.n} ${x.kind.name.toLowerCase()}`).join(' · '), items: r.byKind.map(x => `${x.kind.emoji} ${x.n} ${x.n === 1 ? x.kind.one : x.kind.name.toLowerCase()}`), tone: 'lime' });
  if (r.hours) sl.push({ id: 'hours', kicker: 'Time spent', big: `${r.hours}h`, sub: [r.w.eps && plural(r.w.eps, 'episode'), r.w.pages && `${r.w.pages.toLocaleString('en')} pages`, r.w.ch && `${r.w.ch} chapters`, r.w.gameMinutes >= 60 && `${Math.round(r.w.gameMinutes / 60)}h of games`, r.w.albums && plural(r.w.albums, 'album')].filter(Boolean).join(' · ') || 'Logged and estimated', tone: 'cyan' });
  if (r.top) sl.push({ id: 'top', kicker: r.kind === 'year' ? 'Title of the year' : 'Best of the month', big: M.shown(r.top), sub: `${tierOf(r.top.finishScore)?.id || ''} · ${M.kindOf(r.top.kind).one}${r.top.creator ? ` · ${r.top.creator}` : ''}`, items: r.best.slice(1, 5).map(m => `${tierOf(m.finishScore)?.id} ${M.shown(m)}`), tone: 'orange', cover: r.top.cover || '' });
  if (r.genres.length) sl.push({ id: 'genres', kicker: 'You leaned', big: r.genres.slice(0, 2).map(g => g[0]).join(' + '), sub: r.genres.slice(2, 5).map(g => g[0]).join(' · '), tone: 'violet' });
  const tiers = TIERS.filter(t => r.spread[t.id]); if (tiers.length) sl.push({ id: 'spread', kicker: 'How you rated', big: r.avg != null ? (tierOf(r.avg)?.id || '—') : '—', sub: 'your average tier', items: tiers.map(t => `${t.id} × ${r.spread[t.id]}`), tone: 'lime' });
  if (r.afterNights) sl.push({ id: 'nights', kicker: 'After nights', big: plural(r.afterNights, 'morning'), sub: r.afterTitles.length ? `you came off a night and reached for ${r.afterTitles.join(', ')}` : 'you came off a night and still pressed play', tone: 'cyan' });
  if (r.streak >= 3) sl.push({ id: 'streak', kicker: 'Longest run', big: `${r.streak} days`, sub: `in a row with something logged${r.busiestDay ? ` · ${r.busiestDay}s were your day` : ''}`, tone: 'pink' });
  if (r.again) sl.push({ id: 'again', kicker: 'Comfort calls', big: plural(r.again, 'rewatch', 'rewatches'), sub: 'and rereads, replays: worth it every time', tone: 'orange' });
  if (r.dropped.length) sl.push({ id: 'dropped', kicker: 'Left behind', big: String(r.dropped.length), sub: `dropped (${Math.round(r.abandon * 100)}% of what you ended). Life’s too short.`, items: r.dropped.slice(0, 4).map(m => M.shown(m)), tone: 'violet' });
  if (r.months) { const mx = Math.max(...r.months); if (mx > 1) sl.push({ id: 'months', kicker: 'Busiest month', big: MONTHS[r.months.indexOf(mx)], sub: `${mx} finished`, tone: 'lime', bars: r.months }); }
  sl.push({ id: 'end', kicker: 'That’s a wrap', big: r.kind === 'year' ? `${r.label} ✦` : r.label, sub: r.kind === 'year' ? 'Save the poster and share it.' : 'See you next month.', tone: 'pink', poster: r.kind === 'year' });
  return sl;
}
