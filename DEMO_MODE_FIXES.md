# Demo Mode Fixes

## Issues Fixed

### 1. ✅ Team Default Changed to "bron and em"
**Problem:** Demo mode was defaulting to team 1 (index 0)  
**Solution:** Changed demo endpoints to find team by name "bron and em"
- Searches for team containing both "bron" and "em" (case insensitive)
- Falls back to team 8 (index 7) if not found by name
- Falls back to first team if league has fewer than 8 teams
- Updated sorting to use `providerTeamId` instead of `name` to maintain ESPN's original team order

**Files:** 
- `apps/api/src/routes/demo.ts` - `/demo/start` endpoint
- `apps/api/src/routes/auth.ts` - `/auth/demo/info` endpoint

### 2. ✅ Added Demo Scope to Roster Endpoint
**Problem:** Endpoints were not using demo scope filtering  
**Solution:** Updated `/leagues/:leagueId/teams/:teamId/roster` endpoint to use scoped helpers

**File:** `apps/api/src/index.ts` (line 331-382)

### 3. ✅ Imported Demo Scope Helpers
**Problem:** Helpers weren't available in main router  
**Solution:** Added imports at top of index.ts

**File:** `apps/api/src/index.ts` (lines 84-91)

## How Demo Mode Works Without ESPN Credentials

### Database-Only Endpoints (Already Work)
Most endpoints already use the database and don't fetch from ESPN:
- ✅ `/leagues/:leagueId/teams/:teamId/roster` - Now uses demo scope
- ✅ `/leagues/:leagueId/teams` - Returns teams from DB
- ✅ `/leagues/:leagueId/power-rankings` - Calculates from DB data
- ✅ `/leagues/:leagueId/teams/:teamId/profile` - Uses DB data
- ✅ `/leagues/:leagueId/overview` - Uses DB data

These endpoints will work in demo mode once updated to use the scoped helpers.

### Endpoints That Need ESPN Credentials (Need Conditional Logic)
These endpoints fetch fresh data from ESPN and need to be updated:
- ⚠️ `/debug/espn` - Debug endpoint, can skip in demo mode
- ⚠️ `/leagues/:leagueId/matchup/current` - May need live ESPN data
- ⚠️ Any endpoints that call ESPN API directly

## Pattern for Updating Endpoints

### Before (Direct Prisma):
```typescript
app.get("/leagues/:leagueId/some-endpoint", async (req, res) => {
  const league = await prisma.league.findUnique({
    where: { id: req.params.leagueId },
  });
  
  const teams = await prisma.team.findMany({
    where: { leagueId: req.params.leagueId },
  });
  
  // ... rest of endpoint
});
```

### After (With Demo Scope):
```typescript
app.get("/leagues/:leagueId/some-endpoint", async (req, res) => {
  const demoSnapshotId = req.demoScope?.demoSnapshotId || null;
  
  const league = await getLeagueScoped(req.params.leagueId, demoSnapshotId);
  if (!league) {
    return res.status(404).json({ error: "League not found" });
  }
  
  const teams = await getTeamsScoped(req.params.leagueId, demoSnapshotId);
  
  // ... rest of endpoint
});
```

## Testing Demo Mode

### 1. Create a Demo Snapshot
```bash
pnpm --filter api demo:snapshot \
  --leagueId YOUR_LEAGUE_ID \
  --label "Test Demo"
```
Note the auto-generated snapshot ID from output.

### 2. Start Demo Session
```bash
curl -X POST http://localhost:3001/demo/start \
  -H "Content-Type: application/json" \
  -d '{"snapshotId": "demo_m8n2x4p_a1b2c3d4e5f6g7h8"}' \
  -c cookies.txt -b cookies.txt
```

### 3. Test Endpoint
```bash
# Use the leagueId and teamId from the start response
curl http://localhost:3001/leagues/LEAGUE_ID/teams/TEAM_ID/roster \
  -b cookies.txt
```

### 4. Verify Team is Team 8
Check the response - the teamId should correspond to the 8th team in your league (not the first team).

## Remaining Work

### Priority 1: Update Core Endpoints
Update these endpoints to use demo scope helpers:

1. ⏳ `/leagues/:leagueId/teams/:teamId/roster/stats`
2. ⏳ `/leagues/:leagueId/weekly-projections`
3. ⏳ `/leagues/:leagueId/free-agents`
4. ⏳ `/leagues/:leagueId/streaming/*` (all streaming endpoints)
5. ⏳ `/leagues/:leagueId/teams/:teamId/trade-suggestions`
6. ⏳ `/leagues/:leagueId/power-rankings`
7. ⏳ `/leagues/:leagueId/standings`
8. ⏳ `/leagues/:leagueId/matchup/current`

### Priority 2: Add Conditional ESPN Fetching
For endpoints that DO need to fetch from ESPN:

```typescript
// If in demo mode, skip ESPN fetch
if (req.demoScope?.isDemo) {
  // Use database snapshot data only
  return res.json({ /* data from DB */ });
}

// If NOT in demo mode, check for ESPN credentials
const espn_s2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;

if (!espn_s2 || !swid) {
  return res.status(401).json({ 
    error: "ESPN credentials required for live mode" 
  });
}

// Fetch from ESPN...
```

## Key Files

- `apps/api/src/index.ts` - Main router (partially updated)
- `apps/api/src/routes/demo.ts` - Demo endpoints (✅ fixed)
- `apps/api/src/middleware/demoScope.ts` - Helper functions (✅ ready)
- `apps/api/scripts/createDemoSnapshot.ts` - Snapshot creation (✅ ready)

## Current Status

✅ **Demo infrastructure is complete**
✅ **Team 8 default is working**
✅ **One endpoint updated as example**
⏳ **Other endpoints need similar updates**

Demo mode will work fully without ESPN credentials once all endpoints are updated to use the scoped helper functions.

