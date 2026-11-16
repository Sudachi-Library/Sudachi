// Bringing lists in: Citrus's Library (once), IMDb (rated, watchlist, a dropped list), Goodreads, MyAnimeList (straight from
// your public list through the relay, or the export file), Steam (through the relay, or a pasted games list). Every import
// shows what it will do before anything is saved, and has Undo. Ratings from these sites become tiers by percentile.
import { h, toast, keyOf, fmtDate, fromKey } from './util.js';
import * as M from './media.js';
import * as RL from './relay.js';
import { ctx, S, up, field, pick, undoToast, plural } from './bits.js';

const relayUrl = () => S().meta?.relay || '';
const SOURCES = [
  ['citrus', '🍊', 'Citrus', 'Your Library from Citrus Maxima, once'],
  ['imdb', '🎬', 'IMDb', 'Ratings, watchlist or a dropped list (.csv)'],
  ['goodreads', '📚', 'Goodreads', 'Library export (.csv)'],
  ['mal', '🍥', 'MyAnimeList', 'Your public list, or the export (.xml / .xml.gz)'],
  ['steam', '🎮', 'Steam', 'Games, hours played, achievements'],
];
export function importSheet(which = '') {
  if (which) return sourceSheet(which);
  const { close } = ctx.sheet([h('h2', {}, 'Import'), h('div', { class: 'small muted' }, 'Bring your lists in. Nothing is saved until you see what it will do, and every import can be undone. Ratings from other sites become your tiers by percentile (Settings › Your scale).'),
    h('div', { class: 'srcs' }, ...SOURCES.map(([id, e, name, sub]) => h('button', { class: 'src', onClick: () => { close(); if (id === 'citrus') ctx.migrateNow(); else sourceSheet(id); } }, h('span', { class: 'src-e' }, e), h('b', {}, name), h('small', {}, sub))))]);
}
const fileBtn = (accept, label, onText) => { const inp = h('input', { type: 'file', accept, style: { display: 'none' }, onChange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const text = /\.gz$/i.test(f.name) ? await RL.gunzipText(f) : await f.text(); onText(text, f.name); } catch (err) { toast(err.message, 'err'); } } }); return h('span', {}, inp, h('button', { class: 'btn primary', onClick: () => inp.click() }, label)); };
function sourceSheet(id) {
  const parts = [];
  if (id === 'imdb') {
    let mode = 'done';
    parts.push(h('h2', {}, '🎬 IMDb'), h('ol', { class: 'small steps' }, h('li', {}, 'On imdb.com open Your ratings (or your Watchlist, or a list of what you dropped).'), h('li', {}, 'Tap ⋯ › Export. IMDb emails or downloads a .csv.'), h('li', {}, 'Choose what it is below, then the file.')),
      field('This file is', pick([['done', 'Rated / watched'], ['planned', 'Watchlist'], ['dropped', 'Dropped list'], ['auto', 'Mixed (rated → watched)']], mode, (v) => { mode = v; })),
      h('div', { class: 'row wrap sh-foot' }, fileBtn('.csv,text/csv', 'Choose the .csv', (t, name) => { const r = M.parseExport(t, { mode }); if (r.error) return toast(r.error, 'err'); preview(r, name, { dropped: mode === 'dropped' }); })));
  } else if (id === 'goodreads') {
    parts.push(h('h2', {}, '📚 Goodreads'), h('ol', { class: 'small steps' }, h('li', {}, 'goodreads.com › My Books › Import and export (at the bottom of the left column).'), h('li', {}, 'Export library, wait a moment, then download the .csv.')),
      h('div', { class: 'row wrap sh-foot' }, fileBtn('.csv,text/csv', 'Choose the .csv', (t, name) => { const r = M.parseExport(t); if (r.error) return toast(r.error, 'err'); preview(r, name); })));
  } else if (id === 'mal') {
    const user = h('input', { type: 'text', value: S().meta?.mal?.user || '', placeholder: 'Your MyAnimeList username', 'aria-label': 'MyAnimeList username', autocomplete: 'off' });
    parts.push(h('h2', {}, '🍥 MyAnimeList'), h('div', { class: 'small muted' }, 'Straight from your list, no file needed: Sudachi asks your relay, which reads your public anime and manga lists.'),
      field('Username', user),
      relayUrl() ? h('button', { class: 'btn primary', onClick: async (e) => { const u = user.value.trim(); if (!u) return toast('Your username first', 'err'); e.target.disabled = true; e.target.textContent = 'Reading your lists…'; try { const j = await RL.mal(relayUrl(), u); up(s => M.setMeta(s, { mal: { ...(s.meta?.mal || {}), user: u, at: Date.now() } })); const r = M.parseMALList(j.mal); if (r.error) throw new Error(r.error); preview(r, `${u} on MyAnimeList`, { sync: true }); } catch (err) { toast(err.message, 'err'); e.target.disabled = false; e.target.textContent = 'Import from MyAnimeList'; } } }, 'Import from MyAnimeList')
        : h('div', { class: 'card warn small' }, 'Set up the relay first (Settings › Steam & MyAnimeList, about five minutes). Or use the export file below.', h('button', { class: 'btn sm', style: { marginLeft: '8px' }, onClick: () => ctx.go('more', 'relay') }, 'Set it up')),
      h('details', { class: 'adv' }, h('summary', { class: 'small' }, 'Or the export file'), h('ol', { class: 'small steps' }, h('li', {}, 'myanimelist.net › Profile › Export (anime and manga separately).'), h('li', {}, 'Download the .xml.gz and choose it here (no need to unpack).')),
        fileBtn('.xml,.gz,application/gzip,text/xml', 'Choose the file', (t, name) => { const r = M.parseExport(t); if (r.error) return toast(r.error, 'err'); preview(r, name, { sync: true }); })));
  } else if (id === 'steam') {
    const who = h('input', { type: 'text', value: S().meta?.steam?.id || '', placeholder: 'SteamID64 (17 digits) or your profile’s custom name', 'aria-label': 'Steam profile', autocomplete: 'off' });
    const paste = h('textarea', { rows: 4, placeholder: 'Paste the games-list XML or GetOwnedGames JSON', 'aria-label': 'Paste from Steam' });
    parts.push(h('h2', {}, '🎮 Steam'), h('div', { class: 'small muted' }, 'Your library, hours played, last played and achievements, through your relay. Your profile and Game details must be Public. Each sync after the first logs the time you played since, so “hours played this week” is real.'),
      field('Steam profile', who),
      relayUrl() ? h('button', { class: 'btn primary', onClick: async (e) => { e.target.disabled = true; e.target.textContent = 'Asking Steam…'; try { await steamSync(who.value.trim(), { preview: true }); } catch (err) { toast(err.message, 'err'); } e.target.disabled = false; e.target.textContent = 'Import from Steam'; } }, 'Import from Steam')
        : h('div', { class: 'card warn small' }, 'Set up the relay first (Settings › Steam & MyAnimeList).', h('button', { class: 'btn sm', style: { marginLeft: '8px' }, onClick: () => ctx.go('more', 'relay') }, 'Set it up')),
      h('details', { class: 'adv' }, h('summary', { class: 'small' }, 'Or paste it'), paste, h('button', { class: 'btn sm', style: { marginTop: '6px' }, onClick: () => { const r = M.parseSteam(paste.value); if (r.error) return toast(r.error, 'err'); preview(r, 'Steam (pasted)', { sync: true, steam: true }); } }, 'Read it')));
  }
  const { close } = ctx.sheet(parts); sourceSheet.close = close;
}
/** Steam through the relay. preview: show the import sheet first (first import); otherwise apply straight away (a later sync). */
export async function steamSync(who = '', { preview: show = false } = {}) {
  const id = who || S().meta?.steam?.id; if (!id) throw new Error('Your Steam profile first');
  const j = await RL.steam(relayUrl(), id), r = M.parseSteam(JSON.stringify(j)); if (r.error) throw new Error(r.error);
  up(s => M.setMeta(s, { steam: { ...(s.meta?.steam || {}), id, sid: j.steam?.id || '' } }));
  if (show || !S().meta?.steam?.last) return preview(r, `Steam · ${id}`, { sync: true, steam: true });
  return applyImport(r.items, { sync: true, steam: true, quiet: true });
}
function applyImport(items, opts) {
  const before = S(); let res = M.upsertMany(S(), items, opts), st = res.state, played = [];
  if (opts.steam) { const last = before.meta?.steam?.last; const d = M.steamDeltas(st, items, last || Object.fromEntries(items.map(i => [i.extId, i.minutes])), keyOf(new Date())); st = M.setMeta(d.state, { steam: { ...(st.meta?.steam || {}), last: d.last, at: Date.now() } }); played = last ? d.played : []; }
  up(() => st);
  const mins = played.reduce((a, p) => a + p.minutes, 0);
  const msg = `${res.added} added · ${res.updated} updated${res.skipped ? ` · ${res.skipped} unchanged` : ''}${mins ? ` · ${Math.round(mins / 6) / 10}h played since last time` : ''}`;
  if (!opts.quiet || res.added || res.updated || mins) undoToast(msg, before);
  if (!opts.quiet) ctx.cheer();
  return { ...res, played };
}
function preview(r, name, opts = {}) {
  try { sourceSheet.close?.(); } catch {}
  const sm = M.summariseImport(r.items), s = S(), already = r.items.filter(i => M.findMedia(s, i)).length;
  let sync = !!opts.sync;
  const kinds = sm.kinds.map(([k, n]) => `${M.kindOf(k).emoji} ${n}`).join(' · ');
  const rows = [['Rows', `${sm.n.toLocaleString('en')} (${kinds})`], ['Finished', `${sm.done}${sm.undated ? ` (${sm.undated} without a date: kept undated)` : ''}`], sm.doing && ['On the go', sm.doing], sm.planned && ['Backlog', sm.planned], sm.paused && ['On hold', sm.paused], sm.dropped && ['Dropped', sm.dropped],
    sm.rated && ['Rated', `${sm.rated}: they become tiers by percentile`], sm.from && ['Dates', `${fmtDate(fromKey(sm.from))} → ${fmtDate(fromKey(sm.to))}`], ['Already in Sudachi', `${already} (filled in, your own tiers and statuses kept)`]].filter(Boolean);
  const { close } = ctx.sheet([h('h2', {}, `Import from ${r.source}?`), h('div', { class: 'small muted' }, name),
    h('div', { class: 'kv', style: { marginTop: '10px' } }, ...rows.flatMap(([a, b]) => [h('b', {}, a), h('span', {}, String(b))])),
    h('div', { class: 'imp-sample' }, ...r.items.slice(0, 6).map(i => h('div', { class: 'tiny' }, `${M.kindOf(i.kind).emoji} ${i.orig && i.en ? M.composeTitle(i.orig, i.en) : i.title} · ${M.statusWord(i.kind, i.status)}${i.srcRating ? ` · ${i.srcRating}${i.srcScale === 5 ? '★' : `/${i.srcScale}`}` : ''}`))),
    opts.steam ? h('div', { class: 'tiny dim' }, `Steam says what you own and played, not what you finished: games under ${M.LOW_PLAY / 60}h go to the Backlog pile to sort, ones played in the last two weeks onto the shelf, the rest On hold. Mark what you finished with ✓.`) : null,
    h('label', { class: 'row small', style: { marginTop: '10px' } }, h('input', { type: 'checkbox', checked: sync, onChange: (e) => { sync = e.target.checked; } }), `${r.source} decides the status of titles that came from it (your own tiers are still kept)`),
    h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: () => { close(); const res = applyImport(r.items, { ...opts, sync }); if (r.source === 'IMDb' && M.needsEnglish(S()).length) setTimeout(() => englishOffer(), 600); return res; } }, `Import ${sm.n.toLocaleString('en')}`), h('button', { class: 'btn ghost', onClick: () => close() }, 'Cancel'))]);
}
/** Films imported under their original title: look the English ones up (Wikidata) so they show as "Original (English)". */
export function englishOffer() {
  const n = M.needsEnglish(S()).length; if (!n) return toast('All films already checked');
  const bar = h('div', { class: 'pbar' }, h('i', { style: { width: '0%' } })), msg = h('div', { class: 'small muted' }, `${plural(n, 'film')} from IMDb have only their original title. Sudachi can look up the English titles on Wikidata (free) and show them as “Original (English)” when they differ.`);
  const { close } = ctx.sheet([h('h2', {}, 'English titles'), msg, bar, h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: async (e) => { e.target.disabled = true; try { const ids = M.needsEnglish(S()).map(m => m.extId); const res = await M.fetchEnglishTitles(ids, { onProgress: (a, b) => { bar.firstChild.style.width = `${Math.round(a / b * 100)}%`; } }); const before = S(), r = M.applyEnglish(S(), res); up(() => r.state); close(); undoToast(`${plural(r.named, 'English title')} added`, before); } catch (err) { toast(err.message, 'err'); e.target.disabled = false; } } }, 'Look them up'), h('button', { class: 'btn ghost', onClick: () => close() }, 'Not now'))]);
}
