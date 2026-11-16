// Small pieces every screen shares: the app context (filled in by app.js), form helpers, the tick button, confirm-twice
// buttons, Undo, voice dictation and downloads. DOM only; the rules live in media / tiers / picks / review.
import { h, toast, keyOf } from './util.js';

/** Filled by app.js: S(), update(fn), sheet(content), render(), go(view, part), undoTo(before), cheer(el), goals(), kinds(date), hasShifts(), openItem(id), finish(id), sync() */
export const ctx = {};
export const S = () => ctx.S();
export const up = (fn) => ctx.update(fn);
export const now = () => new Date();

export const field = (label, ...inputs) => h('div', { class: 'field' }, label ? h('label', {}, label) : null, ...inputs);
/** A row of choices (segmented); onPick(value). */
export function pick(options, value, onPick, cls = '') {
  const box = h('div', { class: `seg wrap ${cls}`, role: 'group' });
  const paint = (v) => { for (const b of box.children) { const on = b.dataset.v === String(v); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); } };
  for (const [v, label, color, title] of options) box.append(h('button', { type: 'button', dataset: { v: String(v) }, title: title || null, 'aria-label': title || null, style: color ? { '--c': color } : null, onClick: () => { paint(v); onPick(v); } }, label));
  paint(value); return box;
}
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const pctTxt = (v) => v == null ? '–' : `${Math.round(v * 100)}%`;
export const confirmBtn = (label, fn, cls = 'btn danger') => { const b = h('button', { class: cls, type: 'button', onClick: () => { if (b.dataset.sure) fn(); else { b.dataset.sure = 1; b.textContent = 'Tap again to confirm'; setTimeout(() => { delete b.dataset.sure; b.textContent = label; }, 3000); } } }, label); return b; };
/** "Done · Undo": put the state back exactly as it was before (holds on every device). */
export const undoToast = (msg, before) => toast(msg, 'ok', { action: { label: 'Undo', run: () => ctx.undoTo(before) } });
export const todayKey = () => keyOf(now());

/** Rows re-render and slide under the finger after a tick: a second tap within 600 ms is ignored. */
let lockUntil = 0;
export const settling = () => Date.now() < lockUntil;
export const settle = () => { lockUntil = Date.now() + 600; };
export function tick(on, label, onToggle, color = '') {
  return h('button', { type: 'button', class: `tick ${on ? 'on' : ''}`, 'aria-pressed': String(!!on), 'aria-label': label, style: color ? { '--c': color } : null, onClick: (e) => { e.stopPropagation(); if (settling()) return; settle(); onToggle(e.currentTarget); } }, h('i'));
}

// ════════════════════════════════════════ voice dictation (the browser's own speech input, where it has one)
const Rec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const canDictate = () => !!Rec;
/** A 🎙 button that types what you say into `target` (an input or textarea). Hidden where the browser has no speech input. */
export function micButton(target, lang = 'en-GB') {
  if (!Rec) return null;
  let rec = null;
  const b = h('button', { type: 'button', class: 'btn sm ghost mic', title: 'Dictate', 'aria-label': 'Dictate', 'aria-pressed': 'false', onClick: () => {
    if (rec) { rec.stop(); return; }
    try { rec = new Rec(); } catch { toast('Voice input is not available here', 'err'); return; }
    rec.lang = lang; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (ev) => { let txt = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) txt += ev.results[i][0].transcript; if (!txt) return;
      const v = target.value, sp = v && !/\s$/.test(v) ? ' ' : ''; target.value = v + sp + txt.trim(); target.dispatchEvent(new Event('input', { bubbles: true })); };
    rec.onerror = (ev) => { if (ev.error === 'not-allowed') toast('Allow the microphone to dictate', 'err'); };
    rec.onend = () => { rec = null; b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); b.textContent = '🎙'; };
    rec.start(); b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); b.textContent = '■ Stop';
  } }, '🎙');
  new MutationObserver((_, mo) => { if (!b.isConnected) { rec?.stop(); mo.disconnect(); } }).observe(document.body, { childList: true, subtree: true });
  return b;
}
/** Download a text file. */
export function download(name, text, type = 'text/markdown') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
