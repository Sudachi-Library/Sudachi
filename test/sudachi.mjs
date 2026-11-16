// Sudachi's rules without a browser: tiers and percentile conversion, imports (Goodreads, IMDb, MAL XML and list JSON, Steam),
// the shelf (progress, finish, again, still-on-this), the brain dump, week counts, shift-aware picks, reviews, the hub file,
// the Citrus migration, and the store's sanitize / merge. Made-up data only. Run: node test/sudachi.mjs
globalThis.localStorage = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; }, key(i) { return Object.keys(this._)[i]; }, get length() { return Object.keys(this._).length; } };
process.env.TZ = 'Asia/Riyadh';
import { checker } from './helpers-node.mjs';
import { state as fixture, shifts } from './fixture.mjs';
const { check, bad } = checker();
const T = await import('../docs/js/tiers.js'), M = await import('../docs/js/media.js'), R = await import('../docs/js/roster.js'), P = await import('../docs/js/picks.js');
const RV = await import('../docs/js/review.js'), HUB = await import('../docs/js/hub.js'), MIG = await import('../docs/js/migrate.js'), store = await import('../docs/js/store.js'), CZ = await import('../docs/js/custom.js'), RL = await import('../docs/js/relay.js');
const clone = (x) => JSON.parse(JSON.stringify(x));

console.log('tiers');
check(T.tierOf(10).id === 'S' && T.tierOf(9).id === 'A+' && T.tierOf(8.5).id === 'A' && T.tierOf(8).id === 'B+' && T.tierOf(7).id === 'B' && T.tierOf(6).id === 'C' && T.tierOf(4.5).id === 'D' && T.tierOf(4).id === 'D' && T.tierOf(2).id === 'F' && T.tierOf(0) === null, 'scores map to S A+ A B+ B C D F');
const gr = T.converter([5, 5, 5, 5, 4, 4, 4, 3, 2, 5, 4, 4, 3, 5, 4], 5);
check(gr.mode === 'percentile' && gr.of(5) >= 8.5 && gr.of(4) < gr.of(5) && gr.of(3) < gr.of(4) && gr.of(2) <= 4.5, `Goodreads by percentile: 5★ ${T.tierText(gr.of(5))}, 4★ ${T.tierText(gr.of(4))}, 3★ ${T.tierText(gr.of(3))}, 2★ ${T.tierText(gr.of(2))} (4★ is not an 8)`);
const few = T.converter([8, 9], 10); check(few.mode === 'linear' && few.of(8) === 8, 'too few ratings: converted in proportion');
const im = T.converter([10, 9, 9, 8, 8, 8, 7, 7, 7, 7, 6, 6, 5, 4, 3, 8, 7, 6, 9, 10], 10);
check(im.of(10) === 10 && T.tierOf(im.of(3)).id === 'F' || T.tierOf(im.of(3)).id === 'D', `IMDb: 10 → ${T.tierText(im.of(10))}, 3 → ${T.tierText(im.of(3))}`);
const mono = [3, 4, 5, 6, 7, 8, 9, 10].map(im.of); check(mono.every((v, i) => !i || v >= mono[i - 1]), 'a higher raw rating never lands lower');

console.log('imports');
const csv = 'Book Id,Title,Author,My Rating,Exclusive Shelf,Date Read,Number of Pages,Read Count\n' + Array.from({ length: 10 }, (_, i) => `${i + 1},Test Book ${i + 1},Test Writer,${[5, 4, 4, 5, 3, 4, 5, 2, 4, 0][i]},${i === 9 ? 'to-read' : 'read'},${i < 3 ? '2026/0' + (i + 1) + '/10' : ''},${200 + i},${i === 0 ? 2 : 1}`).join('\n');
const gp = M.parseExport(csv); check(gp.source === 'Goodreads' && gp.items.length === 10 && gp.items[0].srcRating === 5 && gp.items[0].srcScale === 5 && gp.items[9].status === 'planned', 'Goodreads: rows, raw stars on a 5 scale');
let s = M.upsertMany({ media: {} }, gp.items).state;
const books = Object.values(s.media);
check(books.filter(b => b.auto && b.score).length === 9 && books.every(b => !b.score || b.auto), 'imported ratings become converted (auto) tiers');
check(books.find(b => b.title === 'Test Book 1').plays.length === 1, 'Goodreads read count → an earlier read');
check(books.find(b => b.title === 'Test Book 4').finishedAt === '', 'an undated finish stays undated');
const own = books.find(b => b.title === 'Test Book 2'); s = M.updateMedia(s, own.id, { score: 10 }); s = M.upsertMany(s, gp.items, { sync: true }).state;
check(s.media[own.id].score === 10 && !s.media[own.id].auto, 'your own tier survives a re-import');
const imdb = 'Const,Your Rating,Date Rated,Title,Original Title,Title Type,Directors,Year,Genres,Runtime (mins),IMDb Rating\ntt1,9,2026-01-02,The Test Film,Le Film Test,Movie,Test Director,2019,"Drama, Komödie",118,7.9\ntt2,,2026-01-03,Test Series,Test Series,TV Series,,2020,Crime,50,8';
const ip = M.parseExport(imdb, { mode: 'auto' });
check(ip.items[0].orig === 'Le Film Test' && ip.items[0].en === 'The Test Film' && ip.items[0].genres.includes('Comedy') && ip.items[1].kind === 'show' && ip.items[1].status === 'planned', 'IMDb: original + English title, German genres, series vs film');
check(M.shown(M.makeRecord(ip.items[0])) === 'Le Film Test (The Test Film)', 'films show "Original (English)"');
const dropped = M.parseExport(imdb, { mode: 'dropped' }); check(dropped.items.every(i => i.status === 'dropped'), 'IMDb dropped list');
const malx = '<myanimelist><anime><series_animedb_id>42</series_animedb_id><series_title><![CDATA[Test Sora]]></series_title><series_episodes>12</series_episodes><my_watched_episodes>12</my_watched_episodes><my_score>9</my_score><my_status>Completed</my_status><my_finish_date>2026-02-03</my_finish_date><my_start_date>0000-00-00</my_start_date></anime></myanimelist>';
const mp = M.parseExport(malx); check(mp.source === 'MyAnimeList' && mp.items[0].srcRating === 9 && mp.items[0].finishedAt === '2026-02-03' && mp.items[0].startedAt === '', 'MAL export XML');
const ml = M.parseMALList({ anime: [{ anime_id: 42, anime_title: 'Test Sora', anime_title_eng: 'Test Sky', status: 2, score: 8, num_watched_episodes: 12, anime_num_episodes: 12, finish_date_string: '02-03-26', genres: [{ name: 'Fantasy' }] }, { anime_id: 43, anime_title: 'Test Two', status: 6, score: 0 }], manga: [{ manga_id: 7, manga_title: 'Test Ink', status: 1, num_read_chapters: 30, manga_num_chapters: 0, score: 7 }] });
check(ml.items.length === 3 && ml.items[0].title === 'Test Sora (Test Sky)' && ml.items[0].finishedAt === '2026-02-03' && ml.items[2].kind === 'manga' && ml.items[2].status === 'doing', 'MAL list JSON (from the relay): titles, statuses, dates');
check(M.malDate('25-12-26') === '2026-12-25' && M.malDate('2026-01-05') === '2026-01-05' && M.malDate('00-00-00') === '', 'MAL dates: day-first when the first part is over 12');
s = M.upsertMany({ media: {} }, mp.items).state; s = M.upsertMany(s, ml.items).state;
check(Object.values(s.media).filter(m => m.malId === '42').length === 1, 'the same anime from the XML and the list counts once (MAL id)');
const steamJ = JSON.stringify({ steam: { id: '7656', games: [{ appid: 1, name: 'Test Never', minutes: 0 }, { appid: 2, name: 'Test Little', minutes: 50 }, { appid: 3, name: 'Test Lots', minutes: 3000, last: 1700000000 }, { appid: 4, name: 'Test Now', minutes: 600, recent: 120 }], achievements: { 4: { done: 3, total: 10 } } } });
const sp = M.parseSteam(steamJ); const st = Object.fromEntries(sp.items.map(i => [i.title, i]));
check(st['Test Never'].status === 'planned' && st['Test Little'].status === 'planned' && st['Test Lots'].status === 'paused' && st['Test Now'].status === 'doing' && st['Test Now'].ach.total === 10, 'Steam: unplayed and low playtime → backlog, played → on hold, recent → shelf, achievements');
check(M.parseSteam('<gamesList><games><game><appID>9</appID><name><![CDATA[Test XML]]></name><hoursOnRecord>2.5</hoursOnRecord></game></games></gamesList>').items[0].minutes === 150, 'Steam community XML');
let ss = M.upsertMany({ media: {} }, sp.items).state;
check(M.toTriage(ss).length === 2, 'two Steam games to sort');
const later = sp.items.map(i => i.title === 'Test Now' ? { ...i, minutes: 780 } : i);
const dd = M.steamDeltas(ss, later, Object.fromEntries(sp.items.map(i => [i.extId, i.minutes])), '2026-11-16');
check(dd.played.length === 1 && dd.played[0].minutes === 180 && Object.values(dd.state.media).find(m => m.title === 'Test Now').log.at(-1).m === 180, 'time played since the last Steam sync becomes a session');

const rym = M.parseExport('"RYM Album","First Name","Last Name","First Name localized","Last Name localized","Title","Release_Date","Rating","Ownership","Purchase Date","Media Type","Review"\n"101","Test","Band","","","Test Neon Record","2019","9","","","",""\n"102","","Testers","","","Test B-Sides","2021","0","","","",""');
check(rym.source === 'RateYourMusic' && rym.items[0].kind === 'album' && rym.items[0].creator === 'Test Band' && rym.items[0].srcRating === 9 && rym.items[0].status === 'done' && rym.items[1].status === 'planned', 'RateYourMusic: albums, artist, rating, heard vs backlog');
check(M.statusWord('album', 'doing') === 'Listening' && M.statusWord('album', 'done') === 'Heard', 'album words: Listening, Heard');

console.log('the shelf');
R.set(shifts);
s = clone(fixture);
let r = M.logProgress(s, 's1', { n: 1, date: '2026-11-16' }); check(r.state.media.s1.progress === 4 && r.state.media.s1.log.at(-1).m === 30 && !r.finished, '+1 episode, logged with its minutes');
r = M.logProgress(s, 's1', { to: 8, date: '2026-11-16' }); check(r.finished && r.state.media.s1.progress === 8, 'reaching the total asks to finish');
s = M.finish(s, 's1', { date: '2026-11-16', score: 9, flags: { comfort: true } });
check(s.media.s1.status === 'done' && s.media.s1.finishedAt === '2026-11-16' && s.media.s1.startedAt === '2026-11-10' && s.media.s1.score === 9 && s.media.s1.flags.comfort, 'finish keeps the start date, sets date, tier, flags');
s = M.again(s, 's1'); check(s.media.s1.status === 'doing' && s.media.s1.plays.length === 1 && s.media.s1.plays[0].score === 9 && s.media.s1.progress === 0, 'again: the earlier finish is kept in plays');
s = M.finish(s, 's1', { date: '2026-11-17', score: 10 }); check(M.finishesOf(s.media.s1).length === 2 && M.finishesOf(s.media.s1)[1].again, 'a rewatch counts as a second finish');
r = M.logProgress(clone(fixture), 'g1', { n: 2, date: '2026-11-16' }); check(r.state.media.g1.minutes === 1380 && !r.finished, 'a game session adds playtime, never "finishes" it');
const old = M.stale(clone(fixture), new Date('2026-11-16T10:00:00+03:00')); check(old.length === 1 && old[0].id === 'g1' && old[0].idle >= 45, '"still on this?" for the game untouched since September');
check(M.stale(M.stillOn(clone(fixture), 'g1'), new Date()).length === 0, 'still on it: the nudge waits');

console.log('brain dump');
const ad2 = M.parseDump('album: Test LP by Test Artist\n💿 Another Test Album'); check(ad2[0].kind === 'album' && ad2[0].creator === 'Test Artist' && ad2[1].kind === 'album', 'brain dump: album: … by …, 💿');
const dump = M.parseDump('Dune (book)\nfilm: Perfect Test\n🎮 Test Hades\nTest Frieren [anime]\nThe Test Bear - series\nTest Piranesi by Test Clarke\nTest Alien (1979)\n- Blank Test\nDune (book)\nTest Sky Garden [anime]', 'movie');
check(dump.length === 9 && dump[0].kind === 'book' && dump[1].kind === 'movie' && dump[2].kind === 'game' && dump[3].kind === 'anime' && dump[4].kind === 'show' && dump[5].creator === 'Test Clarke' && dump[6].year === 1979 && dump[7].guessed, 'one per line, kinds from (book) film: 🎮 [anime] - series by (year), duplicates once');
const ad = M.addDump(clone(fixture), dump); check(ad.added === 8 && ad.already.length === 1 && ad.already[0].id === 'a1', 'adds new ones to the backlog, leaves ones you have');

console.log('week, picks, reviews');
const now = new Date('2026-11-16T19:30:00+03:00'), wk = M.thisWeek(clone(fixture), now);
check(wk.eps === 3 && M.countLine(wk).startsWith('3 eps'), `this week: ${M.countLine(wk)}`);
const mo = M.thisMonth(clone(fixture), now); check(mo.films === 2 && mo.albums === 1 && mo.finished.length === 4 && /1 album/.test(M.countLine(mo)), `this month: ${M.countLine(mo)}`);
const p1 = P.picksFor(clone(fixture), new Date('2026-11-22T10:00:00+03:00'));
check(p1.day.kind === 'postnight' && p1.picks.length && p1.picks.every(p => p.minutes <= 60) && !p1.picks.some(p => p.id === 'f3'), `after a night: short picks only (${p1.picks.map(p => p.title).slice(0, 3).join(', ')})`);
check(['a1', 'a3', 'm1', 'al1'].includes(p1.picks[0].id), `after a night a comfort pick comes first (${p1.picks[0].title})`);
check(P.picksFor(clone(fixture), new Date('2026-11-14T10:00:00+03:00')).picks.some(p => p.kind === 'album') || P.picksFor(clone(fixture), new Date('2026-11-14T10:00:00+03:00'), { kinds: ['album'] }).picks[0]?.id === 'al2', 'albums can be picked');
const p2 = P.picksFor(clone(fixture), new Date('2026-11-14T10:00:00+03:00'));
check(p2.day.kind === 'off' && p2.picks.some(p => p.kind === 'movie' || p.kind === 'game'), `day off: a film or a long session fits (${p2.picks.slice(0, 3).map(p => p.title).join(', ')})`);
const p3 = P.picksFor(clone(fixture), new Date('2026-11-17T21:00:00+03:00'));
check(p3.day.kind === 'day' && !p3.picks.some(p => p.id === 'f3') && !p3.picks.some(p => p.kind === 'game' && p.source !== 'continue'), '12-hour day: no 3-hour epic, no starting a game');
const p4 = P.picksFor(clone(fixture), new Date('2026-11-18T12:00:00+03:00'));
check(!p4.picks.some(p => p.kind === 'game' && p.source === 'backlog' && (clone(fixture).media[p.id].length > 30)), 'nothing huge before a night stretch');
const rv = RV.review(clone(fixture), '2026-11', now);
check(rv.n === 4 && rv.top?.id === 'f1' && rv.dropped.length === 1 && rv.label === 'November 2026', `November: ${rv.n} finished, best ${rv.top?.title}, 1 dropped`);
const sl = RV.story(rv); check(sl[0].id === 'open' && sl.at(-1).id === 'end' && sl.some(x => x.id === 'top') && sl.every(x => !/undefined|NaN/.test(JSON.stringify(x))), `story: ${sl.length} slides, no undefined/NaN`);
const yr = RV.review(clone(fixture), '2026', now); check(yr.kind === 'year' && yr.months.length === 12 && RV.story(yr).some(x => x.poster), 'year review with months and the poster slide');
check(RV.periodsWithData(clone(fixture), 'month')[0] === '2026-11', 'periods with data, newest first');
const gl = M.goalsProgress(clone(fixture), now); check(gl.find(g => g.kind === 'book').done === 1 && gl.find(g => g.kind === 'book').target === 12, 'book goal: 1 of 12 this year');

console.log('hub file');
const hb = HUB.buildStatus(clone(fixture), now), js = JSON.stringify(hb);
check(hb.contract === 2 && hb.app === 'sudachi' && /this week/.test(hb.summary) && hb.extra.week.eps === 3 && hb.extra.now.length === 4 && hb.extra.pick?.title && hb.extra.goals.books.target === 12, `status.json: ${hb.summary}`);
check(!js.includes('made-up line worth keeping') && !js.includes('A private test note'), 'never notes or quotes in status.json');
check(hb.pending.some(x => /Test Quest/.test(x)), 'pending: still on this?');
check(hb.actions.map(a => a.id).join() === 'today,log,shelf,backlog,import,review', 'actions');

console.log('Citrus migration');
const cat = Date.parse('2026-11-01T10:00:00Z');
const citrus = { app: 'citrus', updatedAt: cat, tasks: { t: { title: 'not media' } }, memos: { m: { title: 'memo' } },
  media: { c1: { id: 'c1', kind: 'book', title: 'Citrus Test Book', status: 'done', rating: 8, src: 'goodreads', finishedAt: '2026-01-01', log: [{ d: '2026-01-01', p: 30, m: 40 }], at: cat }, c2: { id: 'c2', kind: 'movie', title: 'Citrus Test Film', status: 'done', rating: 7, src: 'manual', at: cat }, c3: { id: 'c3', kind: 'game', title: 'Citrus Steam Game', status: 'planned', src: 'steam', minutes: 0, at: cat }, bad: { id: 'bad', title: '' } },
  mediaMeta: { goals: { book: 20 }, dismissed: ['ol:/works/1'] }, deleted: { 'media:gone': cat, 'task:x': cat } };
const lp = MIG.libraryPart(citrus);
check(lp.counts.titles === 3 && lp.part.media.c1.srcRating === 8 && lp.part.media.c1.score === 0 && lp.part.media.c2.score === 7 && !lp.part.media.c2.auto && lp.part.media.c1.log[0].n === 30, 'imported ratings become raw site ratings, your own stay yours, the reading log comes along');
check(lp.part.deleted['media:gone'] && !lp.part.deleted['task:x'] && !lp.part.memos && !lp.part.tasks, 'only media tombstones, no memos or tasks');
const am = MIG.applyMigration(store.sanitize({ app: 'sudachi', media: {}, meta: {}, settings: {} }), citrus);
check(am.changed && am.state.migrated.from === 'citrus' && am.state.media.c1.score > 0 && am.state.media.c1.auto && am.state.meta.goals.book === 20, 'merged in, converted, goals brought over');
check(MIG.describe(lp.counts).startsWith('3 titles') && MIG.looksLikeCitrus(citrus) && !MIG.looksLikeCitrus({ app: 'sudachi', media: {} }), `describe: ${MIG.describe(lp.counts)}`);

console.log('store');
const bad1 = store.sanitize({ media: { x: 'no', y: { title: '' }, z: { title: 'Fine', genres: 'oops', score: 99 } }, meta: 3 });
check(!bad1.media.x && !bad1.media.y && Array.isArray(bad1.media.z.genres) && bad1.media.z.score === 0 && bad1.meta === undefined, 'sanitize drops broken records and repairs fields');
const A = { ...clone(fixture), updatedAt: 10, media: { ...clone(fixture).media, a1: { ...fixture.media.a1, progress: 6, at: at2(1) } }, meta: { goals: { book: 12 } }, stamps: { 'meta:goals': 5 } };
const B = { ...clone(fixture), updatedAt: 11, media: { ...clone(fixture).media, f2: { ...fixture.media.f2, score: 8, at: at2(2) } }, meta: { goals: { book: 15 } }, stamps: { 'meta:goals': 9 }, deleted: { 'media:g3': at2(3) } };
function at2(n) { return Date.parse('2026-11-16T00:00:00Z') + n; }
delete B.media.g3;
const mg = store.mergeStates(A, B);
check(mg.media.a1.progress === 6 && mg.media.f2.score === 8 && !mg.media.g3 && mg.meta.goals.book === 15, 'two devices: edits on both sides survive, a delete holds, meta follows its edit time');
check(CZ.custom({ settings: { custom: { kinds: { hidden: ['anime', 'show', 'movie', 'manga', 'book', 'game', 'album'] } } } }).kinds.hidden.length === 6, 'Customise never hides every kind');
check(RL.validRelay('https://script.google.com/macros/s/AKfy-123_x/exec') && !RL.validRelay('https://evil.example/exec') && RL.RELAY_SCRIPT.includes('function doGet') && RL.RELAY_SCRIPT.includes('/^\\d{17}$/'), 'relay: only Apps Script addresses, the script is complete');

console.log(bad() ? `\n${bad()} FAILED` : '\nall passed');
process.exit(bad() ? 1 : 0);
