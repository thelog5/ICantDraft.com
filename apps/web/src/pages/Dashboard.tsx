import { useEffect, useState, useMemo } from "react";
import TopNav from "../components/TopNav";
import HomeHeader from "../components/HomeHeader";
import { useActiveContext } from "../hooks/useActiveContext";
import { api, TeamProfileResponse, ApiError } from "../lib/api";
import { getPlayerRole, PlayerWithStats, TeamProfile } from "../lib/playerRole";
import Card from "../components/Card";
import CategoryTile from "../components/CategoryTile";
import TeamRadarChart from "../components/RadarChart";
import WeeklyBarChart from "../components/WeeklyBarChart";
import PuntImpactChart from "../components/PuntImpactChart";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import "./Dashboard.css";

type RosterPlayer = {
  id: string;
  fullName: string;
  providerPlayerId: string | null;
  positions: string[];
  headshotUrl: string | null;
  role?: {
    label: string;
    color: "green" | "blue" | "yellow" | "red" | "gray";
    reason: string;
    score: number;
  };
};

export default function Dashboard() {
  const { loading: contextLoading, ctx } = useActiveContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [rosterStats, setRosterStats] = useState<Awaited<ReturnType<typeof api.getRosterStats>> | null>(null);
  const [allTeams, setAllTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedTeamIndex, setSelectedTeamIndex] = useState(0);
  const [selectedTeamProfile, setSelectedTeamProfile] = useState<TeamProfileResponse | null>(null);

  // ALL HOOKS MUST BE CALLED UNCONDITIONALLY AT THE TOP
  // Calculate roster with roles - must be called before any returns
  const rosterWithRoles = useMemo(() => {
    // Fallback to basic roster if no stats available
    if (!rosterStats || !rosterStats.roster || !Array.isArray(rosterStats.roster) || rosterStats.roster.length === 0) {
      return (roster || []).map((p) => ({ ...p, role: { label: "Roster Player", color: "blue" as const, reason: "", score: 0 } }));
    }

    // Need profile for role calculation
    if (!profile || !profile.profile || !profile.profile.zScores || !profile.profile.categoryRank) {
      return rosterStats.roster.map((p) => ({ ...p, role: { label: "Roster Player", color: "blue" as const, reason: "", score: 0 } }));
    }

    try {
      const allPlayersForRole: PlayerWithStats[] = rosterStats.roster.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        stats: {
          perGame: p.stats.perGame,
          totals: p.stats.totals || { gp: 0, fga: 0, fta: 0 },
        },
        derived: p.derived,
      }));

      const teamProfileForRole: TeamProfile = {
        profile: {
          zScores: profile.profile.zScores,
          categoryRank: profile.profile.categoryRank,
        },
        leagueAverage: profile.leagueAverage,
        leagueRanksSummary: profile.leagueRanksSummary || [],
      };

      const playersWithRoles = rosterStats.roster.map((player) => {
        try {
          const playerForRole = allPlayersForRole.find((p) => p.id === player.id);
          if (!playerForRole) {
            return {
              ...player,
              role: { label: "Roster Player", color: "blue" as const, reason: "", score: 0 },
            };
          }

          const role = getPlayerRole(
            playerForRole,
            teamProfileForRole,
            profile.leagueAverage,
            allPlayersForRole
          );

          return { ...player, role };
        } catch (err) {
          console.error("Error calculating role for player:", player.fullName, err);
          return {
            ...player,
            role: { label: "Roster Player", color: "blue" as const, reason: "", score: 0 },
          };
        }
      });

      // Sort by role priority: Core → Roster → Expendable → Trade
      const rolePriority: Record<string, number> = {
        "Core Player": 1,
        "Roster Player": 2,
        "Expendable": 3,
        "Trade Candidate": 4,
        "Low Impact": 5,
      };
      return playersWithRoles.sort((a, b) => {
        const priorityA = rolePriority[a.role?.label || "Roster Player"] || 99;
        const priorityB = rolePriority[b.role?.label || "Roster Player"] || 99;
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        return (b.role?.score || 0) - (a.role?.score || 0);
      });
    } catch (err) {
      console.error("Error calculating roles:", err);
      return rosterStats.roster.map((p) => ({ ...p, role: { label: "Roster Player", color: "blue" as const, reason: "", score: 0 } }));
    }
  }, [rosterStats, profile, roster]);

  // ALL HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  // Weekly projections data (selected team vs league average) - ALL 9 categories
  // Normalized to 0-100 scale so all categories are visible
  const weeklyData = useMemo(() => {
    if (!profile) return [];
    const selectedProfile = selectedTeamProfile || profile;
    
    const categoryKeys: Array<keyof typeof profile.profile.categoryRank> = [
      "pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov",
    ];
    const categoryLabels: Record<string, string> = {
      pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK",
      threes: "3PM", fgPct: "FG%", ftPct: "FT%", tov: "TO",
    };
    
    // Find max values for normalization (excluding percentages which are already 0-100)
    const countingStats = categoryKeys.filter(k => k !== "fgPct" && k !== "ftPct");
    const maxTeamValue = Math.max(...countingStats.map(k => selectedProfile.profile.rawTotals[k]));
    const maxLeagueAvg = Math.max(...countingStats.map(k => profile.leagueAverage[k]));
    const maxValue = Math.max(maxTeamValue, maxLeagueAvg, 100); // At least 100 for percentage scale
    
    return categoryKeys.map((key) => {
      const teamValue = selectedProfile.profile.rawTotals[key];
      // Always use the base profile's league average, not the selected team's values
      const leagueAvg = profile.leagueAverage[key];
      
      let displayTeamValue: number;
      let displayLeagueAvg: number;
      let displayOpponent: number;
      
      if (key === "fgPct" || key === "ftPct") {
        // Percentages: already 0-100 scale
        displayTeamValue = teamValue * 100;
        displayLeagueAvg = leagueAvg * 100;
        displayOpponent = displayLeagueAvg * 0.95;
      } else {
        // Counting stats: normalize to 0-100 scale
        displayTeamValue = (teamValue / maxValue) * 100;
        displayLeagueAvg = (leagueAvg / maxValue) * 100;
        displayOpponent = displayLeagueAvg * 0.95;
      }
      
      return {
        category: categoryLabels[key],
        myTeam: displayTeamValue,
        opponent: displayOpponent,
        leagueAvg: displayLeagueAvg,
        isPercentage: key === "fgPct" || key === "ftPct",
        rawTeamValue: teamValue, // Keep raw for tooltip
        rawLeagueAvg: leagueAvg, // Keep raw for tooltip - always the actual league average
      };
    });
  }, [selectedTeamProfile, profile]);

  // Calculate matchup score for selected team
  const matchupScore = useMemo(() => {
    if (!profile) return { wins: 0, losses: 0, ties: 0 };
    const selectedProfile = selectedTeamProfile || profile;
    
    const categoryKeys: Array<keyof typeof profile.profile.categoryRank> = [
      "pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov",
    ];
    
    let wins = 0;
    let losses = 0;
    let ties = 0;
    
    categoryKeys.forEach((key) => {
      const teamValue = selectedProfile.profile.rawTotals[key];
      const leagueAvg = profile.leagueAverage[key];
      const isLowerBetter = key === "tov";
      
      if (isLowerBetter) {
        if (teamValue < leagueAvg) wins++;
        else if (teamValue > leagueAvg) losses++;
        else ties++;
      } else {
        if (teamValue > leagueAvg) wins++;
        else if (teamValue < leagueAvg) losses++;
        else ties++;
      }
    });
    
    return { wins, losses, ties };
  }, [selectedTeamProfile, profile]);

  // Calculate categories won vs league average (different from matchup score)
  const leagueAvgComparison = useMemo(() => {
    if (!profile) return { wins: 0, losses: 0 };
    const selectedProfile = selectedTeamProfile || profile;
    
    const categoryKeys: Array<keyof typeof profile.profile.categoryRank> = [
      "pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov",
    ];
    
    let wins = 0;
    let losses = 0;
    
    categoryKeys.forEach((key) => {
      const teamValue = selectedProfile.profile.rawTotals[key];
      const leagueAvg = profile.leagueAverage[key];
      const isLowerBetter = key === "tov";
      
      if (isLowerBetter) {
        // For TOV, lower is better
        if (teamValue < leagueAvg) wins++;
        else if (teamValue > leagueAvg) losses++;
      } else {
        // For other categories, higher is better
        if (teamValue > leagueAvg) wins++;
        else if (teamValue < leagueAvg) losses++;
      }
    });
    
    return { wins, losses };
  }, [selectedTeamProfile, profile]);

  useEffect(() => {
    if (contextLoading || !ctx) return;

    // Check API health
    api.checkHealth().catch((err) => {
      const status = err instanceof ApiError && err.status 
        ? ` (HTTP ${err.status})`
        : "";
      setApiError(`API appears to be offline${status}`);
    });

    loadData();
  }, [ctx, contextLoading]);

  const loadData = async () => {
    if (!ctx) return;

    setLoading(true);
    setError(null);

    try {
      const [profileData, rosterData, rosterStatsData, teamsData] = await Promise.all([
        api.getTeamProfile(ctx.leagueId, ctx.teamId),
        api.getRoster(ctx.leagueId, ctx.teamId).catch(() => ({ roster: [] })),
        api.getRosterStats(ctx.leagueId, ctx.teamId).catch(() => null),
        api.getTeams(ctx.leagueId).catch(() => ({ teams: [], league: { id: "", name: "" } })),
      ]);

      setProfile(profileData);
      setRoster(rosterData.roster || []);
      setRosterStats(rosterStatsData);
      
      // Set up teams list and find initial selected team index
      const teamsList = teamsData.teams || [];
      setAllTeams(teamsList);
      const initialIndex = teamsList.findIndex((t) => t.id === ctx.teamId);
      const finalIndex = initialIndex >= 0 ? initialIndex : 0;
      setSelectedTeamIndex(finalIndex);
      
      // Set initial selected team profile to user's team (already loaded)
      setSelectedTeamProfile(profileData);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load dashboard data");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      await api.refreshEspnData();
      await loadData();
    } catch (err) {
      console.error("Refresh failed:", err);
    }
  };

  if (contextLoading || loading || !ctx) {
    return (
      <TopNav onRefresh={handleRefresh}>
        <div className="dashboard">
          <Skeleton height="200px" width="100%" />
          <Skeleton height="400px" width="100%" style={{ marginTop: "2rem" }} />
        </div>
      </TopNav>
    );
  }

  if (error) {
    return (
      <TopNav onRefresh={handleRefresh}>
        <div className="dashboard">
          <ErrorState message={error} onRetry={loadData} />
        </div>
      </TopNav>
    );
  }

  if (!profile) {
    return (
      <TopNav onRefresh={handleRefresh}>
        <div className="dashboard">
          <ErrorState message="No team profile found" onRetry={loadData} />
        </div>
      </TopNav>
    );
  }

  // Safety check for profile structure
  if (!profile.profile || !profile.profile.zScores || !profile.profile.categoryRank) {
    return (
      <TopNav onRefresh={handleRefresh}>
        <div className="dashboard">
          <ErrorState message="Invalid team profile data" onRetry={loadData} />
        </div>
      </TopNav>
    );
  }

  const categoryKeys: Array<keyof typeof profile.profile.categoryRank> = [
    "pts",
    "reb",
    "ast",
    "stl",
    "blk",
    "threes",
    "fgPct",
    "ftPct",
    "tov",
  ];

  const categoryLabels: Record<string, string> = {
    pts: "PTS",
    reb: "REB",
    ast: "AST",
    stl: "STL",
    blk: "BLK",
    threes: "3PM",
    fgPct: "FG%",
    ftPct: "FT%",
    tov: "TO",
  };

  const totalTeams = profile.leagueRanksSummary?.length || 14;

  // Prepare radar chart data (normalize ranks to 0-100, best = 100)
  // Also include raw values for tooltip display
  const radarData = categoryKeys.map((key) => {
    const rank = profile.profile.categoryRank[key];
    const normalizedValue = ((totalTeams - rank + 1) / totalTeams) * 100;
    // Get raw stat value for tooltip
    const rawValue = profile.profile.rawTotals[key];
    return {
      category: categoryLabels[key],
      value: normalizedValue,
      rawValue: key === "fgPct" || key === "ftPct" ? rawValue * 100 : rawValue, // Convert percentages for display
    };
  });

  // Handle team slider navigation
  const handleTeamChange = async (newIndex: number) => {
    if (!ctx || newIndex < 0 || newIndex >= allTeams.length) return;
    
    setSelectedTeamIndex(newIndex);
    const selectedTeam = allTeams[newIndex];
    
    try {
      const teamProfile = await api.getTeamProfile(ctx.leagueId, selectedTeam.id);
      setSelectedTeamProfile(teamProfile);
    } catch (err) {
      console.error("Failed to load team profile:", err);
      // Keep current profile on error
    }
  };

  const handlePrevTeam = () => {
    if (selectedTeamIndex > 0) {
      handleTeamChange(selectedTeamIndex - 1);
    }
  };

  const handleNextTeam = () => {
    if (selectedTeamIndex < allTeams.length - 1) {
      handleTeamChange(selectedTeamIndex + 1);
    }
  };

  // Punt strategy: worst 2 z-scores
  const puntCandidates = categoryKeys
    .map((key) => ({
      key,
      zScore: profile.profile.zScores[key],
      isLowerBetter: key === "tov",
    }))
    .sort((a, b) => {
      if (a.isLowerBetter) return a.zScore - b.zScore;
      return b.zScore - a.zScore;
    })
    .slice(0, 2);

  // Keep focus: best 4 ranks
  const keepFocus = categoryKeys
    .map((key) => ({
      key,
      rank: profile.profile.categoryRank[key],
      isLowerBetter: key === "tov",
    }))
    .filter((cat) => !cat.isLowerBetter)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 4);

  // Impact chart data
  const impactData = categoryKeys.slice(0, 4).map((key) => ({
    category: categoryLabels[key],
    gain: Math.max(0, profile.profile.zScores[key] * 10),
    loss: Math.max(0, -profile.profile.zScores[key] * 10),
  }));

  return (
    <TopNav onRefresh={handleRefresh}>
      {apiError && (
        <div className="api-error-banner">
          ⚠️ {apiError}
        </div>
      )}
      <div className="dashboard">
        <HomeHeader leagueId={ctx.leagueId} myTeamId={ctx.teamId} />
        <div className="dashboard-grid">
          {/* Category Overview - Left */}
          <Card className="dashboard-card category-overview-card">
            <h2 className="card-title">Category Overview</h2>
            <div className="category-overview-description">
              Your team's league rank for each of the 9 fantasy categories.
            </div>
            <div className="category-tiles-grid">
              {categoryKeys.map((key) => (
                <CategoryTile
                  key={key}
                  category={categoryLabels[key]}
                  rank={profile.profile.categoryRank[key]}
                  totalTeams={totalTeams}
                />
              ))}
            </div>
          </Card>

          {/* Team Performance - Right */}
          <Card className="dashboard-card team-performance-card">
            <h2 className="card-title">Team Performance</h2>
            <div className="team-performance-description">
              Visual breakdown of your team's category performance. Hover over chart points to see actual stat values (PTS, REB, AST, etc.).
            </div>
            <div className="team-performance-content">
              <div className="team-performance-chart-section">
                <TeamRadarChart data={radarData} />
                <div className="team-score-large-display">
                  <div className="team-score-number-wrapper">
                    <div className="team-score-number">
                      {profile.profile.normalizedTeamScore0to9.toFixed(1)}
                    </div>
                  </div>
                  <div className="team-score-separator">of</div>
                  <div className="team-score-denominator">9.0</div>
                  <div className="team-score-large-label">Team Score</div>
                  <div className="team-score-explanation">
                    Expected categories won per matchup. A score of 6.0 means you typically win 6 out of 9 categories each week.
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Weekly Projections */}
          <Card className="dashboard-card weekly-projections-card">
            <h2 className="card-title">Weekly Projections</h2>
            <div className="weekly-projections-description">
              Compare projected weekly stats across all teams in your league. Use the arrows to navigate between teams and see how each team stacks up against the league average.
            </div>
            <div className="weekly-matchup-selector">
              <div className="matchup-header-bar">
                <button 
                  className="matchup-nav-btn" 
                  onClick={handlePrevTeam}
                  disabled={selectedTeamIndex === 0}
                >
                  &lt;
                </button>
                <div className="matchup-teams">
                  <span className="matchup-team-icon">🏀</span>
                  <span className="matchup-my-team">
                    {allTeams.length > 0 && selectedTeamIndex >= 0 
                      ? allTeams[selectedTeamIndex]?.name || "Loading..."
                      : "Your Team"}
                  </span>
                </div>
                <button 
                  className="matchup-nav-btn" 
                  onClick={handleNextTeam}
                  disabled={selectedTeamIndex >= allTeams.length - 1}
                >
                  &gt;
                </button>
              </div>
              <div className="matchup-score-bar">
                <div className="matchup-score">
                  {matchupScore.wins}-{matchupScore.losses}
                  {matchupScore.ties > 0 ? `-${matchupScore.ties}` : ""}
                </div>
                <div className="matchup-league-avg">vs. League Avg: {leagueAvgComparison.wins}-{leagueAvgComparison.losses}</div>
              </div>
            </div>
            <div className="weekly-projections-content">
              <div className="weekly-chart-container">
                <WeeklyBarChart data={weeklyData} />
                <div className="weekly-chart-note">
                  <strong>All 9 categories shown.</strong> FG%/FT% shown as percentages. Data derived from season totals – real weekly projections coming soon.
                </div>
              </div>
            </div>
          </Card>

          {/* Trade Suggestions */}
          <Card className="dashboard-card trade-suggestions-card">
            <div className="trade-suggestions-header">
              <h2 className="card-title">Trade Suggestions</h2>
              <button className="view-all-button" disabled>View All Proposals →</button>
            </div>
            <div className="trade-suggestions-grid">
              <div className="trade-suggestion-placeholder">
                <div className="trade-placeholder-icon">📊</div>
                <p className="trade-placeholder-text">
                  Trade analysis engine requires player-level valuation data
                </p>
                <p className="trade-placeholder-subtext">Coming soon</p>
              </div>
            </div>
          </Card>

          {/* My Team Analysis */}
          <Card className="dashboard-card team-analysis-card">
            <h2 className="card-title">My Team Analysis</h2>
            {rosterWithRoles && rosterWithRoles.length > 0 ? (
              <div className="team-analysis-list">
                {(() => {
                  // Group players by role
                  const roleGroups: Record<string, Array<typeof rosterWithRoles[0]>> = {
                    "Core Player": [],
                    "Roster Player": [],
                    "Expendable": [],
                    "Trade Candidate": [],
                    "Low Impact": [],
                  };
                  
                  rosterWithRoles.forEach((player) => {
                    const roleLabel = player.role?.label || "Roster Player";
                    if (roleGroups[roleLabel]) {
                      roleGroups[roleLabel].push(player);
                    } else {
                      roleGroups["Roster Player"].push(player);
                    }
                  });
                  
                  // Build display list: show 6 players total
                  // First 4 slots: one of each type (Core, Roster, Expendable, Trade) if available
                  // Last 2 slots: prioritize Trade Candidate and Expendable
                  const displayList: Array<typeof rosterWithRoles[0]> = [];
                  const totalToShow = 6;
                  
                  // First pass: add one of each of the 4 main types if available
                  const mainTypes = ["Core Player", "Roster Player", "Expendable", "Trade Candidate"];
                  for (const roleLabel of mainTypes) {
                    if (roleGroups[roleLabel].length > 0 && displayList.length < 4) {
                      displayList.push(roleGroups[roleLabel][0]);
                      roleGroups[roleLabel] = roleGroups[roleLabel].slice(1);
                    }
                  }
                  
                  // Second pass: fill remaining slots (up to 6 total) prioritizing Trade Candidate and Expendable
                  const priorityOrder = ["Trade Candidate", "Expendable", "Core Player", "Roster Player", "Low Impact"];
                  while (displayList.length < totalToShow) {
                    let added = false;
                    for (const roleLabel of priorityOrder) {
                      if (roleGroups[roleLabel].length > 0 && displayList.length < totalToShow) {
                        displayList.push(roleGroups[roleLabel][0]);
                        roleGroups[roleLabel] = roleGroups[roleLabel].slice(1);
                        added = true;
                        break;
                      }
                    }
                    if (!added) break; // No more players available
                  }
                  
                  // Sort the final list by role priority: Core → Roster → Expendable → Trade
                  const rolePriority: Record<string, number> = {
                    "Core Player": 1,
                    "Roster Player": 2,
                    "Expendable": 3,
                    "Trade Candidate": 4,
                    "Low Impact": 5,
                  };
                  displayList.sort((a, b) => {
                    const priorityA = rolePriority[a.role?.label || "Roster Player"] || 99;
                    const priorityB = rolePriority[b.role?.label || "Roster Player"] || 99;
                    return priorityA - priorityB;
                  });
                  
                  return displayList.map((player) => {
                    const roleColorMap: Record<string, string> = {
                      "Core Player": "core",
                      "Roster Player": "roster",
                      "Expendable": "expendable",
                      "Trade Candidate": "conflict",
                      "Low Impact": "low-impact",
                    };
                    const roleClass = roleColorMap[player.role?.label || "Roster Player"] || "roster";
                    
                    return (
                      <div key={player.id} className="team-analysis-item">
                        <div className="player-info">
                          {player.headshotUrl ? (
                            <img
                              src={player.headshotUrl}
                              alt={player.fullName}
                              className="player-headshot"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="player-headshot"></div>
                          )}
                          <div className="player-details">
                            <div className="player-name">{player.fullName}</div>
                            <div className={`player-role ${roleClass}`}>
                              {player.role?.label || "Roster Player"}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              <div className="team-analysis-empty">
                <p className="empty-state-text">
                  Roster data not available. Please ensure player data has been ingested.
                </p>
              </div>
            )}
          </Card>

          {/* Punt Strategy */}
          <Card className="dashboard-card punt-strategy-card">
            <h2 className="card-title">Punt Strategy</h2>
            <div className="punt-strategy-content">
              <div className="punt-strategy-recommendation">
                <div className="punt-strategy-label">Recommended Punt:</div>
                <div className="punt-strategy-categories">
                  {puntCandidates.map((cat) => (
                    <span key={cat.key} className="punt-category-badge">
                      {categoryLabels[cat.key]}
                    </span>
                  ))}
                </div>
              </div>
              <div className="punt-strategy-focus">
                <div className="punt-strategy-label">Keep Focus:</div>
                <div className="punt-strategy-focus-cats">
                  {keepFocus.map((cat) => categoryLabels[cat.key]).join(", ")}
                </div>
              </div>
              <div className="punt-impact-chart-container">
                <h4>Category Impact</h4>
                <PuntImpactChart data={impactData} />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </TopNav>
  );
}
