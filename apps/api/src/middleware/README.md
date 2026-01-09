# Demo Scope Middleware

This middleware and helper functions enable demo mode for the API, allowing users to interact with snapshot data without needing real ESPN credentials.

## Overview

The demo scope system works by:
1. Setting a `demo_snapshot` cookie when a demo session starts
2. Using middleware to detect the cookie and set request context
3. Using helper functions to scope all database queries to the demo snapshot

## Middleware

### `demoScopeMiddleware`

Applied globally to all requests. Checks for the `demo_snapshot` cookie and sets `req.demoScope`:

```typescript
req.demoScope = {
  demoSnapshotId: string | null,  // The demo snapshot ID if in demo mode
  isDemo: boolean,                 // true if in demo mode
}
```

## Helper Functions

All helper functions automatically scope queries based on the `demoSnapshotId` parameter:
- If `demoSnapshotId` is provided, only returns data with that snapshot ID
- If `null`, only returns live data (where `demoSnapshotId` is `null`)

### `getLeagueScoped(leagueId, demoSnapshotId)`

Gets a league with demo scope validation.

```typescript
const league = await getLeagueScoped(
  req.params.leagueId,
  req.demoScope?.demoSnapshotId || null
);

if (!league) {
  return res.status(404).json({ error: 'League not found' });
}
```

### `getTeamScoped(teamId, demoSnapshotId)`

Gets a team with demo scope validation.

```typescript
const team = await getTeamScoped(
  req.params.teamId,
  req.demoScope?.demoSnapshotId || null
);
```

### `getTeamsScoped(leagueId, demoSnapshotId)`

Gets all teams for a league with demo scope validation.

```typescript
const teams = await getTeamsScoped(
  req.params.leagueId,
  req.demoScope?.demoSnapshotId || null
);
```

### `getPlayersScoped(leagueId, demoSnapshotId)`

Gets all players for a league with demo scope validation.

```typescript
const players = await getPlayersScoped(
  req.params.leagueId,
  req.demoScope?.demoSnapshotId || null
);
```

### `getRosterSlotsScoped(leagueId, teamId, demoSnapshotId)`

Gets roster slots with demo scope validation.

```typescript
const rosterSlots = await getRosterSlotsScoped(
  req.params.leagueId,
  req.params.teamId,
  req.demoScope?.demoSnapshotId || null
);
```

### `validateLeagueScope(leagueId, demoSnapshotId)`

Validates that a league exists and belongs to the current scope. Throws an error if not.

```typescript
try {
  await validateLeagueScope(
    req.params.leagueId,
    req.demoScope?.demoSnapshotId || null
  );
  // League is valid, proceed...
} catch (error) {
  return res.status(403).json({ error: 'League not accessible' });
}
```

### `validateTeamScope(teamId, demoSnapshotId)`

Validates that a team exists and belongs to the current scope. Throws an error if not.

## Updating Existing Endpoints

### Before (without demo scope):

```typescript
app.get('/api/league/:leagueId', async (req, res) => {
  const league = await prisma.league.findUnique({
    where: { id: req.params.leagueId },
    include: { teams: true },
  });
  
  if (!league) {
    return res.status(404).json({ error: 'League not found' });
  }
  
  res.json({ league });
});
```

### After (with demo scope):

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

## Manual Query Scoping

If you need to write custom Prisma queries, add the demo scope filter manually:

```typescript
const where: any = {
  leagueId: req.params.leagueId,
};

// Add demo scope
if (req.demoScope?.demoSnapshotId) {
  where.demoSnapshotId = req.demoScope.demoSnapshotId;
} else {
  where.demoSnapshotId = null;
}

const results = await prisma.team.findMany({ where });
```

## Demo Routes

### `GET /demo/snapshots`

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
      "sourceLeagueId": "550e8400-e29b-41d4-a716-446655440000"
    }
  ]
}
```

### `POST /demo/start`

Starts a demo session with a specific snapshot.

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
  "leagueId": "7a3c1b2d-8f4e-9a1c-2d3e-4f5a6b7c8d9e",
  "teamId": "9f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "snapshotLabel": "Demo League 2025",
  "league": {
    "id": "7a3c1b2d-8f4e-9a1c-2d3e-4f5a6b7c8d9e",
    "name": "Waterloo Fantasy League",
    "seasonYear": 2026,
    "teamCount": 14
  },
  "team": {
    "id": "9f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
    "name": "Team Alpha",
    "managerName": "Manager 1"
  }
}
```

Sets an HttpOnly cookie: `demo_snapshot=demo_v1`

### `POST /demo/end`

Ends the current demo session by clearing the cookie.

**Response:**
```json
{
  "ok": true,
  "message": "Demo session ended"
}
```

### `GET /demo/status`

Checks the current demo session status.

**Response (in demo mode):**
```json
{
  "ok": true,
  "isDemo": true,
  "demoSnapshotId": "demo_v1",
  "snapshotLabel": "Demo League 2025",
  "league": {
    "id": "7a3c1b2d-8f4e-9a1c-2d3e-4f5a6b7c8d9e",
    "name": "Waterloo Fantasy League",
    "seasonYear": 2026
  }
}
```

**Response (not in demo mode):**
```json
{
  "ok": true,
  "isDemo": false,
  "demoSnapshotId": null
}
```

## Security

- The `demo_snapshot` cookie is **HttpOnly**, preventing JavaScript access
- Cookie is **Secure** in production (HTTPS only)
- Cookie uses **SameSite=Lax** for CSRF protection
- Cookie expires after 24 hours
- All queries are automatically scoped to prevent cross-contamination between demo and live data

## Best Practices

1. **Always use helper functions** instead of direct Prisma queries when dealing with leagues, teams, players, or roster slots
2. **Check `req.demoScope?.isDemo`** if you need to conditionally disable features in demo mode
3. **Never allow writes** to demo data - demo snapshots should be read-only
4. **Validate scope** before performing any operations that modify data

