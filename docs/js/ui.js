// Pieces every Sudachi screen shares: covers (real ones, or a generated sticker when there is none), tier badges and the tier
// picker, progress words, poster cards for the streaming rows, list rows for the catalogue, kind chips. DOM only.
import { h, fmtDate, fromKey } from './util.js';
import * as M from './media.js';
import { TIERS, tierOf } from './tiers.js';
import * as CZ from './custom.js';
import { ctx, S } from './bits.js';

const hash = (t) => { let x = 5381; for (const c of String(t)) x = ((x << 5) + x + c.codePointAt(0)) | 0; return x >>> 0; };
const PALETTES = [['#ff2e88', '#7c3aed'], ['#b8f03c', '#0ea5a4'], ['#21d4fd', '#b721ff'], ['#ff7a1a', '#ff2e88'], ['#3cf0c8', '#2563eb'], ['#ffb000', '#ef4444'], ['#a77bff', '#21d4fd'], ['#ff4fa3', '#ffb000']];
export const tiltOf = (m) => ((hash(m.id || m.title) % 9) - 4) * 0.6;
const initials = (t) => String(t).replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(w => /\p{L}|\d/u.test(w[0] || '')).slice(0, 2).map(w => [...w][0].toUpperCase()).join('') || '✦';
/** A cover: the real image when there is one (and covers are on), otherwise a sticker made from the title. */
export function coverEl(m, cls = '') {
  const k = M.kindOf(m.kind), [a, b] = PALETTES[hash(m.title) % PALETTES.length], showReal = m.cover && CZ.custom(S()).look.covers;
  const gen = h('div', { class: 'cv-gen', style: { '--a': a, '--b': b } }, h('span', { class: 'cv-emoji', 'aria-hidden': 'true' }, k.emoji), h('b', {}, initials(M.shown(m))), h('i', { class: 'cv-tape', 'aria-hidden': 'true' }));
  const box = h('div', { class: `cover k-${m.kind} ${cls}`, style: { '--tilt': `${tiltOf(m)}deg` } });
  if (showReal) { const img = h('img', { src: m.cover, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onError: () => img.replaceWith(gen) }); box.append(img); } else box.append(gen);
  return box;
}
/** "A+" badge (dashed when converted from another site). */
export function tierBadge(score, { auto = false, big = false, src = '' } = {}) {
  const t = tierOf(score); if (!t) return null;
  return h('span', { class: `tier ${big ? 'big' : ''} ${auto ? 'auto' : ''}`, style: { '--c': t.color }, title: `${t.id}: ${t.means}${auto ? ` · converted from ${M.SRC_NAME[src] || src}` : ''}` }, t.id);
}
/** The tier picker: S A+ A B+ B C D F, and a clear. onPick(score). */
export function tierPicker(value, onPick, { compact = false } = {}) {
  const cur = tierOf(value)?.id || '';
  const box = h('div', { class: `tierpick ${compact ? 'compact' : ''}`, role: 'radiogroup', 'aria-label': 'Your tier' });
  const paint = (id) => { for (const b of box.querySelectorAll('button[data-t]')) { const on = b.dataset.t === id; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); } const w = box.querySelector('.tp-means'); if (w) w.textContent = id ? TIERS.find(t => t.id === id).means : 'Not rated'; };
  for (const t of TIERS) box.append(h('button', { type: 'button', role: 'radio', 'data-t': t.id, style: { '--c': t.color }, 'aria-label': `${t.id}: ${t.means}`, title: t.means, onClick: () => { paint(t.id); onPick(t.score); } }, t.id));
  box.append(h('button', { type: 'button', class: 'tp-clear', 'aria-label': 'No rating', title: 'No rating', onClick: () => { paint(''); onPick(0); } }, '✕'));
  if (!compact) box.append(h('div', { class: 'tp-means tiny' }));
  paint(cur); return box;
}
/** "Ep 5 / 12" · "p. 120 / 300" · "12h played" · "" */
export function progressText(m) {
  const k = M.kindOf(m.kind), p = m.progress || 0;
  if (m.kind === 'game') { const hrs = Math.round((m.minutes || p * 60) / 6) / 10; return hrs ? `${hrs % 1 ? hrs.toFixed(1) : hrs}h played${m.ach?.total ? ` · ${m.ach.done}/${m.ach.total} 🏆` : ''}` : ''; }
  if (m.kind === 'movie') return m.runtime ? `${m.runtime} min` : '';
  if (m.kind === 'album' && m.status !== 'doing') return [m.total ? `${m.total} tracks` : '', m.runtime ? `${m.runtime} min` : ''].filter(Boolean).join(' · ');
  if (!p && !m.total) return '';
  const lab = m.kind === 'book' ? 'p.' : m.kind === 'manga' ? 'Ch' : m.kind === 'album' ? 'Track' : 'Ep';
  return `${lab} ${p}${m.total ? ` / ${m.total}` : ''}`;
}
export const pct = (m) => m.total && m.kind !== 'game' && m.status !== 'done' ? Math.max(0, Math.min(100, Math.round((m.progress || 0) / m.total * 100))) : null;
export function bar(m) { const p = pct(m); return p == null ? null : h('div', { class: 'pbar', role: 'progressbar', 'aria-valuenow': String(p), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Progress' }, h('i', { style: { width: `${p}%` } })); }
/** A poster card for a streaming row. sub: a line under the title; extra: a node (a button) at the bottom. */
export function posterCard(m, { sub = '', extra = null, onClick = null } = {}) {
  return h('div', { class: 'pc' },
    h('button', { class: 'pc-hit', type: 'button', 'aria-label': `${M.shown(m)}${sub ? `, ${sub}` : ''}`, onClick: onClick || (() => ctx.openItem(m.id)) },
      h('div', { class: 'pc-art' }, coverEl(m), tierBadge(m.score, { auto: m.auto, src: m.src }), m.flags?.comfort ? h('span', { class: 'pc-heart', title: 'Comfort' }, '♥') : null, bar(m)),
      h('div', { class: 'pc-t' }, M.shown(m)), sub ? h('div', { class: 'pc-s' }, sub) : null),
    extra);
}
/** A horizontal row of cards (the streaming look). */
export function row(title, cards, { sub = '', more = null, cls = '' } = {}) {
  if (!cards.length) return null;
  return h('section', { class: `rowsec ${cls}` }, h('div', { class: 'rs-head' }, h('h2', {}, title), sub ? h('span', { class: 'tiny dim' }, sub) : null, more ? h('button', { class: 'btn sm ghost right', onClick: more.run }, more.label) : null), h('div', { class: 'rs-scroll' }, ...cards));
}
/** One line of the catalogue. */
export function listRow(m, { meta = '' } = {}) {
  const st = M.statusWord(m.kind, m.status), d = m.status === 'done' && m.finishedAt ? fmtDate(fromKey(m.finishedAt)) : '';
  return h('button', { class: 'lrow', type: 'button', onClick: () => ctx.openItem(m.id) }, coverEl(m, 'sm'),
    h('div', { class: 'grow' }, h('div', { class: 'lr-t' }, M.shown(m)), h('div', { class: 'lr-m' }, [M.kindOf(m.kind).emoji, meta || [st, d, progressText(m), m.creator, m.year || ''].filter(Boolean).join(' · ')].join(' '))),
    m.flags?.comfort ? h('span', { class: 'lr-heart', title: 'Comfort' }, '♥') : null, tierBadge(m.score, { auto: m.auto, src: m.src }));
}
/** Kind filter chips ('' = everything). */
export function kindChips(sel, onPick, { counts = null, all = 'All' } = {}) {
  const kinds = CZ.visibleKinds(S());
  return h('div', { class: 'kchips', role: 'group', 'aria-label': 'Kind' }, h('button', { class: `kc ${!sel ? 'on' : ''}`, 'aria-pressed': String(!sel), onClick: () => onPick('') }, all),
    ...M.KINDS.filter(k => kinds.includes(k.id)).map(k => h('button', { class: `kc ${sel === k.id ? 'on' : ''}`, style: { '--c': k.color }, 'aria-pressed': String(sel === k.id), onClick: () => onPick(k.id) }, `${k.emoji} ${k.name}${counts ? ` ${counts[k.id] || 0}` : ''}`)));
}
export const empty = (msg, ...kids) => h('div', { class: 'card empty-card' }, h('div', { class: 'empty-art', 'aria-hidden': 'true' }, '✦'), h('div', { class: 'small' }, msg), ...kids);
/** A sticker heading: a loud title with a tape strip. */
export const sticker = (text, tone = 'lime') => h('span', { class: `stk t-${tone}` }, text);
