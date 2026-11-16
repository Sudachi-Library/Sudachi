// Review: every month and year as a Wrapped-style story (tap through, full screen) plus the deeper stats — counts and hours by
// kind, how your tiers spread, best of the period, genres, after nights, streaks, what you dropped — your taste in plain
// words, the rating scale itself, and a year poster to save and share.
import { h, toast, keyOf, MONTHS } from './util.js';
import * as M from './media.js';
import * as RV from './review.js';
import { TIERS, tierOf, spread, convertAll } from './tiers.js';
import { ctx, S, up, plural } from './bits.js';
import { coverEl, tierBadge, sticker, empty } from './ui.js';

const rt = { mode: 'month', key: '' };
export function reviewPart(p) { if (/^\d{4}$/.test(p)) { rt.mode = 'year'; rt.key = p; } else if (/^\d{4}-\d\d$/.test(p)) { rt.mode = 'month'; rt.key = p; } else if (p === 'year') rt.mode = 'year'; else if (p === 'story') setTimeout(() => playStory(currentReview()), 200); }
const nowKey = (mode) => mode === 'year' ? String(new Date().getFullYear()) : keyOf(new Date()).slice(0, 7);
function keys() { const l = RV.periodsWithData(S(), rt.mode), cur = nowKey(rt.mode); return [...new Set([cur, ...l])].sort().reverse(); }
function currentReview() { const k = rt.key && (rt.mode === 'year' ? /^\d{4}$/ : /^\d{4}-\d\d$/).test(rt.key) ? rt.key : nowKey(rt.mode); return RV.review(S(), k, new Date()); }

// ───────────────────────────── the story (full screen, tap or arrow keys to move, Esc to close)
export function playStory(r) {
  const slides = RV.story(r); let i = 0, timer = null;
  const bars = h('div', { class: 'st-bars' }, ...slides.map(() => h('i', {}, h('b'))));
  const stage = h('div', { class: 'st-stage', 'aria-live': 'polite' });
  const close = () => { clearTimeout(timer); wrap.remove(); document.removeEventListener('keydown', key, true); };
  const go = (n) => { i = Math.max(0, Math.min(slides.length - 1, n)); paint(); };
  const key = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); i === slides.length - 1 ? close() : go(i + 1); } else if (e.key === 'ArrowLeft') go(i - 1); };
  const paint = () => {
    const sl = slides[i]; clearTimeout(timer);
    [...bars.children].forEach((b, j) => { b.className = j < i ? 'done' : j === i ? 'now' : ''; });
    wrap.dataset.tone = sl.tone;
    stage.replaceChildren(h('div', { class: `st-slide s-${sl.id}` },
      h('div', { class: 'st-kicker' }, sl.kicker), sl.cover ? h('img', { class: 'st-cover', src: sl.cover, alt: '', referrerpolicy: 'no-referrer', onError: (e) => e.target.remove() }) : null,
      h('div', { class: `st-big ${String(sl.big).length > 18 ? 'long' : ''}` }, sl.big), sl.sub ? h('div', { class: 'st-sub' }, sl.sub) : null,
      sl.items?.length ? h('div', { class: 'st-items' }, ...sl.items.map((t, j) => h('span', { class: 'st-item', style: { '--d': `${j * 80}ms` } }, t))) : null,
      sl.bars ? h('div', { class: 'st-months' }, ...sl.bars.map((n, j) => h('span', { title: `${MONTHS[j]}: ${n}`, style: { '--v': String(n / Math.max(1, ...sl.bars)) } }, h('i'), h('small', {}, MONTHS[j][0])))) : null,
      sl.poster ? h('button', { class: 'btn primary', onClick: (e) => { e.stopPropagation(); savePoster(r); } }, '⬇ Save the poster') : null));
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && i < slides.length - 1) timer = setTimeout(() => go(i + 1), 6500);
  };
  const wrap = h('div', { class: 'story', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${r.label} in review`, onClick: (e) => { if (e.target.closest('.st-x, .btn')) return; const x = e.clientX / innerWidth; if (x < 0.3) go(i - 1); else if (i === slides.length - 1) close(); else go(i + 1); } },
    bars, h('button', { class: 'st-x', 'aria-label': 'Close', onClick: close }, '✕'), stage, h('div', { class: 'st-hint tiny' }, 'tap → next · ← back · Esc close'));
  document.body.append(wrap); document.addEventListener('keydown', key, true); paint();
}

// ───────────────────────────── the year poster: a PNG drawn on a canvas (titles as stickers, no outside images, so it saves)
export function posterCanvas(r, size = 1080) {
  const c = document.createElement('canvas'); c.width = size; c.height = Math.round(size * 1.35); const g = c.getContext('2d'), W = c.width, H = c.height;
  const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, '#12002a'); grd.addColorStop(0.55, '#0b0b16'); grd.addColorStop(1, '#00262b'); g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.08; g.fillStyle = '#fff'; for (let y = 0; y < H; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < W; x += 6) g.fillRect(x, y, 2, 2); g.globalAlpha = 1;   // halftone
  const font = (w, px) => `${w} ${px}px "Bricolage Grotesque", "Space Grotesk", system-ui, sans-serif`;
  g.fillStyle = '#b8f03c'; g.font = font(800, size * 0.05); g.fillText('SUDACHI', W * 0.07, H * 0.075);
  g.fillStyle = '#ff2e88'; g.font = font(900, size * 0.2); g.fillText(r.label, W * 0.06, H * 0.22);
  g.fillStyle = '#fff'; g.font = font(700, size * 0.042); g.fillText(`${r.n} finished · ${r.hours}h · ${r.activeDays} days`, W * 0.07, H * 0.28);
  const tops = (r.best.length ? r.best : r.finished).slice(0, 9), cols = ['#b8f03c', '#ff2e88', '#21d4fd', '#ff7a1a', '#a77bff', '#ffb000'];
  tops.forEach((m, k) => {
    const cx = W * (0.08 + (k % 3) * 0.3), cy = H * (0.34 + Math.floor(k / 3) * 0.18), w = W * 0.26, hh = H * 0.15, tilt = ((k * 37) % 9 - 4) * 0.012;
    g.save(); g.translate(cx + w / 2, cy + hh / 2); g.rotate(tilt); g.fillStyle = '#000'; g.fillRect(-w / 2 + 8, -hh / 2 + 8, w, hh); g.fillStyle = cols[k % cols.length]; g.fillRect(-w / 2, -hh / 2, w, hh);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(-w * 0.18, -hh / 2 - 10, w * 0.36, 22);   // tape
    g.fillStyle = '#0b0b16'; g.font = font(900, size * 0.05); g.fillText(tierOf(m.finishScore || m.score)?.id || '✦', -w / 2 + 16, -hh / 2 + size * 0.06);
    g.font = font(800, size * 0.027); const words = M.shown(m).split(/\s+/); let line = '', y = -hh / 2 + size * 0.1, n = 0;
    for (const wd of words) { const t = line ? `${line} ${wd}` : wd; if (g.measureText(t).width > w - 30 && line) { g.fillText(line, -w / 2 + 16, y); line = wd; y += size * 0.032; if (++n >= 2) { line += '…'; break; } } else line = t; }
    g.fillText(line, -w / 2 + 16, y); g.restore();
  });
  g.fillStyle = '#21d4fd'; g.font = font(700, size * 0.03); g.fillText(r.genres.slice(0, 3).map(x => x[0]).join(' · ') || 'a year of good stuff', W * 0.07, H * 0.93);
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = font(600, size * 0.022); g.fillText('made with Sudachi · the citrus family', W * 0.07, H * 0.965);
  return c;
}
function savePoster(r) {
  try { const c = posterCanvas(r); c.toBlob((b) => { if (!b) return toast('Could not draw the poster', 'err'); const a = h('a', { href: URL.createObjectURL(b), download: `sudachi-${r.key}.png` }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); toast('Poster saved', 'ok'); }, 'image/png'); }
  catch (e) { toast(e.message, 'err'); }
}

// ───────────────────────────── the stats page
const barsEl = (rows, max = Math.max(1, ...rows.map(r => r[1]))) => h('div', { class: 'hbars' }, ...rows.map(([l, n, color]) => h('div', { class: 'hb' }, h('span', { class: 'hb-l small' }, l), h('span', { class: 'hb-t' }, h('i', { style: { width: `${Math.round(n / max * 100)}%`, background: color || 'var(--acc)' } })), h('b', { class: 'small' }, String(n)))));
function scaleCard() {
  const s = S(), mine = Object.values(s.media || {}).filter(m => m.score > 0), sp = spread(mine), sites = convertAll(s).sites, auto = mine.filter(m => m.auto).length;
  return h('details', { class: 'card scale' }, h('summary', {}, h('b', {}, 'Your scale'), h('small', { class: 'dim' }, ` · ${mine.length.toLocaleString('en')} rated, ${auto.toLocaleString('en')} converted`)),
    h('div', { class: 'sc-rows' }, ...TIERS.map(t => h('div', { class: 'sc-row' }, h('span', { class: 'tier big', style: { '--c': t.color } }, t.id), h('span', { class: 'grow small' }, t.means), h('span', { class: 'tiny dim' }, t.score === 4.5 ? '4–5' : t.score === 2 ? '1–3' : String(t.score)), h('b', { class: 'small' }, String(sp[t.id]))))),
    h('div', { class: 'tiny dim', style: { marginTop: '8px' } }, 'Extras: ♥ comfort, ↻ again-able, and 👍/👎 would recommend (separate from how much you enjoyed it).'),
    Object.keys(sites).length ? h('div', { class: 'tiny', style: { marginTop: '8px' } }, 'Converted from other sites by where each rating sits among your own ratings there (top 5% → S, next 10% A+, next 15% A, next 20% B+, next 20% B, next 15% C, next 10% D, bottom 5% F): ', Object.entries(sites).map(([k, v]) => `${M.SRC_NAME[k] || k} ${v.n} (${v.mode === 'percentile' ? 'by percentile' : 'too few: in proportion'})`).join(' · '), '. Tap a title and pick a tier to make it yours.') : null,
    h('button', { class: 'btn sm', style: { marginTop: '8px' }, onClick: () => { const r = convertAll(S()); up(() => r.state); toast(r.changed ? `${plural(r.changed, 'converted tier')} updated` : 'All converted tiers are up to date', 'ok'); } }, '↻ Recompute converted tiers'));
}
export function renderReview() {
  const s = S(); if (!Object.keys(s.media || {}).length) return [h('h1', {}, 'Review'), empty('Finish something and your first month in review appears here.')];
  const ks = keys(); if (!ks.includes(rt.key)) rt.key = ks[0];
  const r = currentReview(), w = r.w;
  const head = h('div', { class: 'lib-head' }, h('h1', {}, 'Review'), h('div', { class: 'seg', role: 'group', 'aria-label': 'Months or years' }, ...[['month', 'Months'], ['year', 'Years']].map(([m, l]) => h('button', { class: rt.mode === m ? 'active' : '', 'aria-pressed': String(rt.mode === m), onClick: () => { rt.mode = m; rt.key = ''; ctx.render(); } }, l))),
    h('select', { class: 'filter right', 'aria-label': 'Which period', onChange: (e) => { rt.key = e.target.value; ctx.render(); } }, ...ks.map(k => h('option', { value: k, selected: k === r.key }, RV.periodOf(k).label))));
  const hero = h('div', { class: 'card hero rv-hero' }, sticker(r.kind === 'year' ? 'Year in review' : 'Month in review', 'pink'), h('div', { class: 'rv-label' }, r.label),
    h('div', { class: 'rv-stats' }, ...[[r.n, 'finished'], [`${r.hours}h`, 'spent'], [r.activeDays, 'active days'], [r.streak, 'day run']].map(([b, l]) => h('div', {}, h('b', {}, String(b)), h('small', {}, l)))),
    r.prevN || r.n ? h('div', { class: 'tiny dim' }, `${RV.periodOf(r.prev).label}: ${r.prevN} finished · ${r.prevHours}h`) : null,
    h('div', { class: 'row wrap', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onClick: () => playStory(r) }, '▶ Play the story'), r.kind === 'year' ? h('button', { class: 'btn', onClick: () => savePoster(r) }, '⬇ Year poster') : h('button', { class: 'btn ghost', onClick: () => { rt.mode = 'year'; rt.key = r.key.slice(0, 4); ctx.render(); } }, `${r.key.slice(0, 4)} so far →`)));
  const kindRows = r.byKind.map(x => [`${x.kind.emoji} ${x.kind.name}`, x.n, x.kind.color]);
  const tierRows = TIERS.filter(t => r.spread[t.id]).map(t => [t.id, r.spread[t.id], t.color]);
  const cards = [
    r.best.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, r.kind === 'year' ? 'Best of the year' : 'Best of the month'), h('div', { class: 'best' }, ...r.best.map((m, i) => h('button', { class: `bst ${i === 0 ? 'first' : ''}`, onClick: () => ctx.openItem(m.id) }, coverEl(m, i === 0 ? 'md' : 'sm'), h('div', { class: 'grow' }, h('div', { class: 'small' }, h('b', {}, M.shown(m))), h('div', { class: 'tiny dim' }, `${M.kindOf(m.kind).one}${m.again ? ' · again' : ''}`)), tierBadge(m.finishScore))))) : null,
    kindRows.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Finished by kind'), barsEl(kindRows), h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, [w.eps && plural(w.eps, 'episode'), w.ch && `${w.ch} chapters`, w.pages && `${w.pages.toLocaleString('en')} pages`, w.gameMinutes >= 60 && `${Math.round(w.gameMinutes / 60)}h of games`].filter(Boolean).join(' · '))) : null,
    tierRows.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, `How you rated${r.avg != null ? ` · average ${tierOf(r.avg)?.id}` : ''}`), barsEl(tierRows)) : null,
    r.genres.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'You leaned'), h('div', { class: 'chips' }, ...r.genres.map(([g, n]) => h('span', { class: 'chip' }, `${g} ${n}`))), r.makers.length ? h('div', { class: 'tiny dim', style: { marginTop: '8px' } }, `Names you came back to: ${r.makers.map(x => x[0]).join(', ')}`) : null) : null,
    h('div', { class: 'card' }, h('div', { class: 'title' }, 'Habits'), h('div', { class: 'kv' }, ...[
      ['After nights', r.afterNights ? `${plural(r.afterNights, 'morning')} after a night with something logged${r.afterTitles.length ? `: ${r.afterTitles.join(', ')}` : ''}` : ctx.hasShifts() ? 'nothing logged after a night' : 'needs your shifts from Mandarin'],
      ['Longest run', `${plural(r.streak, 'day')} in a row`], r.busiestDay && ['Your day', `${r.busiestDay}s`], ['Again', r.again ? plural(r.again, 'rewatch / reread', 'rewatches / rereads') : 'none'],
      ['Dropped', r.dropped.length ? `${r.dropped.length} (${Math.round(r.abandon * 100)}% of what you ended)` : 'nothing'],
    ].filter(Boolean).flatMap(([a, b]) => [h('b', {}, a), h('span', {}, b)]))),
    r.months ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Month by month'), h('div', { class: 'mbars' }, ...r.months.map((n, i) => h('button', { class: 'mb', title: `${MONTHS[i]}: ${n}`, 'aria-label': `${MONTHS[i]}: ${n} finished`, onClick: () => { rt.mode = 'month'; rt.key = `${r.key}-${String(i + 1).padStart(2, '0')}`; ctx.render(); } }, h('i', { style: { '--v': String(n / Math.max(1, ...r.months)) } }), h('small', {}, MONTHS[i][0]))))) : null,
    r.finished.length ? h('details', { class: 'card' }, h('summary', { class: 'small' }, `Everything finished (${r.finished.length})`), h('div', { class: 'list' }, ...r.finished.map(m => h('button', { class: 'lrow', onClick: () => ctx.openItem(m.id) }, coverEl(m, 'xs'), h('div', { class: 'grow small' }, M.shown(m), h('span', { class: 'dim' }, ` · ${m.finishedOn.slice(8)}/${m.finishedOn.slice(5, 7)}${m.again ? ' · again' : ''}`)), tierBadge(m.finishScore))))) : null,
    h('div', { class: 'card' }, h('div', { class: 'title' }, 'Your taste, all time'), ...M.feedbackOf(s, null).map(t => h('p', { class: 'small fb' }, t))),
    scaleCard(),
  ];
  return [head, hero, ...cards];
}
