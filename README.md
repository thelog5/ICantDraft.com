# DraftSite - Fantasy Basketball Analytics

Full-stack fantasy basketball analytics app with deterministic, math-based analytics.

## Run Locally

### Prerequisites
- Node.js 18+
- pnpm 9+
- PostgreSQL database

### Setup

1. Install dependencies:
```bash
pnpm install
```

2. Set up environment variables (create `.env` in repo root):
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/draftsite?schema=public"
PORT=3000
```

3. Generate Prisma client and run migrations:
```bash
pnpm prisma:generate
pnpm prisma:migrate
```

### Development

Run the API server:
```bash
pnpm -C apps/api dev
```

Run the web frontend (in a separate terminal):
```bash
pnpm -C apps/web dev
```

- API: http://localhost:3000
- Web: http://localhost:5173

## Project Structure

- `apps/api` - Express API server
- `apps/web` - Vite + React frontend
- `apps/worker` - Background jobs
- `packages/provider-clients` - ESPN/Yahoo API clients
- `packages/security` - Encryption utilities
- `prisma` - Database schema

