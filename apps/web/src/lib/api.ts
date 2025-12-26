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

export type Team = {
  id: string;
  name: string;
  providerTeamId: string;
};

export type TeamsResponse = {
  league: {
    id: string;
    name: string;
  };
  teams: Team[];
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

// IMPORTANT: simple class export (no TS parameter properties weirdness)
export class ApiError extends Error {
  status?: number;
  response?: unknown;

  constructor(message: string, status?: number, response?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.response = response;
  }
}


async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let errorData: any = { error: text || `HTTP ${response.status}` };

      try {
        errorData = JSON.parse(text);
      } catch {
        // keep fallback
      }

      throw new ApiError(
        errorData.error || `HTTP error! status: ${response.status}`,
        response.status,
        { ...errorData, url }
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new ApiError(
        `Failed to connect to API at ${url}. Is the server running?`,
        0,
        { url }
      );
    }
    throw new ApiError(
      error instanceof Error ? error.message : "Unknown error",
      0,
      { url }
    );
  }
}

export const api = {
  async getLeagues(): Promise<{ leagues: League[] }> {
    return fetchJson(`${API_BASE_URL}/leagues`);
  },


  async getPowerRankings(leagueId: string): Promise<PowerRankingsResponse> {
    return fetchJson(`${API_BASE_URL}/leagues/${leagueId}/power-rankings`);
  },

  async getTeams(leagueId: string): Promise<TeamsResponse> {
    return fetchJson(`${API_BASE_URL}/leagues/${leagueId}/teams`);
  },

  async getTeamProfile(leagueId: string, teamId: string): Promise<TeamProfileResponse> {
    return fetchJson(`${API_BASE_URL}/leagues/${leagueId}/teams/${teamId}/profile`);
  },

  async refreshEspnData(): Promise<{ ok: boolean }> {
    return fetchJson(`${API_BASE_URL}/ingest/espn`, { method: "POST" });
  },

  async checkHealth(): Promise<{ ok: boolean }> {
    return fetchJson(`${API_BASE_URL}/health`);
  },

  async resolveLeague(leagueKey: string): Promise<{ leagueId: string; leagueName: string }> {
    return fetchJson(`${API_BASE_URL}/resolve/league/${encodeURIComponent(leagueKey)}`);
  },

  async resolveTeam(leagueId: string, teamKey: string): Promise<{
    teamId: string;
    teamName: string;
    providerTeamId: string | null;
  }> {
    return fetchJson(
      `${API_BASE_URL}/resolve/team/${encodeURIComponent(leagueId)}/${encodeURIComponent(teamKey)}`
    );
  },

  async getRoster(leagueId: string, teamId: string): Promise<{
    teamId: string;
    teamName: string;
    roster: Array<{
      id: string;
      fullName: string;
      providerPlayerId: string | null;
      positions: string[];
      headshotUrl: string | null;
    }>;
  }> {
    return fetchJson(`${API_BASE_URL}/leagues/${leagueId}/teams/${teamId}/roster`);
  },

  async getTeamHeader(leagueId: string, teamId: string): Promise<{
    league: {
      id: string;
      name: string;
    };
    team: {
      id: string;
      name: string;
      avatarUrl: string | null;
    };
    standings: {
      rank: number;
      wins: number;
      losses: number;
      ties: number;
    } | null;
    matchup: {
      opponentName: string | null;
      myCatsWon: number;
      myCatsLost: number;
      myCatsTied: number;
      oppCatsWon: number;
      oppCatsLost: number;
      oppCatsTied: number;
    } | null;
    updatedAt: string;
  }> {
    return fetchJson(`${API_BASE_URL}/leagues/${leagueId}/teams/${teamId}/header`);
  },

  async getStandings(leagueId: string): Promise<{
    league: {
      id: string;
      name: string;
    };
    standings: Array<{
      teamId: string;
      teamName: string;
      rank: number;
      wins: number;
      losses: number;
      ties: number;
    }>;
  }> {
    return fetchJson(`${API_BASE_URL}/leagues/${leagueId}/standings`);
  },

  async getCurrentMatchup(leagueId: string, teamId: string): Promise<{
    ok: boolean;
    reason?: string;
    league?: {
      id: string;
      name: string;
    };
    team?: {
      teamId: string;
      teamName: string;
      avatarUrl: string | null;
    };
    opponent?: {
      teamId: string;
      teamName: string;
      avatarUrl: string | null;
    };
    score?: {
      team: string;
      opponent: string;
    };
    updatedAt?: string;
  }> {
    return fetchJson(`${API_BASE_URL}/leagues/${leagueId}/matchup/current?teamId=${teamId}`);
  },
};
