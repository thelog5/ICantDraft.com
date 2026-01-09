import { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes } from 'crypto';

const prisma = new PrismaClient();

interface Args {
  leagueId: string;
  snapshotId: string;
  label?: string;
}

/**
 * Generate a secure random snapshot ID
 */
function generateSnapshotId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = randomBytes(8).toString('hex');
  return `demo_${timestamp}_${randomPart}`;
}

function parseArgs(): Args {
  const args: Partial<Args> = {};
  
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    
    if (arg === '--leagueId' && process.argv[i + 1]) {
      args.leagueId = process.argv[i + 1];
      i++;
    } else if (arg === '--snapshotId' && process.argv[i + 1]) {
      args.snapshotId = process.argv[i + 1];
      i++;
    } else if (arg === '--label' && process.argv[i + 1]) {
      args.label = process.argv[i + 1];
      i++;
    }
  }
  
  if (!args.leagueId) {
    throw new Error('Missing required argument: --leagueId');
  }
  
  // Auto-generate snapshot ID if not provided
  if (!args.snapshotId) {
    args.snapshotId = generateSnapshotId();
    console.log(`[Auto-generated] Snapshot ID: ${args.snapshotId}`);
  }
  
  return args as Args;
}

async function createDemoSnapshot() {
  const args = parseArgs();
  
  console.log('Creating demo snapshot...');
  console.log(`Source League ID: ${args.leagueId}`);
  console.log(`Snapshot ID: ${args.snapshotId}`);
  console.log(`Label: ${args.label || args.snapshotId}`);
  console.log('');
  
  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the DemoSnapshot
      console.log('Step 1: Creating DemoSnapshot record...');
      const snapshot = await tx.demoSnapshot.create({
        data: {
          id: args.snapshotId,
          label: args.label || args.snapshotId,
          sourceLeagueId: args.leagueId,
        },
      });
      console.log(`✓ Created DemoSnapshot: ${snapshot.id}`);
      console.log('');
      
      // 2. Fetch the source league
      console.log('Step 2: Fetching source league...');
      const sourceLeague = await tx.league.findUnique({
        where: { id: args.leagueId },
        include: {
          teams: true,
          players: true,
          rosterSlots: true,
        },
      });
      
      if (!sourceLeague) {
        throw new Error(`League with id ${args.leagueId} not found`);
      }
      console.log(`✓ Found league: ${sourceLeague.name}`);
      console.log(`  - Teams: ${sourceLeague.teams.length}`);
      console.log(`  - Players: ${sourceLeague.players.length}`);
      console.log(`  - Roster Slots: ${sourceLeague.rosterSlots.length}`);
      console.log('');
      
      // 3. Create new demo league with a new UUID
      console.log('Step 3: Duplicating league...');
      const newLeagueId = randomUUID();
      // Modify providerLeagueId to avoid unique constraint violation
      const demoProviderLeagueId = `${sourceLeague.providerLeagueId}_${args.snapshotId}`;
      
      const demoLeague = await tx.league.create({
        data: {
          id: newLeagueId,
          provider: sourceLeague.provider,
          sport: sourceLeague.sport,
          providerLeagueId: demoProviderLeagueId,
          name: sourceLeague.name,
          seasonYear: sourceLeague.seasonYear,
          commissionerUserId: sourceLeague.commissionerUserId,
          settings: sourceLeague.settings,
          demoSnapshotId: args.snapshotId,
        },
      });
      console.log(`✓ Created demo league with ID: ${demoLeague.id}`);
      console.log(`  Provider League ID: ${demoProviderLeagueId}`);
      console.log('');
      
      // 4. Create mapping of old team IDs to new team IDs
      console.log('Step 4: Duplicating teams...');
      const teamIdMap = new Map<string, string>();
      
      for (const sourceTeam of sourceLeague.teams) {
        const newTeamId = randomUUID();
        teamIdMap.set(sourceTeam.id, newTeamId);
        
        // Since teams are linked to the new league ID, the unique constraint
        // (leagueId, provider, providerTeamId) should be satisfied automatically
        await tx.team.create({
          data: {
            id: newTeamId,
            leagueId: newLeagueId,
            provider: sourceTeam.provider,
            providerTeamId: sourceTeam.providerTeamId,
            name: sourceTeam.name,
            managerName: sourceTeam.managerName,
            meta: sourceTeam.meta,
            demoSnapshotId: args.snapshotId,
          },
        });
      }
      console.log(`✓ Created ${sourceLeague.teams.length} demo teams`);
      console.log('');
      
      // 5. Create mapping of old player IDs to new player IDs
      console.log('Step 5: Duplicating players...');
      const playerIdMap = new Map<string, string>();
      
      for (const sourcePlayer of sourceLeague.players) {
        const newPlayerId = randomUUID();
        playerIdMap.set(sourcePlayer.id, newPlayerId);
        
        // Modify providerPlayerId to avoid unique constraint violation
        const demoProviderPlayerId = `${sourcePlayer.providerPlayerId}_${args.snapshotId}`;
        
        await tx.player.create({
          data: {
            id: newPlayerId,
            provider: sourcePlayer.provider,
            providerPlayerId: demoProviderPlayerId,
            fullName: sourcePlayer.fullName,
            firstName: sourcePlayer.firstName,
            lastName: sourcePlayer.lastName,
            nbaTeamAbbr: sourcePlayer.nbaTeamAbbr,
            positions: sourcePlayer.positions,
            isActive: sourcePlayer.isActive,
            meta: sourcePlayer.meta,
            demoSnapshotId: args.snapshotId,
            leagues: {
              connect: { id: newLeagueId },
            },
          },
        });
      }
      console.log(`✓ Created ${sourceLeague.players.length} demo players`);
      console.log('');
      
      // 6. Duplicate roster slots
      console.log('Step 6: Duplicating roster slots...');
      for (const sourceSlot of sourceLeague.rosterSlots) {
        const newTeamId = teamIdMap.get(sourceSlot.teamId);
        const newPlayerId = playerIdMap.get(sourceSlot.playerId);
        
        if (!newTeamId || !newPlayerId) {
          console.warn(`Warning: Could not map team or player for roster slot ${sourceSlot.id}`);
          continue;
        }
        
        await tx.rosterSlot.create({
          data: {
            id: randomUUID(),
            leagueId: newLeagueId,
            teamId: newTeamId,
            playerId: newPlayerId,
            providerRosterSlotId: sourceSlot.providerRosterSlotId,
            startAt: sourceSlot.startAt,
            endAt: sourceSlot.endAt,
            slotLabel: sourceSlot.slotLabel,
            meta: sourceSlot.meta,
            demoSnapshotId: args.snapshotId,
          },
        });
      }
      console.log(`✓ Created ${sourceLeague.rosterSlots.length} demo roster slots`);
      console.log('');
      
      return {
        snapshotId: snapshot.id,
        demoLeagueId: demoLeague.id,
        stats: {
          teams: sourceLeague.teams.length,
          players: sourceLeague.players.length,
          rosterSlots: sourceLeague.rosterSlots.length,
        },
      };
    });
    
    console.log('='.repeat(60));
    console.log('✅ Demo snapshot created successfully!');
    console.log('='.repeat(60));
    console.log(`Snapshot ID: ${result.snapshotId}`);
    console.log(`Demo League ID: ${result.demoLeagueId}`);
    console.log('');
    console.log('Statistics:');
    console.log(`  - Teams duplicated: ${result.stats.teams}`);
    console.log(`  - Players duplicated: ${result.stats.players}`);
    console.log(`  - Roster slots duplicated: ${result.stats.rosterSlots}`);
    console.log('');
    console.log(`Use this demo league ID in your sessions: ${result.demoLeagueId}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('Error creating demo snapshot:');
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createDemoSnapshot();

