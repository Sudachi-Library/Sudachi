#!/bin/sh
# Before every deploy: write the module list into the service worker and bump its cache name from the content hash.
cd "$(dirname "$0")" || exit 1
LIST=$(ls docs/js/*.js | xargs -n1 basename | sed 's/\.js$//' | grep -v '^app$' | grep -v '^util$' | sed "s/.*/'&'/" | paste -sd, -)
H=$(cat docs/js/*.js docs/css/app.css docs/index.html docs/manifest.webmanifest | sha256sum | cut -c1-10)
sed -i "s/^const JS = \[.*\];/const JS = [$LIST];/" docs/sw.js
sed -i "s/^const CACHE = 'sudachi-[^']*';/const CACHE = 'sudachi-$H';/" docs/sw.js
echo "sw cache: sudachi-$H"
