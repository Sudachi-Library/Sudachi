// Your choices for how Sudachi looks and behaves — synced with your state (settings.custom), unlike the per-device interface.
// Pure: defaults, sanitising and small getters. Settings › Customise edits it.
export const TABS = [['today', 'Today'], ['library', 'Library'], ['backlog', 'Backlog'], ['review', 'Review']];
export const ROWS = [['shelf', 'On the shelf'], ['pick', 'Pick for today'], ['week', 'This week'], ['nudge', 'Still on this?'], ['up', 'Up next'], ['comfort', 'Comfort picks'], ['discover', 'Discover'], ['goals', 'Goals']];
export const ACCENTS = [['sudachi', 'Sudachi lime', '#b8f03c'], ['pink', 'Hot pink', '#ff2e88'], ['cyan', 'Electric cyan', '#21d4fd'], ['orange', 'Citrus orange', '#ff7a1a'], ['violet', 'Violet', '#a77bff']];
export const KIND_IDS = ['anime', 'show', 'movie', 'manga', 'book', 'game'];
export const DEFAULTS = {
  start: 'today',
  tabs: { hidden: [], order: TABS.map(t => t[0]) },
  today: { rows: { order: ROWS.map(r => r[0]), hidden: [] } },
  kinds: { hidden: [] },
  look: { accent: 'sudachi', stickers: true, motion: true, covers: true },
};
const arr = (v, ok) => Array.isArray(v) ? [...new Set(v.filter(x => ok.includes(x)))] : [];
const ids = (l) => l.map(x => Array.isArray(x) ? x[0] : x);
/** Clean, complete settings — never trust what came from storage or another device. */
export function custom(s) {
  const c = s?.settings?.custom || {}, t = c.tabs || {}, l = c.look || {};
  const order = [...arr(t.order, ids(TABS)), ...ids(TABS).filter(x => !(t.order || []).includes(x))];
  const hidden = arr(t.hidden, ids(TABS)).filter(x => x !== 'today');
  const ro = arr(c.today?.rows?.order, ids(ROWS));
  return {
    start: ids(TABS).includes(c.start) && !hidden.includes(c.start) ? c.start : 'today',
    tabs: { hidden, order },
    today: { rows: { order: [...ro, ...ids(ROWS).filter(x => !ro.includes(x))], hidden: arr(c.today?.rows?.hidden, ids(ROWS)) } },
    kinds: { hidden: arr(c.kinds?.hidden, KIND_IDS).slice(0, KIND_IDS.length - 1) },
    look: { accent: ids(ACCENTS).includes(l.accent) ? l.accent : 'sudachi', stickers: l.stickers !== false, motion: l.motion !== false, covers: l.covers !== false },
  };
}
/** Change one part: returns the new state (patch is merged one level deep). */
export function setCustom(s, part, patch) { const cur = custom(s); return { ...s, settings: { ...s.settings, custom: { ...cur, [part]: typeof patch === 'object' && !Array.isArray(patch) ? { ...cur[part], ...patch } : patch } } }; }
export const toggleIn = (list, id) => list.includes(id) ? list.filter(x => x !== id) : [...list, id];
export function move(list, id, dir) { const i = list.indexOf(id), j = i + dir; if (i < 0 || j < 0 || j >= list.length) return list; const l = [...list]; [l[i], l[j]] = [l[j], l[i]]; return l; }
export const visibleTabs = (s) => { const c = custom(s); return c.tabs.order.filter(t => !c.tabs.hidden.includes(t)); };
export const visibleKinds = (s) => { const h = custom(s).kinds.hidden; return KIND_IDS.filter(k => !h.includes(k)); };
