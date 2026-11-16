// Made-up library data and a shifts.json shaped like Mandarin's, for the tests. Never real names, words from a real journal, or places.
// The month: day shifts (D1 08:00–20:00) on weekdays, Fri/Sat off, nights 19–21/11 (a stretch of three), off 22/11, leave 25/11.
const d = (n) => `2026-11-${String(n).padStart(2, '0')}`;
const myDays = [];
for (let n = 1; n <= 30; n++) {
  const dow = new Date(2026, 10, n).getDay();
  if ([19, 20, 21].includes(n)) myDays.push({ date: d(n), kind: 'work', code: 'N1', type: 'N', site: 'Upper Village', start: '20:00', end: '08:00', overnight: true });
  else if (n === 25) myDays.push({ date: d(n), kind: 'leave', code: 'AL', label: 'Annual leave' });
  else if (dow === 5 || dow === 6 || n === 22) myDays.push({ date: d(n), kind: 'off', code: '' });
  else myDays.push({ date: d(n), kind: 'work', code: 'D1', type: 'D', site: 'Upper Village', start: '08:00', end: '20:00' });
}
export const shifts = { app: 'mandarin', contract: 2, updatedAt: '2026-11-16T05:00:00Z', me: { name: 'Dr Test Me', key: 'id:1' }, days: myDays,
  roster: { 'id:1': { name: 'Dr Test Me', unit: 'gp', days: {} } },
  legend: { D1: { label: 'Day · Upper Village', site: 'Upper Village', type: 'D', start: '08:00', end: '20:00' }, N1: { label: 'Night · Upper Village', site: 'Upper Village', type: 'N', start: '20:00', end: '08:00' } } };

export const goals = { aims: [{ id: 'aim1', title: 'Read more fiction', area: 'learning', status: 'active', progress: 0.3 }, { id: 'aim2', title: 'Rest properly', area: 'health', status: 'active', progress: 0.5 }] };

const at = Date.parse('2026-11-10T10:00:00Z');
let n = 0;
const rec = (f) => { const id = f.id || `m${++n}`; return [id, { id, title: '', orig: '', en: '', status: 'planned', score: 0, auto: false, srcRating: 0, srcScale: 10, flags: {}, progress: 0, total: 0, year: 0, creator: '', genres: [], cover: '', src: 'manual', extId: '', malId: '', log: [], plays: [], quotes: [], startedAt: '', finishedAt: '', droppedAt: '', minutes: 0, runtime: 0, length: 0, review: '', pub: 0, triage: '', createdAt: at, at, ...f }]; };
// made-up titles only
export const state = {
  app: 'sudachi', version: 1, updatedAt: at, meta: { goals: { book: 12, all: 80 } },
  media: Object.fromEntries([
    rec({ id: 'a1', kind: 'anime', title: 'Test Sky Garden', status: 'doing', progress: 5, total: 12, runtime: 24, genres: ['Fantasy', 'Slice of Life'], startedAt: '2026-11-02', log: [{ d: '2026-11-15', n: 2, m: 48 }, { d: '2026-11-16', n: 1, m: 24 }], flags: { comfort: true } }),
    rec({ id: 's1', kind: 'show', title: 'The Test Kitchen', status: 'doing', progress: 3, total: 8, runtime: 30, genres: ['Drama', 'Comedy'], startedAt: '2026-11-10', log: [{ d: '2026-11-14', n: 3, m: 90 }] }),
    rec({ id: 'b1', kind: 'book', title: 'A Made-Up Novel', creator: 'Test Author', status: 'doing', progress: 120, total: 340, startedAt: '2026-11-01', log: [{ d: '2026-11-12', n: 40, m: 60 }], quotes: [{ id: 'q1', t: 'A made-up line worth keeping.', p: 88, d: '2026-11-12' }] }),
    rec({ id: 'g1', kind: 'game', title: 'Test Quest', status: 'doing', minutes: 1260, src: 'steam', extId: '111', length: 60, startedAt: '2026-09-01', log: [{ d: '2026-09-20', n: 2, m: 120 }], ach: { done: 12, total: 40 } }),
    rec({ id: 'f1', kind: 'movie', title: 'Le Film Test', orig: 'Le Film Test', en: 'The Test Film', status: 'done', score: 10, runtime: 118, year: 2019, creator: 'Test Director', genres: ['Drama'], finishedAt: '2026-11-08', src: 'imdb', extId: 'tt0000001', flags: { rewatch: true, recommend: 'yes' }, review: 'A private test note' }),
    rec({ id: 'f2', kind: 'movie', title: 'Another Test Picture', status: 'done', score: 7, runtime: 95, genres: ['Comedy'], finishedAt: '2026-11-03' }),
    rec({ id: 'f3', kind: 'movie', title: 'Long Test Epic', status: 'planned', runtime: 190, genres: ['Drama'], pub: 8.4, triage: 'want' }),
    rec({ id: 'f4', kind: 'movie', title: 'Short Test Comedy', status: 'planned', runtime: 88, genres: ['Comedy'], triage: 'want' }),
    rec({ id: 'b2', kind: 'book', title: 'The Test Classic', creator: 'Test Author', status: 'done', score: 9, total: 280, genres: ['Fiction'], finishedAt: '2026-10-20', startedAt: '2026-10-01', plays: [{ d: '2024-03-01', score: 8.5 }] }),
    rec({ id: 'b3', kind: 'book', title: 'Imported Test Book', creator: 'Someone Else', status: 'done', score: 8.5, auto: true, srcRating: 5, srcScale: 5, src: 'goodreads', extId: '9', finishedAt: '2025-12-28' }),
    rec({ id: 'm1', kind: 'manga', title: 'Test Panels', status: 'done', score: 8, total: 50, finishedAt: '2026-11-11', flags: { comfort: true } }),
    rec({ id: 'a2', kind: 'anime', title: 'Old Test Mecha', status: 'dropped', droppedAt: '2026-11-05', progress: 3, total: 24 }),
    rec({ id: 'g2', kind: 'game', title: 'Unplayed Test Game', status: 'planned', src: 'steam', extId: '222', minutes: 0 }),
    rec({ id: 'g3', kind: 'game', title: 'Barely Played Test', status: 'planned', src: 'steam', extId: '333', minutes: 40 }),
    rec({ id: 's2', kind: 'show', title: 'Test Detectives', status: 'planned', runtime: 50, genres: ['Crime', 'Drama'], triage: 'want' }),
    rec({ id: 'a3', kind: 'anime', title: 'Comfort Test Rewatch', status: 'done', score: 9, total: 12, runtime: 24, finishedAt: '2026-06-10', flags: { comfort: true, rewatch: true } }),
  ]),
  deleted: {}, stamps: {}, migrated: { from: 'skipped', at, counts: {} }, settings: {},
};
