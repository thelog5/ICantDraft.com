import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';

// Load environment variables
dotenv.config();

/**
 * Copy data from local database to Vercel Postgres
 * 
 * Usage:
 * 1. Set LOCAL_DATABASE_URL in .env (your local database)
 * 2. Set VERCEL_DATABASE_URL in .env (from Vercel dashboard)
 * 3. Run: pnpm --filter api tsx scripts/copyToVercel.ts
 */

async function copyToVercel() {
  const localUrl = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
  const vercelUrl = process.env.VERCEL_DATABASE_URL;

  if (!localUrl) {
    console.error('❌ Error: LOCAL_DATABASE_URL or DATABASE_URL not set');
    console.error('   Set it in your .env file: LOCAL_DATABASE_URL="postgresql://..."');
    process.exit(1);
  }

  if (!vercelUrl) {
    console.error('❌ Error: VERCEL_DATABASE_URL not set');
    console.error('   Get it from Vercel Dashboard → Your Project → Storage → Postgres → .env.local');
    console.error('   Then set it in your .env file: VERCEL_DATABASE_URL="postgresql://..."');
    process.exit(1);
  }

  console.log('📦 Copying data from local database to Vercel Postgres...\n');

  const localPrisma = new PrismaClient({ datasources: { db: { url: localUrl } } });
  const vercelPrisma = new PrismaClient({ datasources: { db: { url: vercelUrl } } });

  try {
    // Test connections
    console.log('🔌 Testing database connections...');
    await localPrisma.$connect();
    console.log('   ✓ Local database connected');
    
    await vercelPrisma.$connect();
    console.log('   ✓ Vercel database connected\n');

    // Get all leagues from local
    console.log('📋 Fetching leagues from local database...');
    const localLeagues = await localPrisma.league.findMany({
      include: {
        teams: true,
        players: true,
      },
    });

    if (localLeagues.length === 0) {
      console.error('❌ No leagues found in local database');
      console.error('   Make sure you have data in your local database first');
      process.exit(1);
    }

    console.log(`   Found ${localLeagues.length} league(s)\n`);

    // Copy each league
    for (const league of localLeagues) {
      console.log(`📤 Copying league: ${league.name} (${league.id})...`);

      await vercelPrisma.$transaction(async (tx) => {
        // Copy league
        const newLeague = await tx.league.create({
          data: {
            id: league.id,
            provider: league.provider,
            sport: league.sport,
            providerLeagueId: league.providerLeagueId,
            name: league.name,
            seasonYear: league.seasonYear,
            settings: league.settings,
            createdAt: league.createdAt,
            updatedAt: league.updatedAt,
          },
        });

        // Copy teams
        console.log(`   Copying ${league.teams.length} teams...`);
        for (const team of league.teams) {
          await tx.team.create({
            data: {
              id: team.id,
              leagueId: team.leagueId,
              providerTeamId: team.providerTeamId,
              name: team.name,
              managerName: team.managerName,
              avatarUrl: team.avatarUrl,
              settings: team.settings,
              meta: team.meta,
              createdAt: team.createdAt,
              updatedAt: team.updatedAt,
            },
          });
        }

        // Copy players
        console.log(`   Copying ${league.players.length} players...`);
        for (const player of league.players) {
          await tx.player.create({
            data: {
              id: player.id,
              providerPlayerId: player.providerPlayerId,
              name: player.name,
              teamAbbr: player.teamAbbr,
              positions: player.positions,
              headshotUrl: player.headshotUrl,
              stats: player.stats,
              meta: player.meta,
              createdAt: player.createdAt,
              updatedAt: player.updatedAt,
            },
          });
        }

        // Copy roster slots
        const rosterSlots = await localPrisma.rosterSlot.findMany({
          where: { leagueId: league.id },
        });

        if (rosterSlots.length > 0) {
          console.log(`   Copying ${rosterSlots.length} roster slots...`);
          for (const slot of rosterSlots) {
            await tx.rosterSlot.create({
              data: {
                id: slot.id,
                leagueId: slot.leagueId,
                teamId: slot.teamId,
                playerId: slot.playerId,
                position: slot.position,
                createdAt: slot.createdAt,
                updatedAt: slot.updatedAt,
              },
            });
          }
        }

        console.log(`   ✓ League "${league.name}" copied successfully\n`);
      });
    }

    console.log('✅ All data copied successfully!\n');
    console.log('📝 Next steps:');
    console.log('   1. Run the demo snapshot script:');
    console.log(`      pnpm --filter api demo:snapshot --leagueId ${localLeagues[0].id} --label "Vercel Demo"`);
    console.log('   2. Make sure VERCEL_DATABASE_URL is set when running the snapshot script');

  } catch (error: any) {
    console.error('❌ Error copying data:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await localPrisma.$disconnect();
    await vercelPrisma.$disconnect();
  }
}

copyToVercel();

