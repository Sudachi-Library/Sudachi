// Covers by themselves: for any title without a picture, Sudachi asks the free catalogues that fit its kind, checks the image
// really loads, and keeps the first that does. Anime and manga: AniList (by MyAnimeList id, else by title). Books: Open Library
// by ISBN, then search, then Google Books. Albums: MusicBrainz + the Cover Art Archive. Films, series, games: Wikipedia's lead
// image for the article (poster / box art). Steam games already carry their header image. Runs in the background a few at a
// time; a title that found nothing is tried again after 30 days. The item sheet can show every candidate to pick from.
import { keyOf, addDays, fromKey } from './util.js';
import { norm } from './media.js';

const j = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error(String(r.status)); return r.json(); };
const year = (m) => m.year ? ` ${m.year}` : '';
const plainTitle = (m) => (m.orig || m.title).replace(/\s*\([^)]*\)\s*$/, '');

async function anilist(m) {
  const type = m.kind === 'manga' ? 'MANGA' : 'ANIME', byMal = m.malId && /^\d+$/.test(m.malId);
  const q = byMal ? `query($id:Int){Page(perPage:1){media(idMal:$id,type:${type}){coverImage{large}}}}` : `query($q:String){Page(perPage:3){media(search:$q,type:${type},sort:SEARCH_MATCH){coverImage{large} title{romaji english}}}}`;
  const d = await j('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: q, variables: byMal ? { id: +m.malId } : { q: plainTitle(m) } }) });
  return (d.data?.Page?.media || []).map(x => ({ url: x.coverImage?.large || '', from: 'AniList' })).filter(x => x.url);
}
async function books(m) {
  const out = [], isbn = /^\d{9}[\dX]$|^\d{13}$/.test(m.extId || '') ? m.extId : '';
  if (isbn) out.push({ url: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`, from: 'Open Library' });
  try { const d = await j(`https://openlibrary.org/search.json?title=${encodeURIComponent(plainTitle(m))}${m.creator ? `&author=${encodeURIComponent(m.creator)}` : ''}&limit=4&fields=cover_i`); for (const x of d.docs || []) if (x.cover_i) out.push({ url: `https://covers.openlibrary.org/b/id/${x.cover_i}-M.jpg`, from: 'Open Library' }); } catch {}
  try { const d = await j(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`intitle:${plainTitle(m)}${m.creator ? ` inauthor:${m.creator}` : ''}`)}&maxResults=3&fields=items(volumeInfo/imageLinks/thumbnail)`); for (const x of d.items || []) { const u = x.volumeInfo?.imageLinks?.thumbnail; if (u) out.push({ url: u.replace(/^http:/, 'https:'), from: 'Google Books' }); } } catch {}
  return out;
}
async function albums(m) {
  const q = `releasegroup:"${plainTitle(m).replace(/"/g, '')}"${m.creator ? ` AND artist:"${m.creator.replace(/"/g, '')}"` : ''}`;
  const d = await j(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&limit=4&fmt=json`, { headers: { Accept: 'application/json' } });
  return (d['release-groups'] || []).map(g => ({ url: `https://coverartarchive.org/release-group/${g.id}/front-250`, from: 'Cover Art Archive' }));
}
const WORD = { movie: 'film', show: 'TV series', game: 'video game', anime: 'anime', manga: 'manga', book: 'novel', album: 'album' };
/** Wikipedia's lead image for the best-matching article (pilicense=any: posters and box art are non-free, but they are what the page shows). */
async function wikipedia(m) {
  const term = `${plainTitle(m)}${year(m)} ${WORD[m.kind] || ''}`.trim();
  const d = await j(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrlimit=4&prop=pageimages&piprop=thumbnail&pithumbsize=400&pilicense=any`);
  const pages = Object.values(d.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const nt = norm(plainTitle(m));
  return pages.filter(p => p.thumbnail?.source).sort((a, b) => (norm(b.title).startsWith(nt) ? 1 : 0) - (norm(a.title).startsWith(nt) ? 1 : 0)).map(p => ({ url: p.thumbnail.source, from: 'Wikipedia', note: p.title }));
}
/** Every cover the catalogues offer for a record, best first. [{url, from, note?}] */
export async function candidates(m) {
  const tries = { anime: [anilist, wikipedia], manga: [anilist, wikipedia], book: [books, wikipedia], album: [albums, wikipedia], movie: [wikipedia], show: [wikipedia], game: [wikipedia] }[m.kind] || [wikipedia];
  if (m.kind === 'game' && m.src === 'steam' && m.extId) return [{ url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${m.extId}/header.jpg`, from: 'Steam' }];
  const out = [], seen = new Set();
  for (const f of tries) { try { for (const c of await f(m)) if (c.url && !seen.has(c.url)) { seen.add(c.url); out.push(c); } } catch {} }
  return out.slice(0, 8);
}
/** Does this image really load (and is it not a 1×1 "no cover" placeholder)? In a browser only. */
export function loads(url, timeout = 8000) {
  if (typeof Image === 'undefined') return Promise.resolve(true);
  return new Promise((res) => { const img = new Image(), t = setTimeout(() => res(false), timeout); img.referrerPolicy = 'no-referrer'; img.onload = () => { clearTimeout(t); res(img.naturalWidth > 20 && img.naturalHeight > 20); }; img.onerror = () => { clearTimeout(t); res(false); }; img.src = url; });
}
/** The first candidate that loads ('' when none does). */
export async function findCover(m, { check = loads } = {}) { for (const c of await candidates(m)) if (await check(c.url)) return c.url; return ''; }
/** Titles still waiting for a cover: none yet, and not tried in the last 30 days. Shelf and backlog first. */
export function needing(s, today = keyOf(new Date())) {
  const since = keyOf(addDays(fromKey(today), -30)), rank = { doing: 0, planned: 1, done: 2, paused: 3, dropped: 4 };
  return Object.values(s.media || {}).filter(m => !m.cover && !(m.coverTried && m.coverTried > since)).sort((a, b) => (rank[a.status] ?? 5) - (rank[b.status] ?? 5) || (b.at || 0) - (a.at || 0));
}
