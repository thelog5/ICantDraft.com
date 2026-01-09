import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt, encodeCredentials, decodeCredentials } from './encryption.js';

const prisma = new PrismaClient();

export interface SessionData {
  id: string;
  mode: 'espn' | 'demo';
  leagueId: string | null;
  seasonId: number | null;
  teamId: string | null;
  providerTeamId: string | null;
}

export interface SessionWithCredentials extends SessionData {
  espn_s2?: string;
  swid?: string;
}

/**
 * Create a new session
 */
export async function createSession(
  mode: 'espn' | 'demo',
  options: {
    leagueId?: string;
    seasonId?: number;
    teamId?: string;
    providerTeamId?: string;
    espn_s2?: string;
    swid?: string;
  }
): Promise<string> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  let encryptedCredentials: string | null = null;
  if (mode === 'espn' && options.espn_s2 && options.swid) {
    const credentials = encodeCredentials(options.espn_s2, options.swid);
    encryptedCredentials = encrypt(credentials);
  }

  const session = await prisma.session.create({
    data: {
      mode,
      leagueId: options.leagueId || null,
      seasonId: options.seasonId || null,
      teamId: options.teamId || null,
      providerTeamId: options.providerTeamId || null,
      encryptedCredentials,
      expiresAt,
    },
  });

  return session.id;
}

/**
 * Get session by ID
 */
export async function getSession(sessionId: string): Promise<SessionData | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    return null;
  }

  // Check if expired
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: sessionId } });
    return null;
  }

  return {
    id: session.id,
    mode: session.mode as 'espn' | 'demo',
    leagueId: session.leagueId,
    seasonId: session.seasonId,
    teamId: session.teamId,
    providerTeamId: session.providerTeamId,
  };
}

/**
 * Get session with decrypted credentials (server-side only)
 */
export async function getSessionWithCredentials(sessionId: string): Promise<SessionWithCredentials | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    return null;
  }

  // Check if expired
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: sessionId } });
    return null;
  }

  const sessionData: SessionWithCredentials = {
    id: session.id,
    mode: session.mode as 'espn' | 'demo',
    leagueId: session.leagueId,
    seasonId: session.seasonId,
    teamId: session.teamId,
    providerTeamId: session.providerTeamId,
  };

  // Decrypt credentials if available
  if (session.mode === 'espn' && session.encryptedCredentials) {
    try {
      const decrypted = decrypt(session.encryptedCredentials);
      const { espn_s2, swid } = decodeCredentials(decrypted);
      sessionData.espn_s2 = espn_s2;
      sessionData.swid = swid;
    } catch (error) {
      console.error('[SessionManager] Failed to decrypt credentials:', error);
      // Continue without credentials
    }
  }

  return sessionData;
}

/**
 * Update session (e.g., set team after selection)
 */
export async function updateSession(
  sessionId: string,
  updates: {
    teamId?: string;
    providerTeamId?: string;
    leagueId?: string;
    seasonId?: number;
  }
): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: updates,
  });
}

/**
 * Delete session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {
    // Ignore if session doesn't exist
  });
}

/**
 * Clean up expired sessions (should be called periodically)
 */
export async function cleanupExpiredSessions(): Promise<void> {
  await prisma.session.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  });
}

