const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export type League = {
  id: string;
  name: string;
  seasonYear: number;
  provider: string;
  providerLeagueId: string;
  createdAt: string;
};

export type PowerRanking = {
  teamId: string;
  teamName: string;
  score0to9: number;
  ranks: {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    threes: number;
    fgPct: number;
    ftPct: number;
    tov: number;
  };
};

export type PowerRankingsResponse = {
  league: {
    id: string;
    name: string;
  };
  powerRankings: PowerRanking[];
};

export type TeamProfile = {
  teamId: string;
  teamName: string;
  rawTotals: {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    threes: number;
    fgPct: number;
    ftPct: number;
    tov: number;
  };
  zScores: {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    threes: number;
    fgPct: number;
    ftPct: number;
    tov: number;
  };
  categoryRank: {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    threes: number;
    fgPct: number;
    ftPct: number;
    tov: number;
  };
  normalizedTeamScore0to9: number;
  meta: {
    leagueId: string;
    teamId: string;
    computedAt: string;
    stats_missing: boolean;
  };
};

export type TeamProfileResponse = {
  profile: TeamProfile;
  leagueAverage: {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    threes: number;
    fgPct: number;
    ftPct: number;
    tov: number;
  };
  leagueRanksSummary: Array<{
    teamId: string;
    teamName: string;
    ranks: TeamProfile["categoryRank"];
    teamScore: number;
  }>;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export const api = {
  async getLeagues(): Promise<{ leagues: League[] }> {
    return fetchJson(`${API_BASE_URL}/leagues`);
  },

  async getPowerRankings(leagueId: string): Promise<PowerRankingsResponse> {
    return fetchJson(`${API_BASE_URL}/leagues/${leagueId}/power-rankings`);
  },

  async getTeamProfile(
    leagueId: string,
    teamId: string
  ): Promise<TeamProfileResponse> {
    return fetchJson(`${API_BASE_URL}/leagues/${leagueId}/teams/${teamId}/profile`);
  },
};

