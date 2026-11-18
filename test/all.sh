#!/bin/bash
# Runs every test; exits non-zero if any fails. Deploy only when this passes.
cd "$(dirname "$0")/.."; fail=0
export TZ=Asia/Riyadh
for t in check-imports; do out=$(node tools/$t.mjs 2>&1); code=$?; if [ $code -ne 0 ]; then echo "✗ $t"; echo "$out" | head -8; fail=1; else echo "✓ $t"; fi; done
for t in sudachi hub cloud smoke; do
  out=$(timeout 600 node test/$t.mjs 2>&1); code=$?
  if [ $code -ne 0 ] || echo "$out" | grep -q "✗\|FAILED"; then echo "✗ $t"; echo "$out" | grep -E "✗|FAILED|Error" | head -6; fail=1; else echo "✓ $t"; fi
done
exit $fail
