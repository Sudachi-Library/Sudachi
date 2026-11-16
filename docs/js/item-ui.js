// One title up close: the item sheet (status, progress, your tier, flags, dates, earlier plays, note, quotes), the finish
// sheet (date, tier, flags, note — one tap from the shelf), adding a title (with a catalogue look-up) and editing one.
import { h, toast, keyOf, fmtDate, fromKey, fmtDur } from './util.js';
import * as M from './media.js';
import * as C from './catalog.js';
import { tierOf } from './tiers.js';
import { ctx, S, up, field, pick, confirmBtn, undoToast } from './bits.js';
import { coverEl, tierBadge, tierPicker, progressText, bar } from './ui.js';

const today = () => keyOf(new Date());
const dmy = (k) => k ? fmtDate(fromKey(k)) : '';
const STEPS = { show: [[1, '+1 ep'], [3, '+3']], anime: [[1, '+1 ep'], [3, '+3']], manga: [[1, '+1 ch'], [5, '+5']], book: [[10, '+10 p'], [30, '+30']], game: [[0.5, '+30 min'], [1, '+1 h'], [2, '+2 h']] };
/** Flags: ♥ comfort, ↻ rewatchable, would recommend (separate from how much you enjoyed it). */
export function flagsEl(flags, onChange) {
  const f = { comfort: !!flags?.comfort, rewatch: !!flags?.rewatch, recommend: flags?.recommend || '' };
  const b = (on, label, title, fn) => h('button', { type: 'button', class: `flag ${on ? 'on' : ''}`, 'aria-pressed': String(on), title, onClick: fn }, label);
  const box = h('div', { class: 'flags' });
  const paint = () => box.replaceChildren(
    b(f.comfort, '♥ Comfort', 'A comfort pick: Sudachi offers it after nights', () => { f.comfort = !f.comfort; onChange({ ...f }); paint(); }),
    b(f.rewatch, '↻ Again-able', 'Would watch / read / play it again', () => { f.rewatch = !f.rewatch; onChange({ ...f }); paint(); }),
    h('span', { class: 'flag-rec' }, h('span', { class: 'tiny dim' }, 'Recommend?'), b(f.recommend === 'yes', '👍', 'Would recommend', () => { f.recommend = f.recommend === 'yes' ? '' : 'yes'; onChange({ ...f }); paint(); }), b(f.recommend === 'no', '👎', 'Would not recommend', () => { f.recommend = f.recommend === 'no' ? '' : 'no'; onChange({ ...f }); paint(); })));
  paint(); return box;
}
const titleBlock = (m) => h('div', { class: 'it-head' }, coverEl(m, 'lg'), h('div', { class: 'grow' },
  h('h2', { class: 'it-title' }, M.shown(m)),
  m.orig && m.en ? null : m.orig && M.norm(m.orig) !== M.norm(m.title) ? h('div', { class: 'small muted' }, m.orig) : null,
  h('div', { class: 'small muted' }, [M.kindOf(m.kind).emoji + ' ' + M.kindOf(m.kind).one, m.year || '', m.creator].filter(Boolean).join(' · ')),
  h('div', { class: 'row wrap it-st' }, h('span', { class: `stchip s-${m.status}` }, M.statusWord(m.kind, m.status)), tierBadge(m.score, { auto: m.auto, big: true, src: m.src }), progressText(m) ? h('span', { class: 'small' }, progressText(m)) : null),
  bar(m)));

/** The item sheet. */
export function openItem(id) {
  let m = S().media?.[id]; if (!m) return toast('That title is gone');
  const body = h('div', { class: 'it' }), { close } = ctx.sheet([body]);
  const set = (patch, msg) => { const before = S(); up(s => M.updateMedia(s, id, patch)); if (msg) undoToast(msg, before); paint(); };
  const paint = () => {
    m = S().media?.[id]; if (!m) { close(); return; }
    const acts = [];
    if (m.status === 'planned' || m.status === 'paused' || m.status === 'dropped') acts.push(h('button', { class: 'btn primary', onClick: () => { up(s => M.start(s, id)); ctx.cheer(); toast(`On the shelf: ${M.shown(m)}`, 'ok'); paint(); } }, m.status === 'planned' ? '▶ Start' : '▶ Back on the shelf'));
    if (m.status !== 'done') acts.push(h('button', { class: 'btn finish', onClick: () => { close(); finishSheet(id); } }, '✓ Finished'));
    if (m.status === 'done') acts.push(h('button', { class: 'btn', onClick: () => { const before = S(); up(s => M.again(s, id)); undoToast(`Back on the shelf for another ${m.kind === 'book' || m.kind === 'manga' ? 'read' : m.kind === 'game' ? 'play' : 'watch'}`, before); paint(); } }, '↻ Again'));
    if (m.status === 'doing') acts.push(h('button', { class: 'btn ghost', onClick: () => set({ status: 'paused' }, 'On hold') }, '⏸ On hold'), h('button', { class: 'btn ghost', onClick: () => set({ status: 'dropped' }, 'Dropped') }, '✕ Drop'));
    const steps = m.status === 'doing' && STEPS[m.kind] ? h('div', { class: 'card it-prog' }, h('div', { class: 'title' }, m.kind === 'game' ? 'Log a session' : 'Move it on'),
      h('div', { class: 'row wrap' }, m.kind !== 'game' ? h('button', { class: 'btn sm ghost', 'aria-label': 'One back', disabled: !(m.progress > 0), onClick: () => { up(s => M.updateMedia(s, id, { progress: Math.max(0, (m.progress || 0) - 1) })); paint(); } }, '−') : null,
        ...STEPS[m.kind].map(([n, l]) => h('button', { class: 'btn sm', onClick: (e) => { const r = M.logProgress(S(), id, { n }); up(() => r.state); if (r.finished) { close(); finishSheet(id); } else { ctx.cheer(e.currentTarget); paint(); } } }, l)),
        h('span', { class: 'grow' }), (() => { const inp = h('input', { type: 'number', min: '0', step: m.kind === 'game' ? '0.5' : '1', class: 'num', placeholder: m.kind === 'game' ? 'h' : 'to', 'aria-label': m.kind === 'game' ? 'Hours played' : 'Progress now' });
          return h('span', { class: 'row' }, inp, h('button', { class: 'btn sm', onClick: () => { if (inp.value === '') return; const r = m.kind === 'game' ? M.logProgress(S(), id, { n: +inp.value }) : M.logProgress(S(), id, { to: +inp.value }); up(() => r.state); if (r.finished) { close(); finishSheet(id); } else paint(); } }, 'Log')); })())) : null;
    const plays = M.finishesOf(m).filter(f => f.d || f.score);
    body.replaceChildren(titleBlock(m), h('div', { class: 'row wrap it-acts' }, ...acts), steps,
      h('div', { class: 'card' }, h('div', { class: 'title' }, m.auto ? `Your tier (converted from ${M.SRC_NAME[m.src] || m.src}: ${m.srcRating}${m.srcScale === 5 ? '★' : `/${m.srcScale}`} — tap to set your own)` : 'Your tier'),
        tierPicker(m.score, (sc) => { up(s => M.updateMedia(s, id, { score: sc, auto: false })); m = S().media[id]; body.querySelector('.it-st')?.replaceWith(titleBlock(m).querySelector('.it-st')); }),
        h('div', { style: { marginTop: '10px' } }, flagsEl(m.flags, (f) => up(s => M.updateMedia(s, id, { flags: f }))))),
      m.status === 'planned' ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'In the backlog'), pick([['want', 'Want to'], ['someday', 'Someday'], ['no', 'Not for me']], m.triage, (t) => set({ triage: t }))) : null,
      h('div', { class: 'card' }, h('div', { class: 'kv' },
        ...[['Status', M.statusWord(m.kind, m.status)], m.startedAt && ['Started', dmy(m.startedAt)], m.finishedAt && ['Finished', `${dmy(m.finishedAt)}${m.startedAt && m.finishedAt >= m.startedAt ? ` · took ${Math.round((fromKey(m.finishedAt) - fromKey(m.startedAt)) / 86400000) + 1} days` : ''}`],
          m.droppedAt && m.status === 'dropped' && ['Dropped', dmy(m.droppedAt)], plays.length > 1 && ['Finishes', plays.map(p => `${p.d ? dmy(p.d) : 'undated'}${p.score ? ` ${tierOf(p.score)?.id}` : ''}`).join(' · ')],
          M.minutesOf(m) && ['Time', `≈ ${fmtDur(M.minutesOf(m))}`], m.genres?.length && ['Genres', m.genres.join(', ')], m.pub && ['Public rating', `${m.pub}/10`], m.kind === 'game' && m.length && ['Length', `≈ ${m.length} h`],
          ['From', `${M.SRC_NAME[m.src] || m.src}${m.extId ? ` · ${m.extId}` : ''}`]].filter(Boolean).flatMap(([a, b]) => [h('b', {}, a), h('span', {}, String(b))]))),
      h('div', { class: 'card' }, h('div', { class: 'title' }, 'Note'), h('textarea', { class: 'note', rows: 3, 'data-nodirty': '1', placeholder: 'What you thought (only here, never sent to Citrus)', value: m.review || '', onChange: (e) => { up(s => M.updateMedia(s, id, { review: e.target.value })); toast('Saved', 'ok'); } })),
      (m.kind === 'book' || m.kind === 'manga') ? quotesCard(m, paint) : null,
      h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn ghost', onClick: () => { close(); editSheet(id); } }, '✎ Edit details'), h('span', { class: 'grow' }),
        confirmBtn('Delete', () => { const before = S(); up(s => M.deleteMedia(s, id)); close(); undoToast(`Deleted ${M.shown(m)}`, before); })));
  };
  paint();
}
function quotesCard(m, again) {
  const inp = h('textarea', { rows: 2, placeholder: 'A line worth keeping', 'data-nodirty': '1', 'aria-label': 'Quote' });
  return h('div', { class: 'card' }, h('div', { class: 'title' }, `Quotes${m.quotes?.length ? ` (${m.quotes.length})` : ''}`),
    ...(m.quotes || []).slice().reverse().slice(0, 12).map(q => h('div', { class: 'quote' }, h('div', { class: 'small' }, `“${q.t}”`), h('div', { class: 'tiny dim' }, [q.p ? `p. ${q.p}` : '', dmy(q.d)].filter(Boolean).join(' · '), h('button', { class: 'btn sm ghost', 'aria-label': 'Remove quote', onClick: () => { up(s => M.removeQuote(s, m.id, q.id)); again(); } }, '✕')))),
    inp, h('button', { class: 'btn sm', style: { marginTop: '6px' }, onClick: () => { if (!inp.value.trim()) return; up(s => M.addQuote(s, m.id, { text: inp.value, page: m.progress || 0 })); again(); } }, '＋ Keep it'));
}

/** Finishing: date (today), your tier, flags, a note. */
export function finishSheet(id) {
  const m = S().media?.[id]; if (!m) return;
  let score = m.auto ? 0 : m.score || 0, flags = { ...(m.flags || {}) };
  const date = h('input', { type: 'date', value: today(), max: today(), 'aria-label': 'Finished on' });
  const note = h('textarea', { rows: 2, placeholder: 'A line about it (optional)', value: m.review || '', 'aria-label': 'Note' });
  const again = (m.plays || []).length;
  const { close } = ctx.sheet([h('div', { class: 'fin-head' }, coverEl(m, 'md'), h('div', {}, h('div', { class: 'stk t-lime' }, again ? 'Finished again!' : 'Finished!'), h('h2', {}, M.shown(m)), m.startedAt ? h('div', { class: 'tiny dim' }, `Started ${dmy(m.startedAt)}`) : null)),
    field('Finished on', date),
    field(m.auto ? `Your tier (it had ${tierOf(m.score)?.id || '—'} from ${M.SRC_NAME[m.src] || m.src})` : 'Your tier', tierPicker(score, (v) => { score = v; })),
    field('', flagsEl(flags, (f) => { flags = f; })),
    field('Note', note),
    h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: (e) => {
      const before = S(); up(s => M.finish(s, id, { date: date.value || today(), score: score || (m.auto ? m.score : 0), flags, review: note.value }));
      if (score) up(s => M.updateMedia(s, id, { auto: false }));
      ctx.cheer(e.currentTarget, true); close(); undoToast(`✓ ${M.shown(m)}${score ? ` · ${tierOf(score)?.id}` : ''}`, before);
    } }, 'Save'), h('button', { class: 'btn ghost', onClick: () => close() }, 'Cancel'))]);
}

/** Add a title: kind, title (with a catalogue look-up), where it goes. prefill: {kind, status, title} */
export function addSheet(prefill = {}) {
  let kind = prefill.kind || 'movie', status = prefill.status || 'planned', score = 0, chosen = null, timer = null;
  const title = h('input', { type: 'text', placeholder: 'Title', value: prefill.title || '', 'aria-label': 'Title', autocomplete: 'off' });
  const creator = h('input', { type: 'text', placeholder: 'Author / director / studio (optional)', 'aria-label': 'Creator' });
  const total = h('input', { type: 'number', min: '0', placeholder: 'Episodes / pages / chapters', 'aria-label': 'Total', class: 'num' });
  const results = h('div', { class: 'lookup' }), tierBox = h('div', {});
  const look = () => { clearTimeout(timer); const q = title.value.trim(); chosen = null; if (q.length < 3 || !navigator.onLine) { results.replaceChildren(); return; }
    timer = setTimeout(async () => { results.replaceChildren(h('div', { class: 'tiny dim' }, 'Looking it up…')); try { const list = await C.searchAny(q, kind); if (title.value.trim() !== q) return;
      results.replaceChildren(...list.slice(0, 6).map(it => h('button', { type: 'button', class: 'lk', onClick: () => { chosen = it; title.value = it.orig && it.title !== it.orig ? M.composeTitle(it.orig, it.title) : it.title; if (it.creator) creator.value = it.creator; if (it.total) total.value = it.total; results.replaceChildren(h('div', { class: 'tiny ok' }, `✓ ${it.title}${it.year ? ` (${it.year})` : ''}`)); } },
        it.cover ? h('img', { src: it.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'lk-e' }, M.kindOf(kind).emoji), h('span', { class: 'grow' }, h('b', {}, it.title), h('small', {}, [it.year || '', it.creator, it.note].filter(Boolean).join(' · '))))));
      if (!list.length) results.replaceChildren(h('div', { class: 'tiny dim' }, 'Nothing found online. You can still add it.'));
    } catch { results.replaceChildren(h('div', { class: 'tiny dim' }, 'The catalogue did not answer. You can still add it.')); } }, 450); };
  title.addEventListener('input', look);
  const paintTier = () => tierBox.replaceChildren(status === 'done' ? field('Your tier', tierPicker(score, (v) => { score = v; })) : null);
  const save = () => {
    const t = title.value.trim(); if (!t) return toast('A title first', 'err');
    const f = { ...(chosen || {}), kind, title: t, creator: creator.value.trim() || chosen?.creator || '', total: +total.value || chosen?.total || 0, status, score, src: chosen?.src && chosen.src !== 'wikidata' ? chosen.src : 'manual', extId: chosen?.src && chosen.src !== 'wikidata' ? chosen.extId : '', triage: status === 'planned' ? 'want' : '' };
    if (chosen?.orig && chosen.title !== chosen.orig) { f.orig = chosen.orig; f.en = chosen.title; f.title = chosen.orig; }
    const dup = M.findMedia(S(), f); if (dup) { close(); toast(`Already in your library: ${M.shown(dup)}`); ctx.openItem(dup.id); return; }
    const before = S(); up(s => M.addMedia(s, f)); close(); undoToast(`Added ${t}`, before);
  };
  const { close } = ctx.sheet([h('h2', {}, 'Add a title'),
    field('Kind', pick(M.KINDS.map(k => [k.id, `${k.emoji} ${k.name}`, k.color]), kind, (v) => { kind = v; look(); })),
    field('Title', title, results),
    field('Where it goes', pick([['planned', 'Backlog'], ['doing', 'On the shelf'], ['done', 'Finished']], status, (v) => { status = v; paintTier(); })),
    tierBox, h('details', { class: 'adv' }, h('summary', { class: 'small' }, 'More details'), field('', creator), field('', total)),
    h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: save }, 'Add'), h('button', { class: 'btn ghost', onClick: () => close() }, 'Cancel'))]);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  paintTier(); if (prefill.title) look();
}

/** Edit a title's details. */
export function editSheet(id) {
  const m = S().media?.[id]; if (!m) return;
  const inp = (k, label, type = 'text', extra = {}) => h('input', { type, value: m[k] ?? '', 'aria-label': label, ...extra });
  const f = { title: inp('title', 'Title'), orig: inp('orig', 'Original title'), en: inp('en', 'English title'), creator: inp('creator', 'Creator'), year: inp('year', 'Year', 'number'), total: inp('total', 'Total', 'number'), runtime: inp('runtime', 'Minutes', 'number'), length: inp('length', 'Hours to finish', 'number'), cover: inp('cover', 'Cover image address', 'url'), genres: h('input', { type: 'text', value: (m.genres || []).join(', '), 'aria-label': 'Genres' }), startedAt: inp('startedAt', 'Started', 'date'), finishedAt: inp('finishedAt', 'Finished', 'date') };
  let kind = m.kind, status = m.status;
  const { close } = ctx.sheet([h('h2', {}, 'Edit details'),
    field('Kind', pick(M.KINDS.map(k => [k.id, `${k.emoji} ${k.name}`, k.color]), kind, (v) => { kind = v; })),
    field('Status', pick(Object.entries(M.STATUS), status, (v) => { status = v; })),
    field('Title', f.title), h('div', { class: 'grid2' }, field('Original-language title', f.orig), field('English title', f.en)), h('div', { class: 'tiny dim' }, 'With both, Sudachi shows “Original (English)”.'),
    field('By', f.creator), h('div', { class: 'grid2' }, field('Year', f.year), field(m.kind === 'game' ? 'Hours played (Steam fills it)' : 'Episodes / pages / chapters', f.total)),
    h('div', { class: 'grid2' }, field(m.kind === 'movie' ? 'Runtime (min)' : 'Minutes per episode', f.runtime), field('Hours to finish (games)', f.length)),
    h('div', { class: 'grid2' }, field('Started', f.startedAt), field('Finished', f.finishedAt)),
    field('Genres (comma between)', f.genres), field('Cover image address', f.cover),
    h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: () => {
      if (!f.title.value.trim()) return toast('A title is needed', 'err');
      const patch = { kind, status, title: f.title.value.trim(), orig: f.orig.value.trim(), en: f.en.value.trim(), creator: f.creator.value.trim(), year: +f.year.value || 0, total: +f.total.value || 0, runtime: +f.runtime.value || 0, length: +f.length.value || 0, cover: f.cover.value.trim(), genres: f.genres.value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 8), startedAt: f.startedAt.value, finishedAt: f.finishedAt.value };
      const before = S(); up(s => M.updateMedia(s, id, patch)); close(); undoToast('Saved', before);
    } }, 'Save'), h('button', { class: 'btn ghost', onClick: () => close() }, 'Cancel'))]);
}

/** A quick "what did you finish?" for the log button: pick from the shelf or add a new finished title. */
export function logSheet() {
  const shelf = M.nowPlaying(S());
  const { close } = ctx.sheet([h('h2', {}, 'Log something'),
    shelf.length ? h('div', { class: 'small muted' }, 'From the shelf:') : null,
    h('div', { class: 'list' }, ...shelf.slice(0, 10).map(m => h('div', { class: 'lrow static' }, coverEl(m, 'sm'), h('div', { class: 'grow' }, h('div', { class: 'lr-t' }, M.shown(m)), h('div', { class: 'lr-m' }, progressText(m) || M.statusWord(m.kind, m.status))),
      STEPS[m.kind] ? h('button', { class: 'btn sm', onClick: (e) => { const [n] = STEPS[m.kind][0]; const r = M.logProgress(S(), m.id, { n }); up(() => r.state); if (r.finished) { close(); finishSheet(m.id); } else { ctx.cheer(e.currentTarget); toast(`${STEPS[m.kind][0][1]} · ${M.shown(m)}`, 'ok'); } } }, STEPS[m.kind][0][1]) : null,
      h('button', { class: 'btn sm finish', onClick: () => { close(); finishSheet(m.id); } }, '✓')))),
    h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: () => { close(); addSheet({ status: 'done' }); } }, '＋ I finished something new'), h('button', { class: 'btn', onClick: () => { close(); addSheet({ status: 'doing' }); } }, '▶ Started something'))]);
}
