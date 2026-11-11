# Bundled sample league

Captured on 2026-11-11 from the application's public demo endpoints at
https://i-cant-draft-com-api-navy.vercel.app. The API and demo database responded
successfully at capture time; an expired database trial was not established.

The snapshot contains archived league statistics and sample schedules, not current
ESPN data. Trade proposals retain their archived grades and are labeled accordingly.
Team profiles are recalculated with the shared ranking functions. Player portraits
use HTTPS ESPN URLs rather than depending on the API image proxy.

The sample is selected explicitly by `leagueKeyInput: sample-demo`. Live league
failures never silently fall back to sample data. The sample requires only the web
host; no database, credentials, or ESPN requests are required to browse its data.
Streaming counting-stat impact is calculated locally. Free-agent shooting attempt
volumes are missing from the snapshot, so percentage impact is reported unavailable.

Regression checks: `pnpm exec tsx --test tests/*.test.ts` from the repository root.
