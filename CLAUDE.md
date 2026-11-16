# Sudachi — notes for Claude

- Owner's app: the media logger — books, comics & manga, games, anime, films, series, music albums. Split from Citrus Maxima (Amaerys/citrus-maxima) on 16/11/2026, the last of the split (after Mandarin, Clementine, Calamansi, Bergamot). Plain English in the UI, dates dd/mm/yyyy, the week starts on Sunday.
- Product decisions live in the Citrus Maxima project: `claude/sudachi-plan.md` (look, logging, backlog, tiers, reviews) and `claude/sudachi-handoff.md`.
- One data owner per kind: all media (titles, status, tiers, progress, log, plays, quotes, backlog, yearly media goals) → Sudachi. Shifts → Mandarin (`hub/mandarin/shifts.json`, read by `roster.js`, kinds of day by `day.js`). Aims → Citrus Plan (`hub/citrus/plan.json › goals.aims`; a media goal can link to one). Never write into another app's Drive folder.
- Drive: writes `My Apps/hub/sudachi/{state,status}.json` and `backups/`. Reads shifts, plan.json, and once `hub/citrus/state.json` (the Library migration, with Undo and a before-migration backup).
- status.json carries titles and counts only — never notes, reviews or quotes. Tests check this.
- The rating scale is the owner's own S–F tiers (`tiers.js`). Scores are 0–10 in half steps. Imported ratings are kept raw (`srcRating`, `srcScale`) and converted by percentile within the owner's ratings on that site (`auto: true`); a score the owner sets is never overwritten.
- Steam and MyAnimeList go through the owner's Apps Script relay (`relay.js`, script text in `RELAY_SCRIPT`); the Steam key lives only in the script's properties.
- Every delete and bulk change has Undo (`ctx.undoTo(before)` = replaceState with `exact`).
- Owner's facts the logic depends on: GP in Riyadh (Asia/Riyadh), 12-hour shifts 08:00–20:00 / 20:00–08:00, sleeps after nights.
- Before every deploy: `bash test/all.sh` must pass, then `sh scripts-bump.sh` (service worker module list and cache name).
- Never commit real titles from the owner's lists, names or notes: tests use made-up data (`test/fixture.mjs`); `test/data/` is git-ignored.
- Browser tests pin the clock (`page.clock.install`) and run in Asia/Riyadh.
- Add seminal upgrades to the App Building Master Log (skill: app-master-log).
