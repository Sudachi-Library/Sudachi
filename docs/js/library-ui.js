// The Library: the collector's catalogue of everything — every kind, every status, a search, sorting, filters (genre, tier,
// year, flags), as a poster wall or a dense list.
import { h } from './util.js';
import * as M from './media.js';
import { TIERS } from './tiers.js';
import * as CZ from './custom.js';
import { ctx, S, plural } from './bits.js';
import { posterCard, listRow, kindChips, empty, progressText, sticker } from './ui.js';
import { addSheet } from './item-ui.js';

const VIEW_KEY = 'sudachi.libview';
const rt = { kind: '', status: '', q: '', sort: 'recent', genre: '', min: 0, year: '', flag: '', limit: 60, view: (() => { try { return localStorage.getItem(VIEW_KEY) || 'grid'; } catch { return 'grid'; } })() };
export function libraryPart(p) { if (M.KINDS.some(k => k.id === p)) rt.kind = p; else if (M.STATUS[p]) rt.status = p; else if (p === 'shelf') rt.status = 'doing'; }
const STATUSES = [['', 'All'], ['doing', 'On the shelf'], ['done', 'Finished'], ['planned', 'Backlog'], ['paused', 'On hold'], ['dropped', 'Dropped']];
export function renderLibrary() {
  const s = S(), vis = CZ.visibleKinds(s), all = Object.values(s.media || {}).filter(m => vis.includes(m.kind));
  if (!all.length) return [h('h1', {}, 'Library'), empty('Nothing here yet. Import your lists or add a title.', h('div', { class: 'row wrap', style: { justifyContent: 'center', marginTop: '10px' } }, h('button', { class: 'btn primary', onClick: () => ctx.importSheet() }, '⇣ Import'), h('button', { class: 'btn', onClick: () => addSheet() }, '＋ Add')))];
  const byKind = Object.fromEntries(M.KINDS.map(k => [k.id, all.filter(m => m.kind === k.id).length]));
  const pool = all.filter(m => !rt.kind || m.kind === rt.kind), counts = Object.fromEntries(STATUSES.map(([st]) => [st, st ? pool.filter(m => m.status === st).length : pool.length]));
  const list = M.filterShelf(pool, { q: rt.q, genre: rt.genre, min: rt.min, year: rt.year, sort: rt.sort, status: rt.status, flag: rt.flag });
  const done = all.filter(m => m.status === 'done'), hours = Math.round(all.reduce((a, m) => a + M.minutesOf(m), 0) / 60);
  const set = (patch) => { Object.assign(rt, patch, patch.limit ? {} : { limit: 60 }); ctx.render(); };
  const sel = (label, value, opts, key) => h('select', { 'aria-label': label, class: 'filter', onChange: (e) => set({ [key]: key === 'min' ? +e.target.value : e.target.value }) }, ...opts.map(([v, l]) => h('option', { value: v, selected: String(value) === String(v) }, l)));
  const years = [...new Set(done.map(M.yearOf).filter(Boolean))].sort().reverse(), genres = M.genresOf(pool);
  const filtersOn = rt.genre || rt.min || rt.year || rt.flag;
  return [
    h('div', { class: 'lib-head' }, h('h1', {}, 'Library'), sticker(`${all.length.toLocaleString('en')} titles`, 'cyan'), h('span', { class: 'tiny dim' }, `${done.length.toLocaleString('en')} finished · ≈ ${hours.toLocaleString('en')}h`), h('button', { class: 'btn sm right', onClick: () => addSheet({ kind: rt.kind || 'movie' }) }, '＋ Add')),
    kindChips(rt.kind, (k) => set({ kind: k }), { counts: byKind }),
    h('div', { class: 'seg wrap lib-st', role: 'group', 'aria-label': 'Status' }, ...STATUSES.map(([st, l]) => h('button', { class: rt.status === st ? 'active' : '', 'aria-pressed': String(rt.status === st), onClick: () => set({ status: st }) }, `${l} ${counts[st]}`))),
    h('div', { class: 'row wrap lib-tools' }, h('input', { type: 'search', class: 'lib-search grow', placeholder: 'Search titles, authors, directors…', value: rt.q, 'aria-label': 'Search the library', onInput: (e) => { rt.q = e.target.value; rt.limit = 60; ctx.refocus = '.lib-search'; ctx.render(); } }),
      sel('Sort', rt.sort, [['recent', 'Recent'], ['score', 'Tier'], ['title', 'A–Z'], ['year', 'Year'], ['added', 'Added'], ['time', 'Time spent']], 'sort'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'View' }, ...[['grid', '▦'], ['list', '☰']].map(([v, l]) => h('button', { class: rt.view === v ? 'active' : '', 'aria-label': v === 'grid' ? 'Poster wall' : 'List', 'aria-pressed': String(rt.view === v), onClick: () => { rt.view = v; try { localStorage.setItem(VIEW_KEY, v); } catch {} ctx.render(); } }, l)))),
    h('details', { class: 'lib-filters', open: !!filtersOn }, h('summary', { class: 'small' }, `Filters${filtersOn ? ' (on)' : ''}`), h('div', { class: 'row wrap' },
      sel('Genre', rt.genre, [['', 'Any genre'], ...genres.map(([g, n]) => [g, `${g} (${n})`])], 'genre'),
      sel('Tier at least', rt.min, [[0, 'Any tier'], ...TIERS.slice(0, 6).map(t => [t.min, `${t.id} or better`])], 'min'),
      sel('Finished in', rt.year, [['', 'Any year'], ...years.map(y => [y, y])], 'year'),
      sel('Flag', rt.flag, [['', 'Any'], ['comfort', '♥ Comfort'], ['rewatch', '↻ Again-able'], ['recommend', '👍 Would recommend']], 'flag'),
      filtersOn ? h('button', { class: 'btn sm ghost', onClick: () => set({ genre: '', min: 0, year: '', flag: '' }) }, 'Clear') : null)),
    list.length ? (rt.view === 'grid' ? h('div', { class: 'wall' }, ...list.slice(0, rt.limit).map(m => posterCard(m, { sub: m.status === 'done' ? (m.finishedAt ? m.finishedAt.slice(0, 4) : M.statusWord(m.kind, m.status)) : progressText(m) || M.statusWord(m.kind, m.status) })))
      : h('div', { class: 'card list lib-list' }, ...list.slice(0, rt.limit).map(m => listRow(m)))) : empty(rt.q ? `Nothing matches “${rt.q}”.` : 'Nothing with these filters.'),
    list.length > rt.limit ? h('button', { class: 'btn more-btn', onClick: () => set({ limit: rt.limit + 120 }) }, `Show more (${plural(list.length - rt.limit, 'more title')})`) : null,
  ];
}
