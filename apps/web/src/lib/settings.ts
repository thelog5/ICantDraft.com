const LEAGUE_KEY = "icantdraft_league_key";
const MY_TEAM_KEY = "icantdraft_my_team_key";
const RESOLVED_LEAGUE_ID = "icantdraft_resolved_league_id";
const RESOLVED_TEAM_ID = "icantdraft_resolved_team_id";
const RESOLVED_LEAGUE_NAME = "icantdraft_resolved_league_name";
const RESOLVED_TEAM_NAME = "icantdraft_resolved_team_name";

export function getLeagueKey(): string | null {
  return localStorage.getItem(LEAGUE_KEY);
}

export function getMyTeamKey(): string | null {
  return localStorage.getItem(MY_TEAM_KEY);
}

export function setLeagueKey(key: string): void {
  localStorage.setItem(LEAGUE_KEY, key);
}

export function setMyTeamKey(key: string): void {
  localStorage.setItem(MY_TEAM_KEY, key);
}

export function getResolvedLeagueId(): string | null {
  return localStorage.getItem(RESOLVED_LEAGUE_ID);
}

export function getResolvedTeamId(): string | null {
  return localStorage.getItem(RESOLVED_TEAM_ID);
}

export function getResolvedLeagueName(): string | null {
  return localStorage.getItem(RESOLVED_LEAGUE_NAME);
}

export function getResolvedTeamName(): string | null {
  return localStorage.getItem(RESOLVED_TEAM_NAME);
}

export function setResolvedLeague(leagueId: string, leagueName: string): void {
  localStorage.setItem(RESOLVED_LEAGUE_ID, leagueId);
  localStorage.setItem(RESOLVED_LEAGUE_NAME, leagueName);
}

export function setResolvedTeam(teamId: string, teamName: string): void {
  localStorage.setItem(RESOLVED_TEAM_ID, teamId);
  localStorage.setItem(RESOLVED_TEAM_NAME, teamName);
}

export function clearAllSettings(): void {
  localStorage.removeItem(LEAGUE_KEY);
  localStorage.removeItem(MY_TEAM_KEY);
  localStorage.removeItem(RESOLVED_LEAGUE_ID);
  localStorage.removeItem(RESOLVED_TEAM_ID);
  localStorage.removeItem(RESOLVED_LEAGUE_NAME);
  localStorage.removeItem(RESOLVED_TEAM_NAME);
}

export function hasSettings(): boolean {
  return !!(getLeagueKey() && getMyTeamKey());
}

