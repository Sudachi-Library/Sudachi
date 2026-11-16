// Online catalogues for looking things up and for suggestions beyond your own backlog: AniList (anime, manga), Open Library and
// Google Books (books). All free, no key, CORS-enabled. Ported from Citrus Maxima's media.js; scores are the S–F tiers.
import { mediaList, norm } from './media.js';
import { tierText } from './tiers.js';

const rec = (o) => Object.values(o || {});

// ───────────────────────────── AniList (public GraphQL, CORS-enabled, no key)
const ANI = 'https://graphql.anilist.co';
async function anilist(query, variables) {
  const r = await fetch(ANI, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => ({})); if (j.errors?.length) throw new Error(j.errors[0].message === 'Private User' ? 'That AniList profile is private' : j.errors[0].message || 'AniList error'); if (!r.ok) throw new Error(`AniList ${r.status}`);
  return j.data;
}
export async function searchAnime(q, kind = 'anime') {
  const d = await anilist(`query($q:String){Page(perPage:8){media(search:$q,type:${kind === 'manga' ? 'MANGA' : 'ANIME'},sort:SEARCH_MATCH){id idMal title{romaji english} episodes chapters volumes seasonYear startDate{year} genres coverImage{medium}}}}`, { q });
  return (d.Page?.media || []).map(m => ({ kind, title: m.title.english || m.title.romaji, orig: m.title.english && m.title.romaji ? m.title.romaji : '', malId: m.idMal ? String(m.idMal) : '', year: m.seasonYear || m.startDate?.year || 0, total: (kind === 'manga' ? m.chapters || m.volumes : m.episodes) || 0, genres: m.genres || [], cover: m.coverImage?.medium || '', src: 'anilist', extId: m.id }));
}
export async function animeSuggestions(s, dismissed = [], kind = 'anime') {
  const top = rec(s.media).filter(m => m.kind === kind && (m.src === 'anilist' || m.src === 'mal') && m.extId && m.status === 'done' && m.score >= 8).sort((a, b) => b.score - a.score).slice(0, 5);
  const mine = rec(s.media).filter(m => m.kind === kind), have = new Set(mine.flatMap(m => [norm(m.title), norm(m.orig)]).filter(Boolean)), mals = new Set(mine.map(m => m.malId).filter(Boolean)), seen = new Set(), out = [];
  for (const m of top) {
    let d; try { d = await anilist(`query($id:Int){Media(${m.src === 'mal' ? 'idMal' : 'id'}:$id,type:${kind === 'manga' ? 'MANGA' : 'ANIME'}){recommendations(perPage:6,sort:RATING_DESC){nodes{rating mediaRecommendation{id idMal title{romaji english} episodes chapters volumes seasonYear startDate{year} genres coverImage{medium} averageScore}}}}}`, { id: +m.extId }); } catch { continue; }
    for (const n of d.Media?.recommendations?.nodes || []) {
      const r = n.mediaRecommendation; if (!r) continue; const title = r.title.english || r.title.romaji;
      if (have.has(norm(title)) || (r.title.romaji && have.has(norm(r.title.romaji))) || (r.idMal && mals.has(String(r.idMal))) || seen.has(r.id) || dismissed.includes(`anilist:${r.id}`)) continue; seen.add(r.id);
      out.push({ key: `anilist:${r.id}`, item: { kind, title, orig: r.title.english && r.title.romaji ? r.title.romaji : '', malId: r.idMal ? String(r.idMal) : '', year: r.seasonYear || r.startDate?.year || 0, total: (kind === 'manga' ? r.chapters || r.volumes : r.episodes) || 0, genres: r.genres || [], cover: r.coverImage?.medium || '', src: 'anilist', extId: r.id, status: 'planned' }, reason: `Because ${m.title} got a ${tierText(m.score)}`, score: r.averageScore ? `${r.averageScore}%` : '' });
    }
  }
  return out.slice(0, 12);
}

// ───────────────────────────── Open Library (CORS-enabled, no key)
const OL = 'https://openlibrary.org';
const olJson = async (path) => { const r = await fetch(`${OL}${path}`); if (!r.ok) throw new Error(`Open Library ${r.status}`); return r.json(); };
const olItem = (d) => ({ kind: 'book', title: d.title, creator: (d.author_name || [])[0] || '', year: d.first_publish_year || 0, total: d.number_of_pages_median || 0, genres: (d.subject || []).slice(0, 4), cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '', src: 'openlibrary', extId: d.key || '' });
const OLF = 'key,title,author_name,author_key,first_publish_year,number_of_pages_median,cover_i,subject,ratings_average,ratings_count,want_to_read_count,edition_count';
const lc = (x) => String(x || '').toLowerCase().trim();
const olCand = (d) => ({ item: olItem(d), q: { avg: d.ratings_average || 0, n: d.ratings_count || 0, want: d.want_to_read_count || 0, subjects: (d.subject || []).map(lc) } });
const gbItem = (v) => { const i = v.volumeInfo || {}; return { kind: 'book', title: i.title || '', creator: (i.authors || [])[0] || '', year: +String(i.publishedDate || '').slice(0, 4) || 0, total: i.pageCount || 0, genres: (i.categories || []).slice(0, 4), cover: (i.imageLinks?.thumbnail || '').replace(/^http:/, 'https:'), src: 'googlebooks', extId: `gb:${v.id}` }; };
/** Whole-catalogue search: Open Library (tens of millions of works) plus Google Books, merged and de-duplicated. */
export async function searchBooks(q) {
  const [ol, gb] = await Promise.allSettled([
    olJson(`/search.json?q=${encodeURIComponent(q)}&limit=8&fields=${OLF}`).then(j => (j.docs || []).map(d => olCand(d).item)),
    fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8&printType=books&fields=items(id,volumeInfo(title,authors,publishedDate,pageCount,categories,imageLinks/thumbnail))`).then(r => r.ok ? r.json() : { items: [] }).then(j => (j.items || []).map(gbItem)),
  ]);
  if (ol.status === 'rejected' && gb.status === 'rejected') throw new Error('Could not reach the book catalogues');
  const out = [], seen = new Set();
  for (const it of [...(ol.value || []), ...(gb.value || [])]) { const k = norm(it.title) + '|' + norm(it.creator.split(' ').pop()); if (!it.title || seen.has(k)) continue; seen.add(k); out.push(it); }
  return out.slice(0, 12);
}

// ───────────────────────────── taste: what your ratings and shelves say you like
const BROAD = /^(fiction|nonfiction|non-fiction|general|accessible book|protected daisy|in library|large type books|reading level|open library|new york times|english|american|literature|books and reading|lending library|history|novel|novels|read|to-read|currently-reading|favorites|favourites|owned|kindle|audiobook|ebook|books|wishlist|library|default|unread|dnf|re-read|reference)/i;
export function bookTaste(s, extra = {}) {
  const subj = {}, auth = {}, loved = [];
  for (const b of mediaList(s, 'book')) {
    const w = b.status === 'done' && b.score ? (b.score - 6.5) / 3.5 : b.status === 'doing' ? 0.25 : 0; if (!w) continue;
    if (w >= 0.4) loved.push(b);
    if (b.creator) auth[b.creator] = (auth[b.creator] || 0) + w;
    for (const g of [...(b.genres || []), ...(extra[norm(b.title)] || [])]) { const k = lc(g); if (!k || BROAD.test(k)) continue; subj[k] = (subj[k] || 0) + w; }
  }
  const rank = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  return { subjects: rank(subj).filter(([, w]) => w > 0), avoid: rank(subj).filter(([, w]) => w < -0.4).map(([k]) => k), authors: rank(auth).filter(([, w]) => w > 0.5), loved: loved.sort((a, b) => b.score - a.score), weights: subj };
}
/** Your own to-read pile, ordered by how well each book fits your taste. Works offline — no catalogue needed. */
export function pileRanking(s, n = 10) {
  const t = bookTaste(s), A = Object.fromEntries(t.authors), W = t.weights, out = [];
  for (const b of mediaList(s, 'book')) {
    if (b.status !== 'planned' || b.triage === 'no') continue;
    const a = A[b.creator] || 0, gs = (b.genres || []).map(lc).filter(g => g && !BROAD.test(g)), g = gs.length ? gs.reduce((x, k) => x + (W[k] || 0), 0) / Math.sqrt(gs.length) : 0;
    const len = b.total ? (b.total <= 350 ? 0.25 : b.total > 700 ? -0.3 : 0) : 0, score = a * 1.6 + g + len;
    if (score <= 0) continue;
    const topG = gs.filter(k => (W[k] || 0) > 0).sort((x, y) => W[y] - W[x]).slice(0, 2);
    const reason = a > 0.5 ? `You loved ${b.creator} before` : topG.length ? `Same shelves as books you loved: ${topG.join(', ')}` : 'Short and a good fit';
    out.push({ key: `pile:${b.id}`, media: b, reason, score });
  }
  const seen = new Set();   // two editions of the same book count once
  return out.sort((x, y) => y.score - x.score).filter(x => { const k = `${lc(x.media.creator)}|${norm(x.media.title).split(' ').slice(0, 3).join(' ')}`; return !seen.has(k) && seen.add(k); }).slice(0, n);
}
const subjCache = () => { try { return JSON.parse(localStorage.getItem('sudachi.olsubj') || '{}'); } catch { return {}; } };
async function enrichSubjects(s, max = 8) {
  const cache = subjCache(); let fetched = 0;
  for (const b of bookTaste(s).loved) {
    const k = norm(b.title); if (cache[k] || fetched >= max) continue; fetched++;
    try { const j = await olJson(`/search.json?title=${encodeURIComponent(b.title)}&author=${encodeURIComponent(b.creator || '')}&limit=1&fields=subject`); cache[k] = (j.docs?.[0]?.subject || []).map(lc).filter(x => !BROAD.test(x)).slice(0, 14); } catch { cache[k] = []; }
  }
  if (fetched) try { localStorage.setItem('sudachi.olsubj', JSON.stringify(cache)); } catch {}
  return cache;
}

// ───────────────────────────── explore the whole catalogue
export const EXPLORE = [
  ['fantasy', '🐉', 'Fantasy', 'fantasy'], ['scifi', '🚀', 'Science fiction', 'science fiction'], ['mystery', '🕵️', 'Mystery', 'mystery'], ['horror', '🕯', 'Horror', 'horror'], ['romance', '💞', 'Romance', 'romance'], ['historical', '🏛', 'Historical fiction', 'historical fiction'],
  ['literary', '✒️', 'Literary fiction', 'literary fiction'], ['classics', '📜', 'Classics', 'classics', '[* TO 1950]'], ['philosophy', '🧠', 'Philosophy', 'philosophy'], ['psychology', '🔍', 'Psychology', 'psychology'], ['science', '🔬', 'Science', 'popular science'], ['history', '🗺', 'History', 'world history'],
  ['biography', '🪪', 'Biography', 'biography'], ['medicine', '🩺', 'Medicine', 'medicine'], ['poetry', '🪶', 'Poetry', 'poetry'], ['short', '📖', 'Short stories', 'short stories'], ['essays', '📝', 'Essays', 'essays'], ['graphic', '🎨', 'Graphic novels', 'graphic novels'],
  ['russian', '🇷🇺', 'Russian', 'russian literature'], ['japanese', '🇯🇵', 'Japanese', 'japanese literature'], ['latam', '🌎', 'Latin American', 'latin american literature'], ['african', '🌍', 'African', 'african literature'], ['arabic', '🕌', 'Arabic', 'arabic literature'], ['french', '🇫🇷', 'French', 'french literature'],
  ['german', '🇩🇪', 'German', 'german literature'], ['indian', '🇮🇳', 'Indian', 'indian literature'], ['persian', '🏺', 'Persian', 'persian literature'], ['chinese', '🇨🇳', 'Chinese', 'chinese literature'], ['nordic', '❄️', 'Nordic', 'scandinavian literature'], ['korean', '🇰🇷', 'Korean', 'korean literature'], ['nobel', '🏅', 'Nobel laureates', 'nobel prize winners'],
];
async function topInSubject(subject, { before = '', limit = 24, minRatings = 20 } = {}) {
  const q = `subject:"${subject}"${before ? ` first_publish_year:${before}` : ''}`;
  const j = await olJson(`/search.json?q=${encodeURIComponent(q)}&sort=rating&limit=${limit}&fields=${OLF}`);
  return (j.docs || []).map(olCand).filter(c => c.q.n >= minRatings && c.q.avg >= 3.6);
}
export async function exploreCatalogue(id, s, dismissed = []) {
  const e = EXPLORE.find(x => x[0] === id); if (!e) return [];
  const have = new Set(mediaList(s, 'book').map(m => norm(m.title))), seen = new Set(), taste = bookTaste(s);
  return (await topInSubject(e[3], { before: e[4] || '' })).map(c => ({ ...c, score: quality(c.q) + tasteMatch(c.q, taste) * 0.5 })).sort((a, b) => b.score - a.score)
    .filter(c => !have.has(norm(c.item.title)) && !dismissed.includes(`ol:${c.item.extId}`) && !seen.has(c.item.extId) && seen.add(c.item.extId))
    .slice(0, 12).map(c => ({ key: `ol:${c.item.extId}`, item: { ...c.item, status: 'planned' }, reason: `Top rated in ${e[2]}`, score: c.q.avg ? `${c.q.avg.toFixed(1)}/5 · ${c.q.n.toLocaleString('en')} ratings` : '' }));
}
const quality = (q) => Math.max(0, Math.min(1, (q.avg - 3) / 2)) * Math.min(1, Math.log10(q.n + 1) / 3) * 0.7 + Math.min(1, Math.log10(q.want + 1) / 4) * 0.3;
const tasteMatch = (q, t) => Math.max(0, Math.min(1, q.subjects.reduce((x, k) => x + Math.max(0, t.weights[k] || 0), 0) / 3));
/** Lanes of recommendations drawn from the whole catalogue, each explained, scored by your taste × quality × popularity. */
export async function worldSuggestions(s, dismissed = []) {
  const extra = await enrichSubjects(s), taste = bookTaste(s, extra), have = new Set(mediaList(s, 'book').map(m => norm(m.title))), seen = new Set();
  const day = Math.floor(Date.now() / 86400000);
  const tasks = [];
  taste.authors.slice(0, 3).forEach(([a, w]) => tasks.push({ id: `a:${a}`, title: `More from ${a}`, run: async () => (await olJson(`/search.json?author=${encodeURIComponent(a)}&sort=rating&limit=10&fields=${OLF}`)).docs.map(olCand).filter(c => c.q.n >= 5) }));
  const subs = taste.subjects.map(([k]) => k).slice(0, 12);
  subs.slice(0, 3).forEach(k => tasks.push({ id: `s:${k}`, title: `Top rated in “${k}”`, run: () => topInSubject(k, { minRatings: 30 }) }));
  if (subs[0]) tasks.push({ id: 'classics', title: `Classics in “${subs[0]}”`, run: () => topInSubject(subs[0], { before: '[* TO 1965]', minRatings: 40 }) });
  subs.slice(3, 6).forEach(k => tasks.push({ id: `adj:${k}`, title: `Next door: “${k}”`, run: () => topInSubject(k, { minRatings: 25 }) }));
  const world = EXPLORE.filter(e => /literature$/.test(e[3])); for (let i = 0; i < 2; i++) { const e = world[(day * 2 + i) % world.length]; tasks.push({ id: `w:${e[0]}`, title: `Around the world: ${e[2]}`, run: () => topInSubject(e[3], { minRatings: 15 }) }); }
  const res = await Promise.allSettled(tasks.map(t => t.run())), lanes = [];
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const items = r.value.map(c => ({ c, sc: quality(c.q) * 0.5 + tasteMatch(c.q, taste) * 0.5 })).sort((a, b) => b.sc - a.sc)
      .filter(({ c }) => c.item.title && !have.has(norm(c.item.title)) && !dismissed.includes(`ol:${c.item.extId}`) && !seen.has(c.item.extId) && !c.q.subjects.some(x => taste.avoid.includes(x)))
      .slice(0, 6).map(({ c }) => { seen.add(c.item.extId); return { key: `ol:${c.item.extId}`, item: { ...c.item, status: 'planned' }, reason: tasks[i].title, score: c.q.avg ? `${c.q.avg.toFixed(1)}/5 · ${c.q.n.toLocaleString('en')}` : '' }; });
    if (items.length) lanes.push({ id: tasks[i].id, title: tasks[i].title, items });
  });
  return { lanes, taste: { subjects: subs.slice(0, 6), authors: taste.authors.slice(0, 4).map(a => a[0]), based: taste.loved.length } };
}


// ───────────────────────────── suggestions cache (this device only)
export function cacheGet(kind) { try { const c = JSON.parse(localStorage.getItem(`sudachi.sugg.${kind}`) || 'null'); return c && Date.now() - c.at < 12 * 3600000 ? c.list : null; } catch { return null; } }
export function cacheSet(kind, list) { try { localStorage.setItem(`sudachi.sugg.${kind}`, JSON.stringify({ at: Date.now(), list })); } catch {} }
export function cacheClear() { try { for (const k of ['anime', 'manga', 'book', 'world']) localStorage.removeItem(`sudachi.sugg.${k}`); } catch {} }

// ───────────────────────────── films, series and games: Wikidata's search (free, no key, CORS) — title, year, a line of who/what
const WD_KIND = { movie: /\bfilm\b|\bmovie\b/i, show: /\b(television|tv|web|anime|streaming|mini)[- ]?series\b|\bsitcom\b|\bdrama series\b/i, game: /\bvideo ?game\b/i };
export async function searchWikidata(q, kind) {
  const r = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&uselang=en&type=item&limit=15&format=json&origin=*`);
  if (!r.ok) throw new Error(`Wikidata ${r.status}`);
  const j = await r.json(), re = WD_KIND[kind];
  return (j.search || []).filter(x => x.label && (!re || re.test(x.description || ''))).slice(0, 8).map(x => {
    const d = x.description || '', y = +(/\b(19|20)\d\d\b/.exec(d)?.[0] || 0), by = /\b(?:by|directed by|from)\s+([^,;]+)$/i.exec(d)?.[1] || '';
    return { kind, title: x.label, year: y, creator: by.slice(0, 80), src: 'wikidata', extId: x.id, note: d.slice(0, 90) };
  });
}
/** Look a title up in the catalogue that fits its kind. */
export async function searchAny(q, kind) {
  if (kind === 'anime' || kind === 'manga') return searchAnime(q, kind);
  if (kind === 'book') return searchBooks(q);
  return searchWikidata(q, kind);
}
