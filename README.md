# DraftSite — Fantasy Basketball Analytics

Full-stack fantasy basketball analytics app that ingests ESPN league data and generates deterministic 9-category rankings (no LLMs — pure math).

## What it does
- **ESPN ingestion**: pulls league → teams → rosters → players into Postgres
- **Deterministic 9-cat analytics**:
  - aggregates team totals
  - computes league distribution (mean/std)
  - produces **z-scores**, **category ranks**, and a **power score**
- **Web dashboard**:
  - league power rankings table
  - team profile pages with detailed category stats

## Tech Stack
- **API**: Node + Express + Prisma
- **DB**: PostgreSQL
- **Web**: React + Vite + TypeScript
- **Monorepo**: pnpm workspaces

## Project Structure
- `apps/api` — Express API + ingestion + analytics endpoints
- `apps/web` — React dashboard UI
- `prisma` — schema + migrations

## API Endpoints (local)
- `POST /ingest/espn` — ingest league data from ESPN into DB
- `GET /leagues/:leagueId/power-rankings` — league-wide power rankings
- `GET /leagues/:leagueId/teams` — list teams in league
- `GET /leagues/:leagueId/teams/:teamId/profile` — team profile + z-scores + ranks

## Run Locally

### Prerequisites
- Node.js 18+
- pnpm 9+
- PostgreSQL running locally

### 1) Install deps
```bash
pnpm install
