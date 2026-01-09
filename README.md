# ICantDraft.com — Fantasy Basketball Analytics Platform

Live site: https://i-cant-draft-com-web.vercel.app

ICantDraft.com is a full-stack fantasy basketball analytics platform that ingests ESPN league data and produces deterministic, math-driven insights for competitive 9-category fantasy basketball leagues.

The platform intentionally avoids machine learning and black-box models. All analytics are transparent, reproducible, and derived from well-defined statistical methods that mirror how experienced fantasy managers actually evaluate leagues.

---

## Project Goals

- Reflect real competitive fantasy basketball decision-making
- Provide actionable insights rather than raw statistics
- Maintain deterministic, debuggable analytics
- Separate season-long evaluation from weekly matchup strategy

---

## Core Features

### League and Team Analytics
- ESPN fantasy league ingestion via authenticated requests
- Deterministic 9-category analytics:
  - Points, Rebounds, Assists, Steals, Blocks, 3PT Made, FG%, FT%, Turnovers (inverted)
- League-wide normalization using z-scores (internal only; not exposed in the UI)
- Attempt-weighted FG% and FT%
- Inverted turnover scoring
- Stable season-level category rankings based on per-game averages
- Team profile pages including:
  - Category strengths and weaknesses
  - Relative league rankings
  - Clear visual breakdowns designed for decision-making

---

### Weekly Matchup Analysis
- Projected matchup score using weekly projections
- Live matchup score using current matchup totals
- Side-by-side projected versus live views
- Per-category win/loss indicators
- Closest category detection:
  - Projected biggest contentions
  - Live biggest contentions
- Final focus recommendations that combine:
  - Projected closeness
  - Live score volatility
  - Category swing potential

---

### Streaming (Waiver Pickup) Engine
- Day-by-day streaming recommendations
- Free-agent filtering strictly by players active on the selected date
- Weekly schedule visualization with daily pickup slots
- Streaming recommendations account for:
  - Closest contested categories
  - Category-specific contributions
  - Avoiding excessive damage to FG% and FT%
- Impact previews showing how pickups change weekly totals
- Drop candidate analysis based on player value (not team fit):
  - Uses roster percentage and relative value
  - Avoids recommending high-value players as drops
- Distinction between:
  - Targeted category streaming
  - Volume-based streaming

---

### Trade Analysis Engine
- Balanced, plausible trade suggestions
- Supports single-player and multi-player trades
- Evaluates impact for both teams
- Trade grading for each side
- Metrics include:
  - Team score delta
  - Average category placement change
  - Category-level gains and losses
- Filters prevent unrealistic or lopsided trades
- Paginated results with relevance-based ordering

---

### Strategy Guidance
- Punt strategy recommendations derived from:
  - Category rankings
  - Relative league positioning
- Clear explanations of what punting means and when it is appropriate
- Strategy surfaced without exposing raw z-scores to users

---

### Dashboard
- Centralized dashboard displaying:
  - Trade recommendations
  - Streaming opportunities
  - Matchup status
- Designed for fast decision-making rather than data overload

---

## Analytics Model

The platform uses a standard 9-category fantasy basketball scoring framework:

- Points
- Rebounds
- Assists
- Steals
- Blocks
- 3PT Made
- FG%
- FT%
- Turnovers (inverted)

### Season-Level Analysis
- Uses per-game averages rather than cumulative totals
- Prevents week-to-week ranking volatility
- FG% and FT% computed using weighted makes and attempts

### Weekly Matchups
- Weekly projections used for forward-looking analysis
- Live totals used for real-time matchup state
- Category outcomes evaluated independently

All calculations are deterministic and computed server-side.

---

## Tech Stack

### Backend
- Node.js
- TypeScript
- Express
- Prisma
- PostgreSQL

### Frontend
- React
- Vite
- TypeScript

---

## Deployment

### Live (Vercel)
This repo is deployed as two Vercel projects:
- Web: https://i-cant-draft-com-web.vercel.app
- API: deployed separately (web is configured to call the API via VITE_API_BASE_URL)

Demo mode is supported via a database snapshot so the site can be explored without requiring a user's ESPN cookies.

---

## Local Development

### Prerequisites
- Node.js 18+
- pnpm 9+
- PostgreSQL

---

### Environment Setup

Create a .env file in the repository root (do not commit it):

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/draftsite?schema=public"
PORT=3000

ESPN_LEAGUE_ID="YOUR_LEAGUE_ID"
ESPN_SEASON_ID="2026"
ESPN_S2="YOUR_ESPN_S2_COOKIE"
ESPN_SWID="{YOUR_SWID_COOKIE}"

ESPN_PLATFORM_VERSION="ec4491ff98dc3a672229031f460410e0746d6ecc"
ESPN_BASE_URL="https://lm-api-reads.fantasy.espn.com"

---

### Install Dependencies

pnpm install

---

### Database Setup

pnpm prisma:generate
pnpm prisma:migrate

---

### Run Backend API

pnpm -C apps/api dev

API runs on:
http://localhost:3000

---

### Run Frontend

pnpm -C apps/web dev

Web runs on:
http://localhost:5173

---

## Project Structure

apps/api   — Express API and analytics engine  
apps/web   — React and Vite frontend  
prisma     — Database schema and migrations  
docs       — Architecture notes and screenshots (optional)

---

## Repo Cleanup Suggestions (for a “finished product” feel)

- Add screenshots/video section to README (already started above)
- Add docs/ folder:
  - docs/ARCHITECTURE.md (high-level system diagram + data flow)
  - docs/DEPLOYMENT.md (Vercel setup, env vars, demo snapshot flow)
- Add CONTRIBUTING.md with:
  - dev setup steps
  - lint/test commands
  - branching conventions
- Add a CHANGELOG.md (optional) or GitHub Releases
- Add a root-level LICENSE if you plan to share publicly
- Add status badges (build/deploy) if you want polish

---
