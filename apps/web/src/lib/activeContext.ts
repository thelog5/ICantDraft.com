export type ActiveContext = {
  leagueKeyInput: string;
  teamKeyInput: string;
  leagueId: string;
  teamId: string;
  leagueName?: string;
  teamName?: string;
};

const STORAGE_KEY = "icantdraft_active_context";

/**
 * Migrates old settings format to new activeContext format (one-time migration)
 */
function migrateOldSettings(): ActiveContext | null {
  const LEAGUE_KEY = "icantdraft_league_key";
  const MY_TEAM_KEY = "icantdraft_my_team_key";
  const RESOLVED_LEAGUE_ID = "icantdraft_resolved_league_id";
  const RESOLVED_TEAM_ID = "icantdraft_resolved_team_id";
  const RESOLVED_LEAGUE_NAME = "icantdraft_resolved_league_name";
  const RESOLVED_TEAM_NAME = "icantdraft_resolved_team_name";

  const leagueKeyInput = localStorage.getItem(LEAGUE_KEY);
  const teamKeyInput = localStorage.getItem(MY_TEAM_KEY);
  const leagueId = localStorage.getItem(RESOLVED_LEAGUE_ID);
  const teamId = localStorage.getItem(RESOLVED_TEAM_ID);
  const leagueName = localStorage.getItem(RESOLVED_LEAGUE_NAME);
  const teamName = localStorage.getItem(RESOLVED_TEAM_NAME);

  if (leagueKeyInput && teamKeyInput && leagueId && teamId) {
    const ctx: ActiveContext = {
      leagueKeyInput,
      teamKeyInput,
      leagueId,
      teamId,
      leagueName: leagueName || undefined,
      teamName: teamName || undefined,
    };
    
    // Save migrated context
    setActiveContext(ctx);
    
    // Clear old keys (optional - can keep for backward compat if needed)
    // localStorage.removeItem(LEAGUE_KEY);
    // localStorage.removeItem(MY_TEAM_KEY);
    // localStorage.removeItem(RESOLVED_LEAGUE_ID);
    // localStorage.removeItem(RESOLVED_TEAM_ID);
    // localStorage.removeItem(RESOLVED_LEAGUE_NAME);
    // localStorage.removeItem(RESOLVED_TEAM_NAME);
    
    return ctx;
  }

  return null;
}

/**
 * Gets the active context from localStorage, with backward compatibility migration
 */
export function getActiveContext(): ActiveContext | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as ActiveContext;
      // Validate required fields
      if (parsed.leagueKeyInput && parsed.teamKeyInput && parsed.leagueId && parsed.teamId) {
        return parsed;
      }
    }

    // Try to migrate from old format
    return migrateOldSettings();
  } catch {
    return null;
  }
}

/**
 * Sets the active context in localStorage
 */
export function setActiveContext(ctx: ActiveContext): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch (err) {
    console.error("Failed to save active context:", err);
  }
}

/**
 * Clears the active context from localStorage
 */
export function clearActiveContext(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Checks if active context exists and is valid
 */
export function hasActiveContext(): boolean {
  const ctx = getActiveContext();
  return !!(
    ctx &&
    ctx.leagueKeyInput &&
    ctx.teamKeyInput &&
    ctx.leagueId &&
    ctx.teamId
  );
}

