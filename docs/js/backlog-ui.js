// The Backlog: everything you want to get to. The brain dump (type or paste titles, one per line, any kind), Steam's pile
// of games you own but barely played (sort them: want to / someday / not for me), and the backlog ranked by how well each
// title fits your taste. It all feeds What's next.
import { h, toast } from './util.js';
import * as M from './media.js';
import * as CZ from './custom.js';
import { ctx, S, up, undoToast, plural } from './bits.js';
import { coverEl, kindChips, empty, sticker, tierBadge } from './ui.js';

const rt = { kind: '', dump: '', dumpKind: 'movie', showSomeday: false, showNo: false, focusDump: false, more: 40 };
export function backlogPart(p) { if (p === 'dump') rt.focusDump = true; else if (M.KINDS.some(k => k.id === p)) rt.kind = p; }
const fmtH = (min) => { const x = Math.round(min / 6) / 10; return x ? `${x % 1 ? x.toFixed(1) : x}h` : 'never played'; };

function dumpCard() {
  const items = M.parseDump(rt.dump, rt.dumpKind), s = S();
  const ta = h('textarea', { class: 'dump-in', rows: 5, 'data-nodirty': '1', placeholder: 'One per line, any kind:\nDune (book)\nfilm: Perfect Days\n🎮 Hades\nFrieren [anime]\nThe Bear - series\nPiranesi by Susanna Clarke', value: rt.dump, 'aria-label': 'Brain dump',
    onInput: (e) => { rt.dump = e.target.value; ctx.refocus = '.dump-in'; ctx.render(); } });
  if (rt.focusDump) { rt.focusDump = false; setTimeout(() => { ta.focus(); ta.scrollIntoView({ block: 'center' }); }, 60); }
  const cycle = (it) => { const ids = M.KINDS.map(k => k.id), i = ids.indexOf(it.kind); const next = ids[(i + 1) % ids.length]; const lines = rt.dump.split(/\r?\n/), idx = lines.findIndex(l => l.includes(it.title)); if (idx >= 0) lines[idx] = `${M.kindOf(next).emoji} ${it.title}${it.creator ? ` by ${it.creator}` : ''}${it.year ? ` (${it.year})` : ''}`; rt.dump = lines.join('\n'); ctx.render(); };
  return h('div', { class: 'card dump' }, h('div', { class: 'row' }, sticker('Brain dump', 'pink'), h('span', { class: 'tiny dim right' }, 'empty your head into the backlog')), ta,
    h('div', { class: 'row wrap', style: { marginTop: '8px' } }, h('span', { class: 'tiny dim' }, 'Lines without a kind are'), h('select', { 'aria-label': 'Lines without a kind are', class: 'filter', onChange: (e) => { rt.dumpKind = e.target.value; ctx.render(); } }, ...M.KINDS.map(k => h('option', { value: k.id, selected: rt.dumpKind === k.id }, `${k.emoji} ${k.name}`)))),
    items.length ? h('div', { class: 'dump-prev' }, ...items.slice(0, 40).map(it => { const have = M.findMedia(s, it); return h('div', { class: `dp ${have ? 'have' : ''}` }, h('button', { class: 'dp-k', type: 'button', title: 'Tap to change the kind', 'aria-label': `${it.title}: ${M.kindOf(it.kind).name}, tap to change`, onClick: () => cycle(it) }, M.kindOf(it.kind).emoji), h('span', { class: 'grow small' }, it.title, it.creator ? h('span', { class: 'dim' }, ` · ${it.creator}`) : null, it.year ? h('span', { class: 'dim' }, ` · ${it.year}`) : null), have ? h('span', { class: 'tiny dim' }, `already: ${M.statusWord(have.kind, have.status)}`) : it.guessed ? h('span', { class: 'tiny dim' }, 'guessed') : null); }),
      items.length > 40 ? h('div', { class: 'tiny dim' }, `…and ${items.length - 40} more`) : null) : null,
    h('div', { class: 'row wrap', style: { marginTop: '8px' } }, h('button', { class: 'btn primary', disabled: !items.length, onClick: () => { const before = S(), r = M.addDump(S(), items); up(() => r.state); rt.dump = ''; ctx.cheer(); undoToast(`${plural(r.added, 'title')} to the backlog${r.already.length ? ` · ${r.already.length} already there` : ''}`, before); } }, items.length ? `Add ${plural(items.filter(i => !M.findMedia(s, i)).length, 'title')}` : 'Add'),
      rt.dump ? h('button', { class: 'btn ghost', onClick: () => { rt.dump = ''; ctx.render(); } }, 'Clear') : null));
}
function steamPile() {
  const pile = M.toTriage(S()); if (!pile.length) return null;
  const set = (id, t, label) => { const b = S(); up(s => M.triage(s, id, t)); undoToast(label, b); };
  return h('div', { class: 'card steam' }, h('div', { class: 'row' }, sticker('From Steam', 'cyan'), h('span', { class: 'small right' }, `${plural(pile.length, 'game')} to sort`)),
    h('div', { class: 'tiny dim' }, `Games you own with under ${M.LOW_PLAY / 60} hours played. Want to → What's next can pick it. Someday → kept quietly. Not for me → out of the way.`),
    ...pile.slice(0, 10).map(m => h('div', { class: 'tri' }, coverEl(m, 'wide'), h('div', { class: 'grow' }, h('div', { class: 'small' }, h('b', {}, m.title)), h('div', { class: 'tiny dim' }, fmtH(m.minutes))),
      h('div', { class: 'row wrap tri-acts' }, h('button', { class: 'btn sm primary', onClick: () => set(m.id, 'want', `Want to: ${m.title}`) }, 'Want to'), h('button', { class: 'btn sm', onClick: () => set(m.id, 'someday', `Someday: ${m.title}`) }, 'Someday'), h('button', { class: 'btn sm ghost', onClick: () => set(m.id, 'no', `Not for me: ${m.title}`) }, 'Not for me')))),
    pile.length > 10 ? h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'tiny dim grow' }, `${pile.length - 10} more after these`), h('button', { class: 'btn sm ghost', onClick: () => { const b = S(); up(s => { let x = s; for (const m of pile) x = M.triage(x, m.id, 'someday'); return x; }); undoToast(`${plural(pile.length, 'game')} to Someday`, b); } }, 'All to Someday')) : null);
}
function blRow(m, reason) {
  return h('div', { class: 'lrow static bl' }, h('button', { class: 'bl-hit', type: 'button', onClick: () => ctx.openItem(m.id) }, coverEl(m, 'sm'), h('div', { class: 'grow' }, h('div', { class: 'lr-t' }, M.shown(m)), h('div', { class: 'lr-m' }, `${M.kindOf(m.kind).emoji} ${[reason, m.year || '', m.creator].filter(Boolean).join(' · ')}`))),
    tierBadge(m.score, { auto: m.auto, src: m.src }), h('button', { class: 'btn sm', 'aria-label': `Start ${M.shown(m)}`, title: 'Start', onClick: () => { up(s => M.start(s, m.id)); toast(`On the shelf: ${M.shown(m)}`, 'ok'); } }, '▶'));
}
export function renderBacklog() {
  const s = S(), vis = CZ.visibleKinds(s), kinds = rt.kind ? [rt.kind] : vis;
  const all = M.backlog(s, vis), counts = Object.fromEntries(M.KINDS.map(k => [k.id, all.filter(m => m.kind === k.id && m.triage !== 'someday').length]));
  const ranked = M.rankPlanned(s, kinds, 2000).filter(r => r.media.triage !== 'someday' && !(r.media.src === 'steam' && !r.media.triage));
  const someday = all.filter(m => m.triage === 'someday' && kinds.includes(m.kind)), no = Object.values(s.media || {}).filter(m => m.status === 'planned' && m.triage === 'no' && kinds.includes(m.kind));
  return [h('div', { class: 'lib-head' }, h('h1', {}, 'Backlog'), sticker(`${all.length.toLocaleString('en')} waiting`, 'lime')),
    dumpCard(), steamPile(),
    kindChips(rt.kind, (k) => { rt.kind = k; rt.more = 40; ctx.render(); }, { counts }),
    ranked.length ? h('div', { class: 'card list' }, h('div', { class: 'title' }, 'Best fit first'), ...ranked.slice(0, rt.more).map(r => blRow(r.media, r.reason)), ranked.length > rt.more ? h('button', { class: 'btn sm ghost more-btn', onClick: () => { rt.more += 80; ctx.render(); } }, `Show ${Math.min(80, ranked.length - rt.more)} more`) : null) : empty('Nothing waiting here. Dump some titles above, or import a watchlist.'),
    someday.length ? h('details', { class: 'card', open: rt.showSomeday, onToggle: (e) => { rt.showSomeday = e.currentTarget.open; } }, h('summary', { class: 'small' }, `Someday (${someday.length})`), ...someday.slice(0, 200).map(m => blRow(m, M.SRC_NAME[m.src] === 'Steam' ? fmtH(m.minutes) : ''))) : null,
    no.length ? h('details', { class: 'card', open: rt.showNo, onToggle: (e) => { rt.showNo = e.currentTarget.open; } }, h('summary', { class: 'small' }, `Not for me (${no.length})`), ...no.slice(0, 200).map(m => h('div', { class: 'lrow static' }, coverEl(m, 'sm'), h('div', { class: 'grow small' }, M.shown(m)), h('button', { class: 'btn sm ghost', onClick: () => up(x => M.triage(x, m.id, 'someday')) }, 'Bring back')))) : null];
}
