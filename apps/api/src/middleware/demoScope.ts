import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

// Use singleton pattern - import from main app or create once
let prismaInstance: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient();
  }
  return prismaInstance;
}

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
  const where: any = { id: leagueId };
  
  // If in demo mode, restrict to demo snapshot
  if (demoSnapshotId) {
    where.demoSnapshotId = demoSnapshotId;
  } else {
    // In live mode, only allow non-demo leagues
    where.demoSnapshotId = null;
  }
  
  return getPrisma().league.findUnique({
    where,
    include: {
      teams: true,
      players: true,
    },
  });
}

/**
 * Helper to get team with demo scope validation
 */
export async function getTeamScoped(
  teamId: string,
  demoSnapshotId: string | null
): Promise<any | null> {
  const where: any = { id: teamId };
  
  // If in demo mode, restrict to demo snapshot
  if (demoSnapshotId) {
    where.demoSnapshotId = demoSnapshotId;
  } else {
    // In live mode, only allow non-demo teams
    where.demoSnapshotId = null;
  }
  
  return getPrisma().team.findUnique({
    where,
    include: {
      league: true,
    },
  });
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
  
  return getPrisma().player.findMany({
    where,
  });
}

/**
 * Helper to get roster slots with demo scope validation
 */
export async function getRosterSlotsScoped(
  leagueId: string,
  teamId: string | null,
  demoSnapshotId: string | null
): Promise<any[]> {
  const where: any = {
    leagueId,
  };
  
  if (teamId) {
    where.teamId = teamId;
  }
  
  // If in demo mode, restrict to demo snapshot
  if (demoSnapshotId) {
    where.demoSnapshotId = demoSnapshotId;
  } else {
    // In live mode, only allow non-demo roster slots
    where.demoSnapshotId = null;
  }
  
  return getPrisma().rosterSlot.findMany({
    where,
    include: {
      player: true,
      team: true,
    },
    orderBy: {
      startAt: 'desc',
    },
  });
}

/**
 * Helper to get teams with demo scope validation
 */
export async function getTeamsScoped(
  leagueId: string,
  demoSnapshotId: string | null
): Promise<any[]> {
  const where: any = {
    leagueId,
  };
  
  // If in demo mode, restrict to demo snapshot
  if (demoSnapshotId) {
    where.demoSnapshotId = demoSnapshotId;
  } else {
    // In live mode, only allow non-demo teams
    where.demoSnapshotId = null;
  }
  
  return getPrisma().team.findMany({
    where,
    orderBy: {
      name: 'asc',
    },
  });
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

