# ICantDraft.com

**Fantasy basketball decisions, category by category: see where your roster wins, which trades improve it, and who to pick up before the week gets away from you.**

https://github.com/user-attachments/assets/8a3c1369-5863-4369-aebc-eb52e29ec3e2

**[Try it at ICantDraft.com](https://i-cant-draft-com-web.vercel.app)** · Built by [Logan Li](https://www.linkedin.com/in/logan-li-9089b7216/)

## What it is

In a nine-category league, the player with the most points isn't always the
player you need. You might already win points every week and keep losing
rebounds by three. ICantDraft looks at your roster in the context of your
league, then helps you decide which categories to protect and which ones you
can swing.

- **Overview:** your category ranks, current matchup, team profile, trades,
  and streaming suggestions in one place.
- **Weekly projections:** projected and recorded matchup scores side by
  side, with the closest categories called out.
- **Team analysis:** the full roster, player roles, strengths, weaknesses,
  and categories worth considering for a punt strategy.
- **Trade suggestions:** single-player and multi-player proposals with a
  grade for each team, category gains and losses, and expandable breakdowns.
- **Streaming:** a daily pickup schedule, free agents playing that day,
  category fit, impact previews, and potential drop candidates.

The public demo opens a saved league with real players and archived stats.
You can explore it without an account, ESPN cookies, or a running database.

## How it works

1. **League data.** The API ingests ESPN rosters, player statistics, league
   settings, and matchup data into PostgreSQL through Prisma.
2. **Category comparisons.** The analytics engine aggregates points,
   rebounds, assists, steals, blocks, threes, shooting percentages, and
   turnovers. Shooting percentages are weighted by attempts; fewer
   turnovers count as better. Teams tied in a category share an average rank.
3. **Team profiles.** Each category is compared with the league using
   z-scores. Those scores become percentiles and add up to a team score
   from 0 to 9, giving every category equal weight.
4. **Weekly decisions.** Player averages and scheduled games produce weekly
   projections. The app compares them with the opponent and the recorded
   matchup totals to identify categories where a small change could matter.
5. **Roster moves.** Trade analysis evaluates both teams before and after
   an exchange. Streaming ranks available players against the week's focus
   categories and shows their projected contributions.

The calculations live in the [analytics engine](apps/api/src/lib/analytics.ts),
[trade engine](apps/api/src/lib/tradeEngine.ts), and
[weekly projection helpers](apps/api/src/lib/weeklyProjections.ts).

## Engineering highlights

- **Shooting volume matters.** FG% and FT% use makes and attempts instead
  of averaging player percentages. A low-volume shooter's percentage cannot
  outweigh a high-volume player's just because the two share a roster.
- **Trades use a fixed baseline.** Before-and-after team scores use the
  same pre-trade league distribution. Trade grades use the score change;
  category rank movement is shown separately rather than counted twice.
- **Player fit uses comparable units.** Roster roles compare per-game
  production with other players on the roster. Shooting volume is also
  measured per game, so playing more games alone doesn't change a role.
- **The demo can stand on its own.** A bundled snapshot serves the sample
  views from the web host. Team profiles use the shared analytics functions;
  archived trade grades and illustrative schedules are labeled. A failed
  live request never silently switches to sample data.
- **Missing data stays explicit.** The sample's streaming impact calculates
  net counting stats. It reports shooting impact as unavailable when
  free-agent attempt data is missing.
- **Styles stay with their screen.** Route styles are scoped so opening
  projections or trades cannot restyle the dashboard. The six workspace
  screens share navigation, typography, controls, and a responsive layout.
- **Eight regression tests** cover weighted shooting, tied ranks, turnover
  direction, neutral scores, trade grading, player-fit stability, demo
  responses, and sample trade filters and streaming impact.

## Built with

TypeScript · React · Vite · Recharts · Node.js · Express · Prisma ·
PostgreSQL · pnpm workspaces · Vercel

## Status

Live at [i-cant-draft-com-web.vercel.app](https://i-cant-draft-com-web.vercel.app).
The frontend and API deploy as separate Vercel projects.

The [public demo](https://i-cant-draft-com-web.vercel.app/setup?demo=1) uses
archived league statistics and illustrative schedules. Its matchup scores
are saved data, and its trade proposals retain their archived grades.
Connecting an ESPN league uses the separate API and requires valid league
access and backend configuration.

More about the bundled data: [sample league notes](apps/web/public/demo/README.md).

## Run it locally

Use Node.js 22 or later and pnpm 9.15.

To explore the bundled demo, you only need the frontend:

```bash
pnpm install
pnpm --filter web dev
```

Open [localhost:5173/setup?demo=1](http://localhost:5173/setup?demo=1).
The sample works without configuring PostgreSQL or starting the API.

For the backend, create a local PostgreSQL database and add these settings to
an untracked `.env` file in the repository root:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/draftsite?schema=public"
PORT=3000
WEB_ORIGIN=http://localhost:5173
```

Use [`.env.example`](.env.example) for the ESPN ingestion settings. Keep real
credentials out of version control. Point the frontend at the local API by
adding this to `apps/web/.env.local`:

```dotenv
VITE_API_BASE_URL=http://localhost:3000
```

Generate the database client, apply migrations, and start the API in another
terminal:

```bash
pnpm prisma:generate
pnpm prisma:migrate
pnpm --filter api dev
```

Restart the frontend after changing its environment settings.

Run the checks from the repository root:

```bash
pnpm exec tsx --test tests/*.test.ts
pnpm typecheck
pnpm build
```

## Repository layout

| Path | Contents |
| --- | --- |
| [`apps/web/`](apps/web/) | React site, product screens, charts, and the bundled demo. |
| [`apps/api/`](apps/api/) | Express API, ESPN ingestion, analytics, trades, and streaming. |
| [`apps/worker/`](apps/worker/) | Worker entry point. |
| [`packages/`](packages/) | Provider-client and security package scaffolding. |
| [`prisma/`](prisma/) | Database schema and migrations. |
| [`tests/`](tests/) | Analytics and demo regression tests. |

ESPN data, player images, and team marks belong to their respective owners.
ICantDraft.com is not affiliated with ESPN or the NBA.
