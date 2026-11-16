// Who works when, read from Mandarin (My Apps/hub/mandarin/shifts.json). Sudachi never parses rota files: Mandarin owns them.
// shifts.json holds your own days (corrections included) from a week back to six weeks ahead, the roster by rota key
// (`id:<staff id>` or `name:<lower-case name>`) with a legend code or only the kind of day, and the GP legend with hours.
// This module keeps the last copy on this device (so Sudachi works offline) and answers "what is X doing on day D?".
import { keyOf } from './util.js';

const KEY = 'sudachi.shifts';
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, n = 80) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').slice(0, n);
const DAY = /^\d{4}-\d\d-\d\d$/;
const HM = /^(\d{1,2}):(\d\d)$/;
const mins = (t) => { const m = HM.exec(String(t || '')); return m && +m[1] <= 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };

export const UNIT_LABEL = { gp: 'GP', fsed: 'FSED', uv: 'Upper Village', lv: 'Lower Village', nurse: 'Nurses' };
export const groupOf = (unit) => unit === 'nurse' ? 'Nurses' : unit === 'gp' ? 'GPs' : 'Specialists';
// Hours when the code says only "day" or "night": nurses and doctors here both work 12-hour shifts.
const NURSE_HOURS = { D: [8 * 60, 20 * 60], E: [12 * 60, 24 * 60], N: [20 * 60, 8 * 60] };
const DOC_HOURS = { D: [8 * 60, 20 * 60], E: [14 * 60, 26 * 60], N: [20 * 60, 8 * 60] };

let SH = null;   // the cleaned shifts.json
let cache = null;
/** A clean copy of a shifts.json from Mandarin: never trust another app's file. null when it is not one. */
export function clean(j) {
  if (!isObj(j) || (j.app && j.app !== 'mandarin')) return null;
  const days = {}, roster = {}, legend = {};
  for (const d of Array.isArray(j.days) ? j.days : []) {
    if (!isObj(d) || !DAY.test(d.date || '')) continue;
    const kind = ['work', 'off', 'leave', 'other', 'unknown'].includes(d.kind) ? d.kind : 'unknown';
    const x = { date: d.date, kind, code: str(d.code, 12) };
    if (kind === 'work') { Object.assign(x, { type: str(d.type, 4), site: str(d.site, 60), label: str(d.label, 60) }); const a = mins(d.start), b = mins(d.end); if (a != null && b != null && a !== b) { x.start = a; x.end = b <= a ? b + 1440 : b; } }
    if (kind === 'leave') x.label = str(d.label, 40);
    days[d.date] = x;
  }
  for (const [k, r] of Object.entries(isObj(j.roster) ? j.roster : {})) {
    if (!/^(id|name):/.test(k) || !isObj(r)) continue;
    const dd = {}; for (const [d, c] of Object.entries(isObj(r.days) ? r.days : {})) if (DAY.test(d) && (typeof c === 'string') && c) dd[d] = c.slice(0, 12);
    roster[k] = { name: str(r.name, 80) || k.replace(/^(id|name):/, ''), unit: str(r.unit, 10) || 'gp', days: dd };
  }
  for (const [c, l] of Object.entries(isObj(j.legend) ? j.legend : {})) {
    if (!isObj(l)) continue; const a = mins(l.start), b = mins(l.end);
    legend[c.toUpperCase()] = { label: str(l.label, 60), site: str(l.site, 60), type: str(l.type, 4), ...(a != null && b != null && a !== b ? { start: a, end: b <= a ? b + 1440 : b } : {}) };
  }
  const me = isObj(j.me) && typeof j.me.key === 'string' && /^(id|name):/.test(j.me.key) ? { key: j.me.key, name: str(j.me.name, 80) } : null;
  return { updatedAt: str(j.updatedAt, 40), me, days, roster, legend };
}
/** Use this shifts.json (from Drive, or from a test). Returns true when it was usable. `keep`: remember it on this device. */
export function set(j, { keep = true } = {}) {
  const c = clean(j); if (!c) return false;
  SH = c; cache = null;
  if (keep) { try { localStorage.setItem(KEY, JSON.stringify(j)); } catch {} }
  return true;
}
export function load() { if (SH) return SH; try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j) set(j, { keep: false }); } catch {} return SH; }
export function clear() { SH = null; cache = null; try { localStorage.removeItem(KEY); } catch {} }
const S = () => SH || load();
export const has = () => !!S();
export const updatedAt = () => S()?.updatedAt || '';
export const meKey = () => S()?.me?.key || '';
export const meName = () => S()?.me?.name || '';

/** Everyone in the roster except you: [{key, name, unit, group}], by name. */
export function people() {
  const s = S(); if (!s) return [];
  if (!cache) cache = Object.entries(s.roster).filter(([k]) => k !== s.me?.key).map(([key, r]) => ({ key, name: r.name, unit: r.unit, units: [r.unit], group: groupOf(r.unit) })).sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}
export const person = (key) => people().find(p => p.key === key) || null;
export const unitOf = (key) => S()?.roster[key]?.unit || '';

const LEAVE = /annual|eid|sick|emergency|leave|^AL$|^EL$|^SL$|^EM\\?L$|^AL\/EL$|^VL$/i;
const OTHER = /transfer|resign|orientation|^OR$|^(ACLS|BLS)\b|^PULL OUT|^END OF CONTRACT/i;
const OFF = /^(OFF|OFF REQUEST|O)$/i;
/** The kind of a code: work | off | leave | other (training, pulled out…). Empty is off. */
export function kindOf(code) {
  const c = String(code || '').trim(); if (!c) return 'off';
  if (['work', 'off', 'leave', 'other'].includes(c)) return c;   // Mandarin sends only the kind when the cell was free text
  if (LEAVE.test(c)) return 'leave'; if (OTHER.test(c)) return 'other'; if (OFF.test(c)) return 'off';
  return 'work';
}
/** Hours for a work code on someone's row: the GP legend, else the code's letter (D/E/N, with or without a site number). */
export function hoursFor(code, unit) {
  const s = S(), C = String(code || '').trim().toUpperCase(), L = s?.legend || {};
  if (unit === 'gp' || !unit) { if (L[C]?.start != null) return [L[C].start, L[C].end]; const t = /^([DNE])\d?$/.exec(C)?.[1]; if (t && L[t]?.start != null) return [L[t].start, L[t].end]; }
  const t = /^([DNE])\d?$/.exec(C)?.[1]; if (!t) return null;
  const h = (unit === 'nurse' ? NURSE_HOURS : DOC_HOURS)[t]; return [h[0], h[1] <= h[0] ? h[1] + 1440 : h[1]];
}
const typeOf = (code) => { const C = String(code || '').trim().toUpperCase(), L = S()?.legend || {}; return L[C]?.type || /^([DNE])\d?$/.exec(C)?.[1] || C.slice(0, 3); };

/** What a rota row says for a date: null (no roster for that day: unknown), or {kind, code, type, start, end, site}
 *  with minutes from that day's midnight (end may pass 1440). Your own row uses your days, corrections included. */
export function shiftOf(key, date) {
  const s = S(); if (!s || !key) return null; const k = typeof date === 'string' ? date : keyOf(date);
  if (key === s.me?.key) {
    const d = s.days[k]; if (!d) return null;
    if (d.kind === 'unknown') return null;
    return d.kind === 'work' ? { kind: 'work', code: d.code, type: d.type || typeOf(d.code), start: d.start ?? null, end: d.end ?? null, site: d.site || '' } : { kind: d.kind, code: d.code, label: d.label || '' };
  }
  const r = s.roster[key]; if (!r) return null;
  const code = r.days[k];
  if (code === undefined) return inRange(s, key, k) ? { kind: 'off', code: '' } : null;   // the roster covers this day and the cell is empty: off
  const kind = kindOf(code);
  if (kind !== 'work') return { kind, code, label: code };
  const h = hoursFor(code, r.unit), L = s.legend[String(code).toUpperCase()];
  return { kind: 'work', code, type: typeOf(code), start: h ? h[0] : null, end: h ? h[1] : null, site: (r.unit === 'gp' && L?.site) || '' };
}
// The roster is sent for a fixed window and only non-empty cells are in it. A missing cell in a month where that row has
// other codes is an empty cell (off); a month where the row has nothing at all is not known (not in that rota, or not loaded).
let rangeMemo = null;
function memo(s) {
  if (rangeMemo?.s === s) return rangeMemo;
  let lo = '', hi = ''; const months = new Map();
  for (const [k, r] of Object.entries(s.roster)) { const m = new Set(); for (const d of Object.keys(r.days)) { m.add(d.slice(0, 7)); if (!lo || d < lo) lo = d; if (!hi || d > hi) hi = d; } months.set(k, m); }
  for (const d of Object.keys(s.days)) { if (!lo || d < lo) lo = d; if (!hi || d > hi) hi = d; }
  return (rangeMemo = { s, lo, hi, months });
}
function inRange(s, key, k) { const m = memo(s); return !!m.lo && k >= m.lo && k <= m.hi && !!m.months.get(key)?.has(k.slice(0, 7)); }
/** The last day the roster covers, so "later days unknown" can be said out loud. null without a roster. */
export function coverEnd() { const s = S(); if (!s) return null; const m = memo(s); return m.hi ? new Date(+m.hi.slice(0, 4), +m.hi.slice(5, 7) - 1, +m.hi.slice(8, 10)) : null; }

// Transliterated Arabic names are spelt many ways (Meshal/Mishal, Merri/Mari, Mohammed/Muhammad): compare consonant skeletons, or allow one typo.
const norm = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9؀-ۿ ]/g, ' ').replace(/\s+/g, ' ').trim();
export const bare = (n) => String(n || '').replace(/^Dr\.?\s+/i, '').replace(/\s+-\s+.*$/, '').trim();   // "Dr. Mohammed Mari - TL" → "Mohammed Mari"
const skel = (w) => w[0] + w.slice(1).replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
const lev1 = (a, b) => { if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, e = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } } return e + (a.length - i) + (b.length - j) <= 1; };
const close = (w, x) => w.length >= 4 && x.length >= 3 && /^[a-z]+$/.test(w) && (skel(w) === skel(x) || lev1(w, x));
/** People in the roster whose name contains every word you typed. When nothing matches exactly, a second pass allows
 *  spelling variants; those results carry `fuzzy: true`. */
export function match(name) {
  const want = norm(name).split(' ').filter(Boolean); if (!want.length) return [];
  const ppl = people(), score = (exact) => ppl.map(p => { const have = norm(bare(p.name)).split(' '); const hit = want.filter(w => have.some(x => x === w || x.startsWith(w) || (!exact && close(w, x)))).length; return { ...p, ratio: hit / want.length, score: hit / want.length - (have.length - want.length) * 0.01, ...(exact ? {} : { fuzzy: true }) }; })
    .filter(p => p.ratio >= 1).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const ex = score(true); return ex.length ? ex : score(false);
}
