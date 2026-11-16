// Your day, as Sudachi needs it: what Mandarin says you work (hub/mandarin/shifts.json, read by roster.js), when you are
// free for home things, and what kind of eating day it is. Pure (no DOM). Times are minutes from that day's midnight
// (an end past 1440 runs into the next morning).
import * as R from './roster.js';
import { addDays, keyOf } from './util.js';

const H = 60, AFTER = 45, BEFORE = 90, MIN_WINDOW = 30;
let WAKE = 8 * H, LATE = 23 * H;
/** When home things can happen: up from, and nothing after (Settings › Customise › Your day). */
export function setTiming({ wake = 8 * H, late = 23 * H } = {}) { WAKE = wake; LATE = late; }
export const timing = () => ({ wake: WAKE, late: LATE });

/** Your shift that day: { status: 'work'|'off'|'leave'|'other'|'unknown', type: 'D'|'E'|'N', start, end, code, site }. */
export function shiftOn(date) {
  const key = R.meKey(); if (!key) return { status: 'unknown', type: '', code: '' };
  const sh = R.shiftOf(key, keyOf(date));
  if (!sh) return { status: 'unknown', type: '', code: '' };
  if (sh.kind === 'work') {
    if (sh.start == null) return { status: 'work', type: sh.type || '', start: 8 * H, end: 20 * H, code: sh.code, site: sh.site || '', guessed: true };
    const end = sh.end <= sh.start ? sh.end + 1440 : sh.end;
    return { status: 'work', type: sh.type || (sh.start >= 17 * H ? 'N' : 'D'), start: sh.start, end, code: sh.code, site: sh.site || '' };
  }
  return { status: sh.kind === 'off' || sh.kind === 'leave' ? sh.kind : 'other', type: '', code: sh.code || '', label: sh.label || '' };
}
const isNight = (sh) => sh.status === 'work' && (sh.type === 'N' || sh.end > 1440 + 2 * H);
/** Minutes of this morning still taken by last night's shift (0 when there was none). */
const tailOf = (prev) => prev.status === 'work' && prev.end > 1440 ? prev.end - 1440 : 0;

/** Free windows for home things on a date: around the shift, sleep ~8 h after a night, only the afternoon before a night. */
export function freeWindows(date) {
  const today = shiftOn(date), prev = shiftOn(addDays(date, -1)), tail = tailOf(prev);
  const from = Math.max(WAKE, tail ? tail + 8 * H : WAKE), out = [];
  if (today.status === 'off' || today.status === 'leave' || today.status === 'other') out.push([Math.min(from, 20 * H), LATE]);
  else if (today.status === 'work') {
    if (isNight(today) || today.start >= 17 * H) { const to = today.start - BEFORE - (isNight(today) ? 2 * H : 0); if (to - Math.max(from, 14 * H) >= MIN_WINDOW) out.push([Math.max(from, 14 * H), to]); }   // before a night: the afternoon only, and rest first
    else { if (today.start - BEFORE - from >= MIN_WINDOW) out.push([from, today.start - BEFORE]); const after = today.end + AFTER; if (LATE - after >= MIN_WINDOW) out.push([after, LATE]); }
  } else return [];
  return out.filter(w => w[1] - w[0] >= MIN_WINDOW);
}
/** For chores.js: { status, start, end, type, windows } with calendar events taken out. No rota → one daytime window. */
export function meState(s, date, busy = []) {
  const sh = shiftOn(date);
  let wins = sh.status === 'unknown' ? [] : freeWindows(date);
  for (const [bs, be] of busy) wins = wins.flatMap(([a, b]) => be <= a || bs >= b ? [[a, b]] : [[a, Math.min(b, bs)], [Math.max(a, be), b]]).filter(w => w[1] - w[0] >= MIN_WINDOW);
  return { ...sh, windows: wins };
}

/** The eating day: off | day (a day shift) | night | first-night | postnight (slept after a night, free tonight) | leave | unknown.
 *  `stretch`: nights in a row this night belongs to; `afterNight`: you are coming off a night this morning. */
export function dayKind(date) {
  const sh = shiftOn(date), prev = shiftOn(addDays(date, -1)), afterNight = tailOf(prev) >= 3 * H;
  let kind;
  if (sh.status === 'unknown') kind = afterNight ? 'postnight' : 'unknown';
  else if (sh.status === 'work') kind = isNight(sh) ? (afterNight ? 'night' : 'first-night') : sh.start >= 12 * H ? 'evening' : 'day';
  else if (sh.status === 'leave') kind = afterNight ? 'postnight' : 'leave';
  else kind = afterNight ? 'postnight' : 'off';
  let stretch = 0;
  if (isNight(sh)) { let a = 0, b = 0; while (a < 14 && isNight(shiftOn(addDays(date, -(a + 1))))) a++; while (b < 14 && isNight(shiftOn(addDays(date, b + 1)))) b++; stretch = a + b + 1; }
  return { kind, shift: sh, afterNight, stretch, long: sh.status === 'work' && sh.end - sh.start >= 10 * H };
}
export const KIND_LABEL = { off: 'Day off', day: 'Day shift', evening: 'Evening shift', night: 'Night', 'first-night': 'First night', postnight: 'After a night', leave: 'Leave', unknown: 'Rota not known' };
/** "D1 08:00–20:00" / "Off" — for chips and lines. */
export function shiftText(sh) {
  if (sh.status !== 'work') return sh.status === 'leave' ? (sh.label || 'Leave') : sh.status === 'off' ? 'Off' : sh.status === 'other' ? (sh.label || sh.code || 'Away') : '?';
  const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${sh.code || sh.type} ${hm(sh.start)}–${hm(sh.end)}`;
}
