// Today: the pick for today (planned around your shift), the shelf (what you're on, one tap to move it on), this week's
// counts, "still on this?", up next, comfort picks, discover (suggestions from the catalogues) and your goals — in the order
// you set in Customise.
import { h, toast, fmtDate, DAY_NAMES } from './util.js';
import * as M from './media.js';
import * as P from './picks.js';
import * as C from './catalog.js';
import * as CZ from './custom.js';
import { ctx, S, up, undoToast, plural } from './bits.js';
import { coverEl, posterCard, row, progressText, tierBadge, empty, sticker } from './ui.js';
import { finishSheet, addSheet, logSheet } from './item-ui.js';

const rt = { pickAt: 0, disc: null, discBusy: false };
const STEP = { show: 1, anime: 1, manga: 1, book: 10, game: 1 }, STEP_L = { show: '+1 ep', anime: '+1 ep', manga: '+1 ch', book: '+10 p', game: '+1 h' };

function actions() {
  return h('div', { class: 'qbar' }, h('button', { class: 'btn primary', onClick: logSheet }, '✚ Log'), h('button', { class: 'btn', onClick: () => addSheet() }, '＋ Add'), h('button', { class: 'btn', onClick: () => ctx.go('backlog', 'dump') }, '🧠 Brain dump'));
}
function pickCard(res) {
  const { day, picks } = res, p = picks[rt.pickAt % Math.max(1, picks.length)];
  const chip = h('span', { class: `daychip d-${day.kind}` }, day.label);
  if (!p) return h('div', { class: 'card hero pick' }, h('div', { class: 'row' }, chip), h('div', { class: 'big' }, 'Nothing to pick yet'), h('div', { class: 'small muted' }, 'Add a few things to your backlog or the shelf, and Sudachi will choose one for your day.'));
  const m = S().media[p.id];
  return h('div', { class: 'card hero pick' }, h('div', { class: 'row' }, sticker('Pick for today', 'pink'), h('span', { class: 'right' }, chip)),
    h('div', { class: 'pk-body' }, coverEl(m, 'md'), h('div', { class: 'grow' }, h('div', { class: 'pk-t' }, p.title), h('div', { class: 'small muted' }, p.why), h('div', { class: 'row wrap pk-meta' }, h('span', { class: 'chip' }, `⏱ ${p.label}`), tierBadge(m.score, { auto: m.auto, src: m.src }), progressText(m) ? h('span', { class: 'tiny dim' }, progressText(m)) : null))),
    h('div', { class: 'row wrap' },
      m.status === 'doing' && STEP[m.kind] ? h('button', { class: 'btn primary', onClick: (e) => { const r = M.logProgress(S(), m.id, { n: STEP[m.kind] }); up(() => r.state); if (r.finished) finishSheet(m.id); else { ctx.cheer(e.currentTarget); toast(`${STEP_L[m.kind]} · ${M.shown(m)}`, 'ok'); } } }, STEP_L[m.kind]) : null,
      m.status !== 'doing' ? h('button', { class: 'btn primary', onClick: () => { up(s => M.start(s, m.id)); toast(`On the shelf: ${M.shown(m)}`, 'ok'); } }, '▶ Start it') : null,
      h('button', { class: 'btn finish', onClick: () => finishSheet(m.id) }, '✓ Finished'),
      picks.length > 1 ? h('button', { class: 'btn ghost right', onClick: () => { rt.pickAt++; ctx.render(); } }, `Another (${(rt.pickAt % picks.length) + 1}/${picks.length})`) : null));
}
function shelfRow() {
  const shelf = M.nowPlaying(S());
  if (!shelf.length) return h('section', { class: 'rowsec' }, h('div', { class: 'rs-head' }, h('h2', {}, 'On the shelf')), h('div', { class: 'small muted' }, 'Nothing on the go. Tap ▶ Start on anything in your backlog, or ✚ Log when you finish something.'));
  return row('On the shelf', shelf.map(m => posterCard(m, { sub: progressText(m) || M.statusWord(m.kind, m.status), extra: h('div', { class: 'pc-acts' },
    STEP[m.kind] ? h('button', { class: 'btn sm', 'aria-label': `${STEP_L[m.kind]} on ${M.shown(m)}`, onClick: (e) => { const r = M.logProgress(S(), m.id, { n: STEP[m.kind] }); up(() => r.state); if (r.finished) finishSheet(m.id); else ctx.cheer(e.currentTarget); } }, STEP_L[m.kind]) : null,
    h('button', { class: 'btn sm finish', 'aria-label': `Finished ${M.shown(m)}`, title: 'Finished', onClick: () => finishSheet(m.id) }, '✓')) })), { sub: plural(shelf.length, 'title'), cls: 'shelf' });
}
function weekCard() {
  const s = S(), now = new Date(), w = M.thisWeek(s, now), mo = M.thisMonth(s, now), line = M.countLine(w), ml = M.countLine(mo);
  const kinds = M.KINDS.filter(k => w.byKind[k.id]);
  return h('div', { class: 'card wkcard' }, h('div', { class: 'row' }, sticker('This week', 'lime'), h('span', { class: 'tiny dim right' }, `since ${DAY_NAMES[0]}`)),
    h('div', { class: 'wk-big' }, line || 'Nothing logged yet'), w.hours ? h('div', { class: 'small muted' }, `≈ ${w.hours}h in all · ${w.days.size} day${w.days.size === 1 ? '' : 's'} with something`) : null,
    kinds.length ? h('div', { class: 'chips', style: { marginTop: '8px' } }, ...kinds.map(k => h('span', { class: 'chip', style: { '--c': k.color } }, `${k.emoji} ${w.byKind[k.id]} finished`))) : null,
    h('div', { class: 'tiny dim', style: { marginTop: '8px' } }, `This month: ${ml || 'nothing yet'}${mo.finished.length ? ` · ${plural(mo.finished.length, 'title')} finished` : ''}`));
}
function nudgeCard() {
  const old = M.stale(S(), new Date()).slice(0, 3); if (!old.length) return null;
  return h('div', { class: 'card nudge' }, h('div', { class: 'title' }, 'Still on these?'), ...old.map(m => h('div', { class: 'nd-row' }, coverEl(m, 'xs'), h('div', { class: 'grow' }, h('div', { class: 'small' }, h('b', {}, M.shown(m))), h('div', { class: 'tiny dim' }, `nothing for ${m.idle} days${progressText(m) ? ` · ${progressText(m)}` : ''}`)),
    h('div', { class: 'row wrap nd-acts' }, h('button', { class: 'btn sm', onClick: () => { up(s => M.stillOn(s, m.id)); toast('Kept on the shelf'); } }, 'Still on it'), h('button', { class: 'btn sm ghost', onClick: () => { const b = S(); up(s => M.updateMedia(s, m.id, { status: 'paused' })); undoToast('On hold', b); } }, 'On hold'),
      h('button', { class: 'btn sm ghost', onClick: () => { const b = S(); up(s => M.updateMedia(s, m.id, { status: 'dropped' })); undoToast('Dropped', b); } }, 'Drop'), h('button', { class: 'btn sm finish', onClick: () => finishSheet(m.id) }, '✓')))));
}
function upRow(res) { const rest = res.picks.filter((_, i) => i !== rt.pickAt % Math.max(1, res.picks.length)).slice(0, 8); return row('Up next', rest.map(p => posterCard(S().media[p.id], { sub: p.label })), { sub: res.day.why }); }
function comfortRow() { const l = Object.values(S().media || {}).filter(m => m.status === 'done' && m.flags?.comfort).sort((a, b) => b.score - a.score).slice(0, 12); return row('Comfort picks', l.map(m => posterCard(m, { sub: M.kindOf(m.kind).one })), { sub: '♥ for after nights' }); }
function goalsCard() {
  const g = M.goalsProgress(S(), new Date()); if (!g.length) return null;
  return h('div', { class: 'card goals' }, h('div', { class: 'title' }, `Goals for ${new Date().getFullYear()}`), ...g.map(x => { const k = x.kind === 'all' ? { name: 'Anything', emoji: '✦' } : M.kindOf(x.kind), p = Math.min(100, Math.round(x.done / x.target * 100));
    return h('div', { class: 'gl' }, h('div', { class: 'row' }, h('span', { class: 'small grow' }, `${k.emoji} ${k.name}`), h('b', {}, `${x.done} / ${x.target}`), h('span', { class: `tiny ${x.done >= x.expected ? 'ok' : 'dim'}` }, x.done >= x.expected ? 'on track' : `${Math.ceil(x.expected - x.done)} behind`)), h('div', { class: 'pbar' }, h('i', { style: { width: `${p}%` } }))); }));
}
/** Discover: suggestions from the catalogues (AniList for anime and manga, Open Library for books), cached for 12 hours. */
function discoverRow() {
  const s = S(), dismissed = s.meta?.dismissed || [], cached = rt.disc || C.cacheGet('world2');
  const add = (sg) => h('button', { class: 'btn sm', onClick: () => { const b = S(); up(x => M.addMedia(x, { ...sg.item, status: 'planned', triage: 'want' })); rt.disc = (rt.disc || cached || []).filter(y => y.key !== sg.key); C.cacheSet('world2', rt.disc); undoToast(`To the backlog: ${sg.item.title}`, b); } }, '＋ Backlog');
  const skip = (sg) => h('button', { class: 'btn sm ghost', 'aria-label': `Not interested in ${sg.item.title}`, onClick: () => { up(x => M.dismissSuggestion(x, sg.key)); rt.disc = (rt.disc || cached || []).filter(y => y.key !== sg.key); C.cacheSet('world2', rt.disc); ctx.render(); } }, '✕');
  const load = async () => {
    if (rt.discBusy) return; rt.discBusy = true; ctx.render();
    try {
      const [an, mg, bk] = await Promise.allSettled([C.animeSuggestions(s, dismissed, 'anime'), C.animeSuggestions(s, dismissed, 'manga'), C.worldSuggestions(s, dismissed).then(w => w.lanes.flatMap(l => l.items))]);
      const all = [...(an.value || []), ...(mg.value || []), ...(bk.value || [])]; const mix = []; for (let i = 0; mix.length < 18 && i < 12; i++) for (const l of [an.value || [], bk.value || [], mg.value || []]) if (l[i]) mix.push(l[i]);
      rt.disc = mix.length ? mix : all.slice(0, 18); C.cacheSet('world2', rt.disc);
      if (!rt.disc.length) toast('Score a few anime, manga or books A or higher, and suggestions show up here');
    } catch (e) { toast(e.message, 'err'); } finally { rt.discBusy = false; ctx.render(); }
  };
  if (!cached?.length) return h('section', { class: 'rowsec' }, h('div', { class: 'rs-head' }, h('h2', {}, 'Discover'), h('button', { class: 'btn sm right', disabled: rt.discBusy || !navigator.onLine, onClick: load }, rt.discBusy ? 'Looking…' : '✦ Find new things')), h('div', { class: 'tiny dim' }, 'From AniList and Open Library, based on what you scored highest.'));
  const fake = (sg, i) => ({ id: `sg-${i}`, title: sg.item.title, kind: sg.item.kind, cover: sg.item.cover || '', score: 0 });
  return row('Discover', cached.filter(x => !dismissed.includes(x.key)).map((sg, i) => posterCard(fake(sg, i), { sub: sg.reason, onClick: () => window.open(sg.item.extId && sg.item.src === 'anilist' ? `https://anilist.co/${sg.item.kind === 'manga' ? 'manga' : 'anime'}/${sg.item.extId}` : sg.item.extId?.startsWith?.('/works/') ? `https://openlibrary.org${sg.item.extId}` : `https://www.google.com/search?q=${encodeURIComponent(sg.item.title)}`, '_blank', 'noopener'), extra: h('div', { class: 'pc-acts' }, add(sg), skip(sg)) })), { sub: 'beyond your backlog', more: { label: rt.discBusy ? '…' : '↻', run: load } });
}
function welcome() {
  return h('div', { class: 'card hero welcome' }, sticker('Hey, it’s Sudachi', 'pink'), h('div', { class: 'big' }, 'Your shelf is empty'), h('div', { class: 'small muted' }, 'Bring your library in, or start fresh: log what you finish, keep a backlog, and get a pick for every kind of day.'),
    h('div', { class: 'row wrap', style: { marginTop: '12px' } }, ctx.signedIn() ? h('button', { class: 'btn primary', onClick: () => ctx.migrateNow() }, '🍊 Bring the Library from Citrus') : null, h('button', { class: 'btn', onClick: () => ctx.importSheet() }, '⇣ Import (IMDb, Goodreads, MAL, Steam)'), h('button', { class: 'btn', onClick: () => addSheet() }, '＋ Add one'), h('button', { class: 'btn', onClick: () => ctx.go('backlog', 'dump') }, '🧠 Brain dump')));
}
export function renderToday() {
  const s = S(), c = CZ.custom(s), now = new Date(), res = P.picksFor(s, now, { n: 9, kinds: CZ.visibleKinds(s) });
  if (!Object.keys(s.media || {}).length) return [h('h1', { class: 'sr-only' }, 'Today'), welcome()];
  const parts = { shelf: shelfRow, pick: () => pickCard(res), week: weekCard, nudge: nudgeCard, up: () => upRow(res), comfort: comfortRow, discover: discoverRow, goals: goalsCard };
  return [h('div', { class: 'today-top' }, h('div', { class: 'tt-date' }, h('b', {}, DAY_NAMES[now.getDay()]), ` ${fmtDate(now)}`), actions()), ...c.today.rows.order.filter(id => !c.today.rows.hidden.includes(id)).map(id => { try { return parts[id]?.(); } catch (e) { console.warn(id, e); return null; } })];
}
