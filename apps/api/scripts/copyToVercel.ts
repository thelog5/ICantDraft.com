import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

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

    // Get all leagues from local (without includes to avoid loading all data)
    console.log('📋 Fetching leagues from local database...');
    const localLeagues = await localPrisma.league.findMany();

    if (localLeagues.length === 0) {
      console.error('❌ No leagues found in local database');
      console.error('   Make sure you have data in your local database first');
      process.exit(1);
    }

    console.log(`   Found ${localLeagues.length} league(s)\n`);

    // Copy each league separately to avoid transaction timeouts
    for (const league of localLeagues) {
      console.log(`📤 Copying league: ${league.name} (${league.id})...`);

      // Ensure provider is set (default to ESPN if missing)
      const provider = league.provider || 'ESPN';

      // Copy league first
      await vercelPrisma.league.upsert({
        where: { id: league.id },
        update: {},
        create: {
          id: league.id,
          provider: provider as any,
          sport: league.sport || 'NBA',
          providerLeagueId: league.providerLeagueId,
          name: league.name,
          seasonYear: league.seasonYear,
          settings: league.settings,
          commissionerUserId: league.commissionerUserId,
          demoSnapshotId: league.demoSnapshotId,
          createdAt: league.createdAt,
          updatedAt: league.updatedAt,
        },
      });

      // Copy teams in batches
      const teams = await localPrisma.team.findMany({ where: { leagueId: league.id } });
      console.log(`   Copying ${teams.length} teams...`);
      for (const team of teams) {
        await vercelPrisma.team.upsert({
          where: { id: team.id },
          update: {},
          create: {
            id: team.id,
            leagueId: team.leagueId,
            provider: (team.provider || provider) as any,
            providerTeamId: team.providerTeamId,
            name: team.name,
            managerName: team.managerName,
            avatarUrl: team.avatarUrl,
            settings: team.settings,
            meta: team.meta,
            demoSnapshotId: team.demoSnapshotId,
            createdAt: team.createdAt,
            updatedAt: team.updatedAt,
          },
        });
      }

      // Copy players in batches (only players for this league)
      const players = await localPrisma.player.findMany({
        where: {
          leagues: {
            some: { id: league.id }
          }
        }
      });
      console.log(`   Copying ${players.length} players...`);
      for (const player of players) {
        await vercelPrisma.player.upsert({
          where: { id: player.id },
          update: {},
          create: {
            id: player.id,
            provider: (player.provider || provider) as any,
            providerPlayerId: player.providerPlayerId,
            fullName: player.fullName || 'Unknown Player',
            firstName: player.firstName,
            lastName: player.lastName,
            nbaTeamAbbr: player.nbaTeamAbbr,
            positions: player.positions || [],
            isActive: player.isActive !== undefined ? player.isActive : true,
            meta: player.meta,
            demoSnapshotId: player.demoSnapshotId,
            createdAt: player.createdAt,
            updatedAt: player.updatedAt,
          },
        });
      }

      // Link players to league
      for (const player of players) {
        await vercelPrisma.league.update({
          where: { id: league.id },
          data: {
            players: {
              connect: { id: player.id }
            }
          }
        });
      }

      // Copy roster slots
      const rosterSlots = await localPrisma.rosterSlot.findMany({
        where: { leagueId: league.id },
      });

      if (rosterSlots.length > 0) {
        console.log(`   Copying ${rosterSlots.length} roster slots...`);
        for (const slot of rosterSlots) {
          await vercelPrisma.rosterSlot.upsert({
            where: { id: slot.id },
            update: {},
            create: {
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
    }

    console.log('✅ All data copied successfully!\n');
    console.log('📝 Next steps:');
    console.log('   1. Run the demo snapshot script:');
    console.log(`      $env:DATABASE_URL="your-vercel-postgres-url"`);
    console.log(`      pnpm --filter api demo:snapshot --leagueId ${localLeagues[0].id} --label "Vercel Demo"`);

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
