# DraftSite – Fantasy Basketball Analytics

Full-stack fantasy basketball analytics app for ESPN leagues. Ingests league + roster data, stores it with Prisma/Postgres, and computes deterministic 9-category rankings (z-scores + category ranks + overall score) with a React dashboard.

## Screenshots

### League Dashboard
![League Dashboard](apps/web/public/screens/01-dashboard.png)

### Team Profile
![Team Profile](apps/web/public/screens/02-team-profile.png)

### API – Power Rankings
![API Power Rankings](apps/web/public/screens/03-api-power-rankings.png)

### ESPN Ingestion
![ESPN Ingestion](apps/web/public/screens/04-ingest-success.png)

## Features

- ESPN league ingestion (league, teams, players, roster slots)
- Deterministic 9-cat analytics (no LLMs): totals → z-scores → category ranks → overall score
- League dashboard (power rankings)
- Team profile view (category breakdown)
- Prisma + Postgres persistence

## Run Locally

### Prerequisites
- Node.js 18+
- pnpm 9+
- PostgreSQL

### Setup
```bash
pnpm install
