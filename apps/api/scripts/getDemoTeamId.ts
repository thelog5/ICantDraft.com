import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function getDemoTeamId() {
  const demoLeagueId = '2b36f955-5d47-44ca-89df-4875d8e7f7ab';
  
  const league = await prisma.league.findUnique({
    where: { id: demoLeagueId },
    include: {
      teams: {
        orderBy: { providerTeamId: 'asc' }
      }
    }
  });

  if (!league) {
    console.error('Demo league not found');
    process.exit(1);
  }

  console.log('Demo League ID:', league.id);
  console.log('Demo League Name:', league.name);
  console.log('');

  // Find "bron and em" team
  const bronTeam = league.teams.find(t => 
    t.name.toLowerCase().includes('bron') && t.name.toLowerCase().includes('em')
  );

  if (bronTeam) {
    console.log('✅ Found "Bron and Em" team:');
    console.log('   Team ID:', bronTeam.id);
    console.log('   Team Name:', bronTeam.name);
  } else {
    console.log('❌ "Bron and Em" team not found. All teams:');
    console.log('');
    league.teams.forEach((t, i) => {
      console.log(`${i + 1}. ${t.name}`);
      console.log(`   ID: ${t.id}`);
      console.log('');
    });
  }

  await prisma.$disconnect();
}

getDemoTeamId();

