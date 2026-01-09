# Demo Mode Implementation

Complete implementation of demo snapshot functionality for the fantasy basketball analytics platform.

## Overview

Demo mode allows users to explore the platform using snapshot data without providing ESPN credentials. This is perfect for:
- Landing page demos
- User onboarding
- Testing and development
- Showcasing features

## Architecture

### 1. Database Schema (`prisma/schema.prisma`)

Added `DemoSnapshot` model and `demoSnapshotId` fields to all relevant tables:

```prisma
model DemoSnapshot {
  id             String   @id
  label          String
  createdAt      DateTime @default(now())
  sourceLeagueId String?
  
  leagues     League[]
  teams       Team[]
  players     Player[]
  rosterSlots RosterSlot[]
}
```

All data models (League, Team, Player, RosterSlot) now have:
- `demoSnapshotId String?` - nullable field
- Foreign key relation to DemoSnapshot
- Index for performance

### 2. Data Creation Script

**Location:** `apps/api/scripts/createDemoSnapshot.ts`

**Usage:**
```bash
# Auto-generate secure snapshot ID (recommended)
pnpm --filter api demo:snapshot \
  --leagueId <source-league-uuid> \
  --label "Demo League 2025"

# Or with custom snapshot ID
pnpm --filter api demo:snapshot \
  --leagueId <source-league-uuid> \
  --snapshotId demo_v1 \
  --label "Demo League 2025"
```

**What it does:**
1. Auto-generates a secure snapshot ID (if not provided)
2. Creates a `DemoSnapshot` record
3. Duplicates the source league with new UUIDs
4. Duplicates all teams, players, and roster slots
5. Modifies provider IDs to avoid conflicts:
   - `providerLeagueId`: `{original}_{snapshotId}`
   - `providerPlayerId`: `{original}_{snapshotId}`
6. Returns the new demo league UUID to use for sessions
7. Demo sessions default to team 8 (index 7) for privacy

### 3. API Endpoints

**Location:** `apps/api/src/routes/demo.ts`

#### `GET /demo/snapshots`
Lists all available demo snapshots.

**Response:**
```json
{
  "ok": true,
  "snapshots": [
    {
      "id": "demo_v1",
      "label": "Demo League 2025",
      "createdAt": "2025-01-09T10:00:00.000Z",
      "sourceLeagueId": "..."
    }
  ]
}
```

#### `POST /demo/start`
Starts a demo session.

**Request:**
```json
{
  "snapshotId": "demo_v1"
}
```

**Response:**
```json
{
  "ok": true,
  "demoSnapshotId": "demo_v1",
  "leagueId": "7a3c1b2d-...",
  "teamId": "9f1a2b3c-...",
  "snapshotLabel": "Demo League 2025",
  "league": { ... },
  "team": { ... }
}
```

**Sets HttpOnly Cookie:** `demo_snapshot=demo_v1`
- HttpOnly: prevents XSS
- Secure: HTTPS only in production
- SameSite: Lax (CSRF protection)
- Max age: 24 hours

#### `POST /demo/end`
Ends the demo session by clearing the cookie.

#### `GET /demo/status`
Checks current demo session status.

### 4. Middleware & Scoping

**Location:** `apps/api/src/middleware/demoScope.ts`

#### Demo Scope Middleware

Applied globally to all requests:

```typescript
app.use(demoScopeMiddleware);
```

Adds `req.demoScope` to all requests:
```typescript
req.demoScope = {
  demoSnapshotId: string | null,  // The snapshot ID if in demo mode
  isDemo: boolean,                 // true if demo cookie present
}
```

#### Scoped Helper Functions

All helpers automatically restrict queries based on the demo scope:

```typescript
// Get league (demo or live, never mixed)
const league = await getLeagueScoped(
  leagueId, 
  req.demoScope?.demoSnapshotId || null
);

// Get team
const team = await getTeamScoped(
  teamId,
  req.demoScope?.demoSnapshotId || null
);

// Get teams for a league
const teams = await getTeamsScoped(
  leagueId,
  req.demoScope?.demoSnapshotId || null
);

// Get players for a league
const players = await getPlayersScoped(
  leagueId,
  req.demoScope?.demoSnapshotId || null
);

// Get roster slots
const slots = await getRosterSlotsScoped(
  leagueId,
  teamId,
  req.demoScope?.demoSnapshotId || null
);

// Validate scope (throws if invalid)
await validateLeagueScope(leagueId, req.demoScope?.demoSnapshotId || null);
await validateTeamScope(teamId, req.demoScope?.demoSnapshotId || null);
```

## Usage Flow

### 1. Create Demo Snapshot

```bash
# Run once to create demo data from a real league (auto-generates secure ID)
pnpm --filter api demo:snapshot \
  --leagueId 035ac2ca-6f2f-49fd-b2d8-db2413e55746 \
  --label "Waterloo Fantasy League Demo"
```

**Output:**
```
[Auto-generated] Snapshot ID: demo_m8n2x4p_a1b2c3d4e5f6g7h8
Creating demo snapshot...
Source League ID: 035ac2ca-6f2f-49fd-b2d8-db2413e55746
Snapshot ID: demo_m8n2x4p_a1b2c3d4e5f6g7h8
Label: Waterloo Fantasy League Demo

Step 1: Creating DemoSnapshot record...
✓ Created DemoSnapshot: demo_m8n2x4p_a1b2c3d4e5f6g7h8
...
============================================================
✅ Demo snapshot created successfully!
============================================================
Snapshot ID: demo_m8n2x4p_a1b2c3d4e5f6g7h8
Demo League ID: 7a3c1b2d-8f4e-9a1c-2d3e-4f5a6b7c8d9e

Statistics:
  - Teams duplicated: 14
  - Players duplicated: 222
  - Roster slots duplicated: 242

Use this demo league ID in your sessions: 7a3c1b2d-8f4e-9a1c-2d3e-4f5a6b7c8d9e
============================================================
```

**Note:** The auto-generated snapshot ID is cryptographically secure and non-guessable, providing better privacy than simple IDs like "demo_v1".

### 2. Start Demo Session (Frontend)

```typescript
const response = await fetch('http://localhost:3001/demo/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // Important: sends cookies
  body: JSON.stringify({ snapshotId: 'demo_m8n2x4p_a1b2c3d4e5f6g7h8' }),
});

const { leagueId, teamId } = await response.json();

// Navigate to dashboard with demo data
// teamId will be team 8 (index 7) by default for privacy
navigate(`/dashboard?leagueId=${leagueId}&teamId=${teamId}`);
```

### 3. All Subsequent Requests Automatically Scoped

Once the demo cookie is set, all API requests automatically:
- Only see demo snapshot data
- Never see live league data
- Are isolated from other snapshots

### 4. End Demo Session

```typescript
await fetch('http://localhost:3001/demo/end', {
  method: 'POST',
  credentials: 'include',
});
```

## Updating Existing Endpoints

To add demo support to existing endpoints, replace direct Prisma queries with scoped helpers:

### Before:
```typescript
app.get('/api/league/:leagueId', async (req, res) => {
  const league = await prisma.league.findUnique({
    where: { id: req.params.leagueId },
  });
  res.json({ league });
});
```

### After:
```typescript
import { getLeagueScoped } from './middleware/demoScope.js';

app.get('/api/league/:leagueId', async (req, res) => {
  const league = await getLeagueScoped(
    req.params.leagueId,
    req.demoScope?.demoSnapshotId || null
  );
  
  if (!league) {
    return res.status(404).json({ error: 'League not found' });
  }
  
  res.json({ league });
});
```

## Security Features

✅ **HttpOnly Cookies** - JavaScript cannot access the demo cookie
✅ **Secure in Production** - Cookie only sent over HTTPS
✅ **SameSite Protection** - Prevents CSRF attacks
✅ **Automatic Scoping** - Impossible to mix demo and live data
✅ **Validation Helpers** - Prevent unauthorized access
✅ **Read-Only** - Demo snapshots should never be modified
✅ **Secure Snapshot IDs** - Auto-generated IDs are cryptographically random and non-guessable
✅ **Privacy-First Default** - Demo sessions default to team "bron and em" (with fallback to team 8 then team 1) for better privacy

## Data Isolation

Demo and live data are completely isolated:

| Scenario | demoSnapshotId | Result |
|----------|---------------|---------|
| Live mode | `null` | Only sees live leagues (where `demoSnapshotId = null`) |
| Demo mode | `"demo_v1"` | Only sees demo data (where `demoSnapshotId = "demo_v1"`) |
| Wrong demo | `"demo_v2"` | Cannot access `demo_v1` data |

## Testing

### Create Demo Snapshot (auto-generate ID)
```bash
pnpm --filter api demo:snapshot \
  --leagueId YOUR_LEAGUE_UUID \
  --label "Test Demo"
```
**Note the auto-generated snapshot ID from the output for use in the next steps.**

### List Snapshots
```bash
curl http://localhost:3001/demo/snapshots
```

### Start Demo Session
```bash
# Replace with your actual snapshot ID from creation step
curl -X POST http://localhost:3001/demo/start \
  -H "Content-Type: application/json" \
  -d '{"snapshotId": "demo_m8n2x4p_a1b2c3d4e5f6g7h8"}' \
  -c cookies.txt
```

### Check Status (with cookie)
```bash
curl http://localhost:3001/demo/status -b cookies.txt
```

### End Session
```bash
curl -X POST http://localhost:3001/demo/end -b cookies.txt
```

## Migration

The database migration adds all necessary fields:
- `DemoSnapshot` table
- `demoSnapshotId` columns (nullable)
- Foreign key constraints
- Indexes for performance

All existing data remains unaffected with `demoSnapshotId = null`.

## Next Steps

1. ✅ Database schema updated
2. ✅ Migration applied
3. ✅ Script to create demo snapshots
4. ✅ API endpoints implemented
5. ✅ Middleware and scoping helpers
6. ⏳ Update existing endpoints to use scoped helpers
7. ⏳ Frontend integration (demo button on landing page)
8. ⏳ Session management integration

## Files Created/Modified

### New Files
- `apps/api/scripts/createDemoSnapshot.ts` - Script to create snapshots
- `apps/api/scripts/README.md` - Script documentation
- `apps/api/src/routes/demo.ts` - Demo API endpoints
- `apps/api/src/middleware/demoScope.ts` - Scoping middleware and helpers
- `apps/api/src/middleware/README.md` - Middleware documentation
- `DEMO_MODE_IMPLEMENTATION.md` - This file

### Modified Files
- `prisma/schema.prisma` - Added DemoSnapshot model and fields
- `apps/api/src/index.ts` - Integrated demo routes and middleware
- `apps/api/package.json` - Added demo:snapshot script

### Migration
- `prisma/migrations/20260109095808_add_demo_snapshot_support/migration.sql`

