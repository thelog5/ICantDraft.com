# DraftSite — Fantasy Basketball Analytics

DraftSite is a full-stack fantasy basketball analytics platform that ingests ESPN league data and computes deterministic, math-based 9-category analytics. No machine learning, no LLMs — all analytics are math-based, transparent, and reproducible.

The goal of this project is to mirror how competitive fantasy basketball leagues are actually evaluated, while being built like a real production system.

---

## Features
- ESPN fantasy league ingestion using authenticated requests
- Deterministic 9-category (9-cat) fantasy analytics
- League-wide z-score normalization
- Attempt-weighted FG% and FT%
- Inverted turnover scoring
- League power rankings
- Individual team profile analytics
- React dashboard wired directly to backend API

---

## Tech Stack
Backend: Node.js, TypeScript, Express, Prisma, PostgreSQL  
Frontend: React, Vite, TypeScript  

---

## Analytics Model
The platform uses a standard 9-category fantasy basketball scoring model:
Points, Rebounds, Assists, Steals, Blocks, 3PT Made, FG%, FT%, Turnovers (inverted).

Analytics flow:
1. Player stats are aggregated into team totals
2. League-wide means and standard deviations are computed
3. Teams receive per-category z-scores
4. Z-scores are converted into win probabilities via a normal CDF
5. Category probabilities are summed into a normalized 0–9 team score

All calculations are deterministic and computed server-side.

---

## Local Development

Prerequisites:
Node.js 18+
pnpm 9+
PostgreSQL

---

### Environment setup:
Create a .env file in the repository root (do NOT commit it):

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/draftsite?schema=public"
PORT=3000

# ESPN authentication (from browser cookies)
ESPN_LEAGUE_ID="YOUR_LEAGUE_ID"
ESPN_SEASON_ID="2026"
ESPN_S2="YOUR_ESPN_S2_COOKIE"
ESPN_SWID="{YOUR_SWID_COOKIE}"

# Optional
ESPN_PLATFORM_VERSION="ec4491ff98dc3a672229031f460410e0746d6ecc"
ESPN_BASE_URL="https://lm-api-reads.fantasy.espn.com"

Sensitive values are excluded via .gitignore.
```

---

### Install
pnpm install

---

### Database Setup
pnpm prisma:generate
pnpm prisma:migrate

---

### Run API
pnpm -C apps/api dev
API runs on http://localhost:3000

---

### Run Web
pnpm -C apps/web dev
Web runs on http://localhost:5173

---

### Project Structure
apps/api  — Express API + analytics engine  
apps/web  — React + Vite frontend  
prisma    — Database schema and migrations  
docs      — Architecture notes and screenshots (optional)

---

### Design Principles
- Deterministic analytics only
- No black-box models
- Attempt-weighted percentages
- Inverted turnover scoring
- Clear separation between ingestion, analytics, and UI
- Built like a real backend-driven system

---

### Status
DraftSite is under active development. Current focus areas include UI refinement, analytics expansion, and performance improvements.
