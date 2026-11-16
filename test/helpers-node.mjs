// The checker for tests that run in Node only (no browser, no Playwright).
export function checker() { let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); }; return { check, bad: () => bad }; }
