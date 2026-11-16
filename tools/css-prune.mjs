// One-off house-clean: drop CSS rules whose selectors name a class no script or page ever uses (Citrus-only screens).
// A class counts as used if it appears as a word anywhere in docs/js/*.js or docs/index.html, so nothing dynamic is lost.
// Run: node tools/css-prune.mjs [--write]
import fs from 'node:fs'; import path from 'node:path';
const docs = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../docs');
const src = [...fs.readdirSync(path.join(docs, 'js')).map(f => fs.readFileSync(path.join(docs, 'js', f), 'utf8')), fs.readFileSync(path.join(docs, 'index.html'), 'utf8')].join('\n');
const used = new Set(src.match(/[A-Za-z][\w-]*/g));
// classes built in templates: `ui-${id}`, `s${site}`, `sw-k ${kind}` → any class starting with that prefix counts as used
const prefixes = [...new Set([...src.matchAll(/(?:^|[\s'"`.])([A-Za-z][\w-]*)\$\{/g)].map(m => m[1]))];
const isUsed = (c) => used.has(c) || prefixes.some(p => c.startsWith(p) && /^[\w-]+$/.test(c.slice(p.length)));
const css = fs.readFileSync(path.join(docs, 'css/app.css'), 'utf8');
let removed = 0;
function prune(text) {
  let out = '', i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i); if (open < 0) { out += text.slice(i); break; }
    const head = text.slice(i, open);
    let d = 0, j = open; for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (d === 0) break; } }
    const body = text.slice(open + 1, j);
    const sel = head.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (sel.startsWith('@media') || sel.startsWith('@supports')) { const inner = prune(body); out += inner.trim() ? `${head}{${inner}}` : head.replace(/[^\n]*$/, ''); }
    else if (sel.startsWith('@')) out += text.slice(i, j + 1);
    else {
      const keep = sel.split(',').filter(x => { const cls = [...x.matchAll(/\.([A-Za-z][\w-]*)/g)].map(m => m[1]); return cls.every(isUsed); });
      if (keep.length) out += text.slice(i, j + 1); else { removed++; out += head.replace(/[^\n]*$/, ''); }
    }
    i = j + 1;
  }
  return out;
}
const next = prune(css).replace(/\n{3,}/g, '\n\n');
console.log(`rules removed: ${removed} · ${css.length} → ${next.length} bytes`);
if (process.argv.includes('--write')) fs.writeFileSync(path.join(docs, 'css/app.css'), next);
