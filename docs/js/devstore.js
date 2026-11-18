// This device's durable copy of the library: IndexedDB, with two slots written in turn (A, then B, then A…), so a crash or a
// full disk in the middle of a save always leaves the other, complete copy behind. IndexedDB holds hundreds of megabytes and
// saves without freezing the screen, unlike localStorage (about 5 MB, written in one blocking go). Tabs of the same app tell
// each other about a save through a BroadcastChannel, so a second window never works on a stale copy. Used by store.js.

export function createDevStore(name) {
  const ok = typeof indexedDB !== 'undefined';
  let dbp = null, next = 'a';
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    let r; try { r = indexedDB.open(name, 1); } catch (e) { return rej(e); }
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('slots')) r.result.createObjectStore('slots', { keyPath: 'id' }); };
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbp = null; }; res(db); };
    r.onerror = () => { dbp = null; rej(r.error || new Error('IndexedDB would not open')); };
    r.onblocked = () => { dbp = null; rej(new Error('IndexedDB is blocked by another tab')); };
  }));
  const tx = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction('slots', mode), st = t.objectStore('slots'); let out;
    Promise.resolve(fn(st)).then(v => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error || new Error('save failed')); t.onabort = () => rej(t.error || new Error('save aborted'));
  }));
  /** Both slots, newest first by (highest edit time, saved at). Unreadable slots are skipped. → [{id, raw, hi, savedAt}] */
  async function slots() {
    const all = await tx('readonly', (st) => new Promise((res) => { const r = st.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); }));
    return (all || []).filter(x => x && typeof x.raw === 'string').sort((a, b) => (b.hi || 0) - (a.hi || 0) || (b.savedAt || 0) - (a.savedAt || 0));
  }
  /** Write the next slot. The slot we just wrote becomes the one to keep if the next write is cut off. */
  async function write(raw, hi) {
    const id = next; await tx('readwrite', (st) => { st.put({ id, raw, hi, savedAt: Date.now(), bytes: raw.length * 2 }); });
    next = id === 'a' ? 'b' : 'a';
    return id;
  }
  async function clear() { await tx('readwrite', (st) => { st.clear(); }); }
  return { ok, slots, write, clear };
}

/** One message channel per app between its open tabs (no-op where the browser has none). */
export function createTabChannel(name) {
  if (typeof BroadcastChannel === 'undefined') return { post() {}, on() {} };
  const ch = new BroadcastChannel(name), fns = new Set(), id = Math.random().toString(36).slice(2);
  ch.onmessage = (e) => { if (e.data?.from === id) return; for (const fn of fns) try { fn(e.data); } catch {} };
  return { id, post: (msg) => { try { ch.postMessage({ ...msg, from: id }); } catch {} }, on: (fn) => fns.add(fn) };
}
