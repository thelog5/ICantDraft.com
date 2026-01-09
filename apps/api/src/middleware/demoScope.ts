import express, { Request, Response, NextFunction } from 'express';
// Use shared PrismaClient instance
import prisma, { withRetry } from '../lib/prisma.js';

export interface DemoScopeContext {
  demoSnapshotId: string | null;
  isDemo: boolean;
}

declare global {
  namespace Express {
    interface Request {
      demoScope?: DemoScopeContext;
    }
  }
}

/**
 * Middleware that checks for demo_snapshot cookie and sets demo scope context
 */
export function demoScopeMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const demoSnapshotId = (req as any).cookies?.demo_snapshot;
  
  (req as any).demoScope = {
    demoSnapshotId: demoSnapshotId || null,
    isDemo: !!demoSnapshotId,
  };
  
  (next as any)();
}

/**
 * Helper to get league with demo scope validation
 */
export async function getLeagueScoped(
  leagueId: string,
  demoSnapshotId: string | null
): Promise<any | null> {
  // First try to find by ID only (works for both demo and non-demo)
  let league = await withRetry(() => prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      teams: true,
      players: true,
    },
  }));
  
  if (!league) {
    return null;
  }
  
  // If we have a demoSnapshotId, verify the league belongs to it
  if (demoSnapshotId && league.demoSnapshotId !== demoSnapshotId) {
    return null; // League doesn't belong to this demo snapshot
  }
  
  // If we don't have a demoSnapshotId but the league is a demo league, allow it
  // (This handles the case where cookie isn't set but user is accessing demo data)
  // OR if league is not a demo league and we're not in demo mode, allow it
  if (!demoSnapshotId && league.demoSnapshotId) {
    // Allow access to demo league even without cookie (for initial demo access)
    return league;
  }
  
  if (demoSnapshotId && !league.demoSnapshotId) {
    // In demo mode, don't allow non-demo leagues
    return null;
  }
  
  return league;
}

/**
 * Helper to get team with demo scope validation
 */
export async function getTeamScoped(
  teamId: string,
  demoSnapshotId: string | null
): Promise<any | null> {
  // First try to find by ID only (works for both demo and non-demo)
  let team = await withRetry(() => prisma.team.findUnique({
    where: { id: teamId },
    include: {
      league: true,
    },
  }));
  
  if (!team) {
    return null;
  }
  
  // If we have a demoSnapshotId, verify the team belongs to it
  if (demoSnapshotId && team.demoSnapshotId !== demoSnapshotId) {
    return null; // Team doesn't belong to this demo snapshot
  }
  
  // If we don't have a demoSnapshotId but the team is a demo team, allow it
  // (This handles the case where cookie isn't set but user is accessing demo data)
  if (!demoSnapshotId && team.demoSnapshotId) {
    // Allow access to demo team even without cookie (for initial demo access)
    return team;
  }
  
  if (demoSnapshotId && !team.demoSnapshotId) {
    // In demo mode, don't allow non-demo teams
    return null;
  }
  
  return team;
}

/**
 * Helper to get players with demo scope validation
 */
export async function getPlayersScoped(
  leagueId: string,
  demoSnapshotId: string | null
): Promise<any[]> {
  const where: any = {
    leagues: {
      some: {
        id: leagueId,
      },
    },
  };
  
  // If in demo mode, restrict to demo snapshot
  if (demoSnapshotId) {
    where.demoSnapshotId = demoSnapshotId;
  } else {
    // In live mode, only allow non-demo players
    where.demoSnapshotId = null;
  }
  
  return withRetry(() => prisma.player.findMany({
    where,
  }));
}

/**
 * Helper to get roster slots with demo scope validation
 */
export async function getRosterSlotsScoped(
  leagueId: string,
  teamId: string | null,
  demoSnapshotId: string | null
): Promise<any[]> {
  // First, check if the league is a demo league
  const league = await withRetry(() => prisma.league.findUnique({
    where: { id: leagueId },
    select: { demoSnapshotId: true },
  }));
  
  if (!league) {
    console.error(`[getRosterSlotsScoped] League not found: ${leagueId}`);
    return [];
  }
  
  const isDemoLeague = !!league?.demoSnapshotId;
  
  const where: any = {
    leagueId,
  };
  
  if (teamId) {
    where.teamId = teamId;
  }
  
  // If we have a demoSnapshotId, use it for filtering
  if (demoSnapshotId) {
    // In demo mode, restrict to demo snapshot
    where.demoSnapshotId = demoSnapshotId;
  } else if (isDemoLeague) {
    // League is a demo league but no cookie yet - allow demo roster slots
    where.demoSnapshotId = league.demoSnapshotId;
  } else {
    // In live mode, only allow non-demo roster slots
    where.demoSnapshotId = null;
  }
  
  const rosterSlots = await withRetry(() => prisma.rosterSlot.findMany({
    where,
    include: {
      player: true,
      team: true,
    },
    orderBy: {
      startAt: 'desc',
    },
  }));
  
  // Debug logging
  console.log(`[getRosterSlotsScoped] leagueId: ${leagueId}, teamId: ${teamId}, demoSnapshotId: ${demoSnapshotId}`);
  console.log(`[getRosterSlotsScoped] Found ${rosterSlots.length} roster slots`);
  if (rosterSlots.length > 0) {
    const withPlayers = rosterSlots.filter(rs => rs.player).length;
    const withPlayerMeta = rosterSlots.filter(rs => rs.player?.meta).length;
    console.log(`[getRosterSlotsScoped] Slots with players: ${withPlayers}, with player.meta: ${withPlayerMeta}`);
  }
  
  return rosterSlots;
}

/**
 * Helper to get teams with demo scope validation
 */
export async function getTeamsScoped(
  leagueId: string,
  demoSnapshotId: string | null
): Promise<any[]> {
  try {
    // First, check if the league is a demo league (similar to getRosterSlotsScoped)
    const league = await withRetry(() => prisma.league.findUnique({
      where: { id: leagueId },
      select: { demoSnapshotId: true },
    }));
    
    if (!league) {
      console.error(`[getTeamsScoped] League not found: ${leagueId}`);
      return [];
    }
    
    const isDemoLeague = !!league?.demoSnapshotId;
    
    const where: any = {
      leagueId,
    };
    
    // If we have a demoSnapshotId, use it for filtering
    if (demoSnapshotId) {
      // In demo mode, restrict to demo snapshot
      where.demoSnapshotId = demoSnapshotId;
    } else if (isDemoLeague) {
      // League is a demo league but no cookie yet - allow demo teams
      where.demoSnapshotId = league.demoSnapshotId;
    } else {
      // In live mode, only allow non-demo teams
      where.demoSnapshotId = null;
    }
    
    const teams = await withRetry(() => prisma.team.findMany({
      where,
      orderBy: {
        name: 'asc',
      },
    }));
    
    console.log(`[getTeamsScoped] leagueId: ${leagueId}, demoSnapshotId: ${demoSnapshotId}, isDemoLeague: ${isDemoLeague}, league.demoSnapshotId: ${league?.demoSnapshotId || 'null'}, where.demoSnapshotId: ${where.demoSnapshotId}, found ${teams.length} teams`);
    
    // If no teams found, try without demoSnapshotId filter to see if teams exist at all
    if (teams.length === 0) {
      const allTeamsInLeague = await withRetry(() => prisma.team.findMany({
        where: { leagueId },
        select: { id: true, name: true, demoSnapshotId: true },
      }));
      console.log(`[getTeamsScoped] DEBUG: Found ${allTeamsInLeague.length} total teams in league (ignoring demo filter)`);
      if (allTeamsInLeague.length > 0) {
        console.log(`[getTeamsScoped] DEBUG: Team demoSnapshotIds: ${allTeamsInLeague.map(t => `${t.name}:${t.demoSnapshotId || 'null'}`).join(', ')}`);
      }
    }
    
    return teams;
  } catch (error) {
    console.error(`[getTeamsScoped] Error fetching teams for league ${leagueId}:`, error);
    return [];
  }
}

/**
 * Validates that a league belongs to the current demo scope
 * Throws an error if validation fails
 */
export async function validateLeagueScope(
  leagueId: string,
  demoSnapshotId: string | null
): Promise<void> {
  const league = await getLeagueScoped(leagueId, demoSnapshotId);
  
  if (!league) {
    throw new Error('League not found or not accessible in current scope');
  }
}

/**
 * Validates that a team belongs to the current demo scope
 * Throws an error if validation fails
 */
export async function validateTeamScope(
  teamId: string,
  demoSnapshotId: string | null
): Promise<void> {
  const team = await getTeamScoped(teamId, demoSnapshotId);
  
  if (!team) {
    throw new Error('Team not found or not accessible in current scope');
  }
}

