import express from 'express';
// Use shared PrismaClient instance
import prisma from '../lib/prisma.js';
import {
  createSession,
  getSession,
  deleteSession,
  updateSession,
} from '../lib/sessionManager.js';
const router = express.Router();

// Rate limiting map (simple in-memory, resets on restart)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 10; // max 10 attempts per window

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || record.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

/**
 * POST /auth/espn/connect
 * Validate ESPN credentials and return league info (validation only, no session)
 */
router.post('/espn/connect', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      message: 'Too many attempts. Please try again later.',
    });
  }

  const { leagueId, seasonId, espn_s2, swid } = req.body;

  // Validate inputs
  if (!leagueId || !seasonId || !espn_s2 || !swid) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields: leagueId, seasonId, espn_s2, swid',
    });
  }

  if (typeof seasonId !== 'number' || seasonId < 2020 || seasonId > 2030) {
    return res.status(400).json({
      success: false,
      message: 'Invalid seasonId. Must be a number between 2020 and 2030.',
    });
  }

  // Normalize SWID (add braces if missing)
  let normalizedSwid = swid.trim();
  if (!normalizedSwid.startsWith('{')) {
    normalizedSwid = `{${normalizedSwid}}`;
  }

  try {
    // Verify credentials by calling ESPN API
    const baseUrl = process.env.ESPN_BASE_URL || 'https://lm-api-reads.fantasy.espn.com';
    const platformVersion = process.env.ESPN_PLATFORM_VERSION || '3';
    
    const url = `${baseUrl}/apis/${platformVersion}/games/fba/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=mTeam&view=mRoster`;
    
    const response = await fetch(url, {
      headers: {
        Cookie: `espn_s2=${espn_s2}; SWID=${normalizedSwid}`,
      },
    });

    if (!(response as any).ok) {
      console.log(`[Auth] ESPN API returned ${(response as any).status} for league ${leagueId}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid ESPN credentials or league not found.',
      });
    }

    const data = await (response as any).json() as any;
    
    const leagueName = data.settings?.name || 'Unknown League';
    const teams = (data.teams || []).map((t: any) => ({
      teamId: t.id,
      teamName: t.name || t.location || 'Unknown Team',
      managerName: t.primaryOwner || null,
    }));

    if (teams.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No teams found in this league.',
      });
    }

    // Just return the data, no session needed (frontend handles activeContext)
    return res.json({
      success: true,
      leagueName,
      teams,
    });
  } catch (error: any) {
    console.error('[Auth] Error connecting to ESPN:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to connect to ESPN. Please try again.',
    });
  }
});

/**
 * POST /auth/espn/select-team
 * Bind team to session
 */
router.post('/espn/select-team', async (req, res) => {
  const sessionId = req.cookies?.sid;
  
  if (!sessionId) {
    return res.status(401).json({
      success: false,
      message: 'No active session. Please connect first.',
    });
  }

  const { teamId } = req.body;
  
  if (!teamId) {
    return res.status(400).json({
      success: false,
      message: 'teamId is required',
    });
  }

  const session = await getSession(sessionId);
  
  if (!session || session.mode !== 'espn') {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired session',
    });
  }

  // Find internal team ID in our database
  const team = await prisma.team.findFirst({
    where: {
      league: {
        providerLeagueId: session.leagueId!,
        seasonYear: session.seasonId!,
      },
      providerTeamId: String(teamId),
    },
  });

  // Update session with team
  await updateSession(sessionId, {
    providerTeamId: String(teamId),
    teamId: team?.id,
  });

  return res.json({
    success: true,
    message: 'Team selected successfully',
  });
});

/**
 * GET /auth/demo/info
 * Get demo league/team info (uses demo snapshot system)
 */
router.get('/demo/info', async (req, res) => {
  try {
    // Find the first available demo snapshot
    const snapshot = await prisma.demoSnapshot.findFirst({
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!snapshot) {
      return res.status(500).json({
        success: false,
        message: 'Demo mode not configured. No demo snapshots available.',
      });
    }

    // Find the demo league for this snapshot
    const league = await prisma.league.findFirst({
      where: {
        demoSnapshotId: snapshot.id,
      },
      include: {
        teams: {
          orderBy: {
            providerTeamId: 'asc',
          },
        },
      },
    });

    if (!league || league.teams.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Demo league not found. Please create a demo snapshot.',
      });
    }

    // Find team "bron and em" by name (case insensitive), fallback to team 8 or first team
    let demoTeam = league.teams.find(team => 
      team.name.toLowerCase().includes('bron') && team.name.toLowerCase().includes('em')
    );
    
    // Fallback to team 8 (index 7) if not found
    if (!demoTeam) {
      demoTeam = league.teams[7] || league.teams[0];
    }

    // Set the demo_snapshot cookie so subsequent requests are scoped correctly
    const isProduction = process.env.NODE_ENV === 'production';
    (res as any).cookie('demo_snapshot', snapshot.id, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    return (res as any).json({
      success: true,
      leagueId: league.id,
      leagueProviderLeagueId: league.providerLeagueId,
      leagueName: league.name,
      teamId: demoTeam.id,
      teamProviderTeamId: demoTeam.providerTeamId,
      teamName: demoTeam.name,
    });
  } catch (error: any) {
    console.error('[Auth] Error getting demo info:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to get demo info.',
    });
  }
});

/**
 * GET /auth/me
 * Get current session info
 */
router.get('/me', async (req, res) => {
  const sessionId = req.cookies?.sid;
  
  if (!sessionId) {
    return res.json({
      authenticated: false,
      mode: null,
    });
  }

  const session = await getSession(sessionId);
  
  if (!session) {
    // Clear invalid cookie
    res.clearCookie('sid');
    return res.json({
      authenticated: false,
      mode: null,
    });
  }

  // Get league and team info
  let leagueName = null;
  let teamName = null;

  if (session.leagueId) {
    const league = await prisma.league.findFirst({
      where: {
        providerLeagueId: session.leagueId,
        seasonYear: session.seasonId!,
      },
    });
    leagueName = league?.name || null;
  }

  if (session.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: session.teamId },
    });
    teamName = team?.name || null;
  }

  return res.json({
    authenticated: true,
    mode: session.mode,
    leagueId: session.leagueId,
    seasonId: session.seasonId,
    teamId: session.teamId,
    providerTeamId: session.providerTeamId,
    leagueName,
    teamName,
  });
});

/**
 * POST /auth/logout
 * Clear session
 */
router.post('/logout', async (req, res) => {
  const sessionId = req.cookies?.sid;
  
  if (sessionId) {
    await deleteSession(sessionId);
  }

  res.clearCookie('sid');
  
  return res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

export default router;

