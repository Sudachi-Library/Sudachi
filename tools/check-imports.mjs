// Every named import and every `X.name` use of a namespace import must exist in the module it comes from.
// Run: node tools/check-imports.mjs  (fails with a list when something is missing)
import fs from 'node:fs'; import path from 'node:path';
const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../docs/js');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
const exportsOf = new Map();
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8'), ex = new Set();
  for (const m of t.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) ex.add(m[1]);
  for (const m of t.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const n of m[1].split(',')) ex.add(n.trim().split(/\s+as\s+/).pop());
  for (const m of t.matchAll(/^export\s+const\s+[^\n]*$/gm)) for (const x of m[0].matchAll(/,\s*([A-Z_][A-Z0-9_]*)\s*=/g)) ex.add(x[1]);   // export const A = 1, B = 2
  exportsOf.set(f, ex);
}
const bad = [];
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of t.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+\.js)'/g)) {
    const ex = exportsOf.get(m[2]); if (!ex) { bad.push(`${f}: imports missing file ${m[2]}`); continue; }
    for (const n of m[1].split(',').map(x => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) if (!ex.has(n)) bad.push(`${f}: ${n} is not exported by ${m[2]}`);
  }
  for (const m of t.matchAll(/import\s*\*\s*as\s*(\w+)\s*from\s*'\.\/([\w-]+\.js)'/g)) {
    const ex = exportsOf.get(m[2]); if (!ex) { bad.push(`${f}: imports missing file ${m[2]}`); continue; }
    const body = t.replace(/^import[^\n]*$/gm, '');
    const used = new Set([...body.matchAll(new RegExp(`\\b${m[1]}\\.([A-Za-z_$][\\w$]*)`, 'g'))].map(x => x[1]));
    for (const n of used) if (!ex.has(n)) bad.push(`${f}: ${m[1]}.${n} is not exported by ${m[2]}`);
  }
}
if (bad.length) { console.log(bad.map(b => '  ✗ ' + b).join('\n')); console.log(`FAILED: ${bad.length}`); process.exit(1); }
console.log(`  ✓ imports: ${files.length} modules, every name exists`);
