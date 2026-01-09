# API Scripts

## Create Demo Snapshot

Creates a demo snapshot from an existing league by duplicating all league data (teams, players, roster slots) into new rows with a demo snapshot ID.

### Usage

```bash
# From the root of the project
pnpm --filter api demo:snapshot --leagueId <league-uuid> [--snapshotId <snapshot-id>] [--label <label>]

# Or from apps/api directory
pnpm demo:snapshot --leagueId <league-uuid> [--snapshotId <snapshot-id>] [--label <label>]
```

### Arguments

- `--leagueId` (required): The UUID of the source league to duplicate
- `--snapshotId` (optional): The ID for the demo snapshot (e.g., "demo_v1"). If not provided, a secure random ID will be auto-generated
- `--label` (optional): A human-readable label for the snapshot (defaults to snapshotId)

### Examples

**With custom snapshot ID:**
```bash
pnpm --filter api demo:snapshot \
  --leagueId "550e8400-e29b-41d4-a716-446655440000" \
  --snapshotId "demo_v1" \
  --label "Demo League 2025"
```

**Auto-generate snapshot ID (recommended for security):**
```bash
pnpm --filter api demo:snapshot \
  --leagueId "550e8400-e29b-41d4-a716-446655440000" \
  --label "Demo League 2025"
```
This will generate a secure random ID like: `demo_m8n2x4p_a1b2c3d4e5f6g7h8`

### What It Does

1. Creates a `DemoSnapshot` record in the database
2. Duplicates the source league with a new UUID and sets `demoSnapshotId`
   - Modifies `providerLeagueId` to `{original}_{snapshotId}` to avoid unique constraint violations
3. Duplicates all teams belonging to that league (with new UUIDs)
4. Duplicates all players in the league (with new UUIDs)
   - Modifies `providerPlayerId` to `{original}_{snapshotId}` to avoid unique constraint violations
5. Duplicates all roster slots with proper references to the new teams/players
6. Preserves all meta and settings JSON data exactly
7. Prints the new demo league ID for use in demo sessions

### Output

The script will output:
- The new demo snapshot ID
- The new demo league UUID (use this in demo sessions)
- Statistics on duplicated data (teams, players, roster slots)

### Notes

- The demo data is completely self-contained with no references to the original league
- All duplicated records have `demoSnapshotId` set for easy querying
- Original league data remains unchanged
- Use transactions to ensure data integrity
- Auto-generated snapshot IDs are cryptographically secure and non-guessable
- Demo sessions default to the 8th team (index 7) in the league, or the first team if fewer than 8 teams exist

