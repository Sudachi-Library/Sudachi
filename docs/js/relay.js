// The relay: a tiny Google Apps Script web app on the owner's own Google account. Steam's Web API and MyAnimeList's list
// JSON refuse calls from a web page (no CORS), so Sudachi asks the relay, the relay asks them and passes the answer on.
// The Steam key lives only in the script's own properties (never in Sudachi, never on Drive). Free, about five minutes to set
// up (Settings › Steam & MyAnimeList). Pure apart from fetch.

export const RELAY_VERSION = 1;
/** Paste this into script.google.com › New project, set STEAM_KEY in Project settings › Script properties, Deploy › Web app
 *  (Execute as: Me, Who has access: Anyone). Kept here so Settings can copy it in one tap. */
export const RELAY_SCRIPT = `// Sudachi relay v${RELAY_VERSION}: passes Steam and MyAnimeList answers to Sudachi (they block web pages).
// Script properties: STEAM_KEY = your key from https://steamcommunity.com/dev/apikey
function doGet(e) {
  var p = (e && e.parameter) || {}, out;
  try {
    if (p.steam) out = { steam: steam_(String(p.steam)) };
    else if (p.mal) out = { mal: mal_(String(p.mal)) };
    else out = { ok: true, app: 'sudachi-relay', v: ${RELAY_VERSION} };
  } catch (err) { out = { error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function get_(url) {
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (r.getResponseCode() >= 400) throw new Error('HTTP ' + r.getResponseCode() + ' from ' + url.split('?')[0]);
  return JSON.parse(r.getContentText());
}
function steam_(who) {
  var key = PropertiesService.getScriptProperties().getProperty('STEAM_KEY');
  if (!key) throw new Error('Add STEAM_KEY in the script properties');
  var id = who;
  if (!/^\\d{17}$/.test(who)) { var v = get_('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=' + key + '&vanityurl=' + encodeURIComponent(who)); if (!v.response || !v.response.steamid) throw new Error('No Steam profile called ' + who); id = v.response.steamid; }
  var owned = get_('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=' + key + '&steamid=' + id + '&include_appinfo=1&include_played_free_games=1&format=json');
  var games = (owned.response && owned.response.games) || [];
  if (!games.length) throw new Error('Steam returned no games: set Game details to Public in Steam › Privacy settings');
  var list = games.map(function (g) { return { appid: g.appid, name: g.name, minutes: g.playtime_forever || 0, recent: g.playtime_2weeks || 0, last: g.rtime_last_played || 0 }; });
  var ach = {}, top = list.filter(function (g) { return g.recent > 0 || g.minutes > 600; }).sort(function (a, b) { return b.last - a.last; }).slice(0, 15);
  top.forEach(function (g) { try { var a = get_('https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=' + key + '&steamid=' + id + '&appid=' + g.appid); var l = (a.playerstats && a.playerstats.achievements) || []; if (l.length) ach[g.appid] = { done: l.filter(function (x) { return x.achieved; }).length, total: l.length }; } catch (e) {} });
  return { id: id, games: list, achievements: ach };
}
function mal_(user) {
  var out = { anime: [], manga: [] };
  ['anime', 'manga'].forEach(function (k) {
    for (var off = 0; off < 6000; off += 300) {
      var r = UrlFetchApp.fetch('https://myanimelist.net/' + k + 'list/' + encodeURIComponent(user) + '/load.json?status=7&offset=' + off, { muteHttpExceptions: true });
      if (r.getResponseCode() === 400 || r.getResponseCode() === 404) { if (k === 'anime') throw new Error('No public MyAnimeList list for ' + user); return; }
      var page = JSON.parse(r.getContentText()); if (!page.length) break;
      out[k] = out[k].concat(page); if (page.length < 300) break;
    }
  });
  return out;
}
`;

/** A relay URL must be an Apps Script web app (or a test stand-in on localhost). */
export const validRelay = (u) => /^https:\/\/script\.google(usercontent)?\.com\/macros\/s\/[\w-]+\/exec$/.test(String(u || '').trim()) || /^http:\/\/localhost(:\d+)?\//.test(String(u || ''));
/** GET the relay with a timeout. → parsed JSON (throws a plain-English Error). */
export async function call(url, params = {}, { timeout = 45000, fetchImpl = fetch } = {}) {
  if (!validRelay(url)) throw new Error('That is not an Apps Script web app address (it ends in /exec).');
  const q = new URLSearchParams(params).toString(), ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
  try {
    const r = await fetchImpl(`${url.trim()}${q ? `?${q}` : ''}`, { redirect: 'follow', signal: ctl?.signal });
    const text = await r.text(); let j; try { j = JSON.parse(text); } catch { throw new Error(/<html/i.test(text) ? 'The relay answered with a web page: check it is deployed for "Anyone" and the address ends in /exec.' : 'The relay sent something that is not JSON.'); }
    if (j?.error) throw new Error(String(j.error).slice(0, 200));
    return j;
  } catch (e) { if (e.name === 'AbortError') throw new Error('The relay took too long. Try again in a minute.'); if (e instanceof TypeError) throw new Error('Could not reach the relay (offline, or not deployed for "Anyone").'); throw e; }
  finally { if (timer) clearTimeout(timer); }
}
export const ping = (url, o) => call(url, {}, { timeout: 15000, ...o });
export const steam = (url, who, o) => call(url, { steam: String(who).trim() }, o);
export const mal = (url, user, o) => call(url, { mal: String(user).trim() }, o);

/** A MAL export arrives as .xml.gz: unpack it in the browser. */
export async function gunzipText(file) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .gz files: unpack it first.');
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}
