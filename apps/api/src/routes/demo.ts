import express, { Request, Response } from 'express';
// @ts-ignore - PrismaClient is generated at build time
import { PrismaClient } from '@prisma/client';

const router = express.Router();

// Use singleton pattern
let prismaInstance: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient();
  }
  return prismaInstance;
}

/**
 * GET /demo/snapshots
 * List all available demo snapshots
 */
router.get('/snapshots', async (req: express.Request, res: express.Response) => {
  try {
    const snapshots = await getPrisma().demoSnapshot.findMany({
      select: {
        id: true,
        label: true,
        createdAt: true,
        sourceLeagueId: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json({ ok: true, snapshots });
  } catch (error) {
    console.error('[DemoSnapshots] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to fetch demo snapshots' 
    });
  }
});

/**
 * POST /demo/start
 * Start a demo session with a specific snapshot
 * Body: { snapshotId: string }
 * Query: ?snapshotId=string
 */
router.post('/start', async (req: express.Request, res: express.Response) => {
  try {
    // Accept snapshotId from either body or query
    const snapshotId = (req as any).body?.snapshotId || (req as any).query?.snapshotId;

    if (!snapshotId || typeof snapshotId !== 'string') {
      return (res as any).status(400).json({
        ok: false,
        error: 'Missing or invalid snapshotId parameter',
      });
    }

    // Verify the snapshot exists
    const snapshot = await getPrisma().demoSnapshot.findUnique({
      where: { id: snapshotId },
    });

    if (!snapshot) {
      return (res as any).status(404).json({
        ok: false,
        error: `Demo snapshot '${snapshotId}' not found`,
      });
    }

    // Find the demo league for this snapshot
    const demoLeague = await getPrisma().league.findFirst({
      where: {
        demoSnapshotId: snapshotId,
      },
      include: {
        teams: {
          orderBy: {
            providerTeamId: 'asc',  // Keep original ESPN team order
          },
        },
      },
    });

    if (!demoLeague) {
      return (res as any).status(404).json({
        ok: false,
        error: `No league found for demo snapshot '${snapshotId}'`,
      });
    }

    // Find team "bron and em" by name (case insensitive), fallback to team 8 or first team
    let defaultTeam = demoLeague.teams.find(team => 
      team.name.toLowerCase().includes('bron') && team.name.toLowerCase().includes('em')
    );
    
    // Fallback to team 8 (index 7) if not found
    if (!defaultTeam) {
      defaultTeam = demoLeague.teams[7] || demoLeague.teams[0];
    }

    if (!defaultTeam) {
      return (res as any).status(500).json({
        ok: false,
        error: 'Demo league has no teams',
      });
    }

    // Set the demo_snapshot cookie
    // HttpOnly: prevents JavaScript access
    // Secure: only send over HTTPS (should be true in production)
    // SameSite: Lax for reasonable CSRF protection
    const isProduction = process.env.NODE_ENV === 'production';
    
    (res as any).cookie('demo_snapshot', snapshotId, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    // Return the demo session info
    res.json({
      ok: true,
      demoSnapshotId: snapshotId,
      leagueId: demoLeague.id,
      teamId: defaultTeam.id,
      snapshotLabel: snapshot.label,
      league: {
        id: demoLeague.id,
        name: demoLeague.name,
        seasonYear: demoLeague.seasonYear,
        teamCount: demoLeague.teams.length,
      },
      team: {
        id: defaultTeam.id,
        name: defaultTeam.name,
        managerName: defaultTeam.managerName,
      },
    });
  } catch (error) {
    console.error('[DemoStart] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to start demo session',
    });
  }
});

/**
 * POST /demo/end
 * End the current demo session by clearing the cookie
 */
router.post('/end', (req: express.Request, res: express.Response) => {
  res.clearCookie('demo_snapshot', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });

  res.json({
    ok: true,
    message: 'Demo session ended',
  });
});

/**
 * GET /demo/status
 * Check current demo session status
 */
router.get('/status', async (req: express.Request, res: express.Response) => {
  try {
    const demoSnapshotId = req.cookies.demo_snapshot;

    if (!demoSnapshotId) {
      return res.json({
        ok: true,
        isDemo: false,
        demoSnapshotId: null,
      });
    }

    // Verify the snapshot still exists
    const snapshot = await getPrisma().demoSnapshot.findUnique({
      where: { id: demoSnapshotId },
    });

    if (!snapshot) {
      // Clear invalid cookie
      (res as any).clearCookie('demo_snapshot', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });

      return res.json({
        ok: true,
        isDemo: false,
        demoSnapshotId: null,
        message: 'Demo snapshot no longer exists',
      });
    }

    // Find the demo league
    const demoLeague = await getPrisma().league.findFirst({
      where: {
        demoSnapshotId,
      },
      select: {
        id: true,
        name: true,
        seasonYear: true,
      },
    });

    res.json({
      ok: true,
      isDemo: true,
      demoSnapshotId,
      snapshotLabel: snapshot.label,
      league: demoLeague || null,
    });
  } catch (error) {
    console.error('[DemoStatus] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to check demo status',
    });
  }
});

export default router;

