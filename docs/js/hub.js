// What Sudachi tells the other apps (pure, no DOM): My Apps/hub/sudachi/status.json (HUB.md contract v2) — the one-line
// summary ("3 eps · 1 film · 6h played this week"), one pick for today, metrics (this week / this month by type, finished
// this year against the goal), "still on this?" items, deep links, and extra { week, month, now, pick, goals } for Citrus's
// Library tile. Titles only: never notes, reviews or quotes.
import { keyOf } from './util.js';
import * as M from './media.js';
import * as P from './picks.js';
import * as R from './roster.js';

export const SITE_URL = 'https://sudachi-library.github.io/Sudachi/';
export const CONTRACT = 2;

const counts = (w) => ({ eps: w.eps, films: w.films, books: w.books, chapters: w.ch, pages: w.pages, games: w.games, hours: Math.round(w.minutes / 6) / 10, played: Math.round(w.gameMinutes / 6) / 10, finished: w.finished.length });
/** status.json for Citrus (HUB.md v2). */
export function buildStatus(s, now = new Date()) {
  const t = keyOf(now), wk = M.thisWeek(s, now), mo = M.thisMonth(s, now), shelf = M.nowPlaying(s), old = M.stale(s, now), pick = P.pickToday(s, now), goals = M.goalsProgress(s, now);
  const line = M.countLine(wk);
  const summary = (line ? `${line} this week` : shelf.length ? `On ${shelf.length}: ${M.shown(shelf[0])}` : 'Nothing logged this week').slice(0, 140);
  const metrics = [
    { key: 'eps-week', label: 'Episodes this week', value: wk.eps, unit: 'eps', date: t },
    { key: 'films-week', label: 'Films this week', value: wk.films, unit: 'films', date: t },
    { key: 'hours-week', label: 'Hours this week', value: Math.round(wk.minutes / 6) / 10, unit: 'h', date: t },
    { key: 'played-week', label: 'Hours played this week', value: Math.round(wk.gameMinutes / 6) / 10, unit: 'h', date: t },
    { key: 'finished-month', label: 'Finished this month', value: mo.finished.length, unit: 'titles', date: t },
    { key: 'shelf', label: 'On the shelf', value: shelf.length, unit: 'titles', date: t },
  ];
  for (const g of goals) metrics.push({ key: `goal-${g.kind}`, label: `${g.kind === 'all' ? 'Finished' : M.kindOf(g.kind).name} this year`, value: g.done, goal: g.target, unit: g.kind === 'all' ? 'titles' : M.kindOf(g.kind).name.toLowerCase(), date: t });
  const pending = old.slice(0, 6).map(m => `Still on ${M.shown(m)}? (${m.idle} days)`);
  const base = SITE_URL;
  const actions = [
    { id: 'today', label: 'Today in Sudachi', url: `${base}#today`, icon: '🟢' },
    { id: 'log', label: 'Log something', url: `${base}?do=log`, icon: '✚', minutes: 1 },
    { id: 'shelf', label: 'On the shelf', url: `${base}?do=shelf`, icon: '📚', minutes: 1 },
    { id: 'backlog', label: 'Backlog', url: `${base}?do=backlog`, icon: '🗂', minutes: 2 },
    { id: 'import', label: 'Import', url: `${base}?do=import`, icon: '⇣', minutes: 3 },
    { id: 'review', label: 'Month in review', url: `${base}?do=review`, icon: '✦', minutes: 3 },
  ];
  return {
    app: 'sudachi', title: 'Sudachi', icon: '🟢', color: '#b8f03c', url: base, contract: CONTRACT,
    updatedAt: now.toISOString(),
    summary,
    today: { date: t, done: (wk.days?.has?.(t)) || false },
    next: pick ? { title: `${pick.title} (${pick.label})`.slice(0, 120), minutes: Math.min(240, pick.minutes || 30) } : null,
    asks: [], metrics, pending, inbox: [], actions,
    extra: {
      week: counts(wk), month: counts(mo),
      now: shelf.slice(0, 6).map(m => ({ kind: m.kind, title: M.shown(m), progress: m.progress || 0, total: m.total || 0 })),
      pick: pick ? { kind: pick.kind, title: pick.title, why: pick.why, minutes: pick.minutes, label: pick.label } : null,
      goals: Object.fromEntries(goals.map(g => [g.kind === 'movie' ? 'films' : g.kind === 'book' ? 'books' : g.kind, { done: g.done, target: g.target, ...(g.aimId ? { aimId: g.aimId } : {}) }])),
      roster: R.has() ? R.updatedAt() : null,
    },
  };
}
