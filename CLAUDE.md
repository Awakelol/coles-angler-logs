# CLAUDE.md

## Changelog

The changelog is `js/data/changelog.js` (shown in Settings and read by an
external portfolio site). When you finish a feature or meaningful change, add a
changelog entry (mark it `portfolio: true` if user-facing) and update the
`STATUS` block if anything there changed. Releasing an entry also means
updating `APP_VERSION` and bumping `CACHE_VERSION` in `sw.js`.
