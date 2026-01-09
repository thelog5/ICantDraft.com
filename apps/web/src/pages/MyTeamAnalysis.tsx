import { useEffect, useState, useMemo } from "react";
import TopNav from "../components/TopNav";
import { useActiveContext } from "../hooks/useActiveContext";
import { api, TeamProfileResponse, ApiError } from "../lib/api";
import { getPlayerRole, PlayerWithStats } from "../lib/playerRole";
import Card from "../components/Card";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import "./MyTeamAnalysis.css";

type RosterPlayerWithStats = {
  id: string;
  fullName: string;
  providerPlayerId: string | null;
  positions: string[];
  headshotUrl: string | null;
  isIR: boolean;
  status: string;
  lineupSlot: string | null;
  injuryStatus: string;
  injuryDescription: string | null;
  estimatedReturnDate: string | null;
  stats: {
    perGame: {
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
    totals: {
      pts: number;
      reb: number;
      ast: number;
      stl: number;
      blk: number;
      threes: number;
      fgPct: number;
      ftPct: number;
      tov: number;
      fgm: number;
      fga: number;
      ftm: number;
      fta: number;
      gp: number;
    };
    source?: {
      statSourceId: number;
      scoringPeriodId: number;
      statSplitTypeId: number | undefined;
    };
    statsSource: "CURRENT_SEASON" | "ESPN_PROJECTION" | "NONE";
  };
  derived?: {
    roleHint?: string | null;
  };
};

export default function MyTeamAnalysis() {
  const { loading: contextLoading, ctx } = useActiveContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);
  const [roster, setRoster] = useState<RosterPlayerWithStats[]>([]);

  // ALL HOOKS MUST BE CALLED UNCONDITIONALLY AT THE TOP
  // Calculate roles and sort roster by role score - must be called before any returns
  const rosterWithRoles = useMemo(() => {
    if (!profile || roster.length === 0) {
      // Return roster with default roles if no profile
      return roster.map((player) => ({
        ...player,
        role: {
          label: "Roster Player",
          color: "gray" as const,
          reason: "No profile data",
          score: 0,
        },
      }));
    }

    try {
      // Convert all players to PlayerWithStats format once
      const allPlayersForRole: PlayerWithStats[] = roster.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        stats: {
          perGame: p.stats.perGame,
          totals: {
            gp: p.stats.totals.gp,
            fga: p.stats.totals.fga,
            fta: p.stats.totals.fta,
          },
        },
        derived: p.derived,
      }));

      // Convert TeamProfileResponse to TeamProfile format expected by getPlayerRole
      const teamProfileForRole = {
        profile: {
          zScores: profile.profile.zScores,
          categoryRank: profile.profile.categoryRank,
        },
        leagueAverage: profile.leagueAverage,
        leagueRanksSummary: profile.leagueRanksSummary,
      };

      const playersWithRoles = roster.map((player, index) => {
        try {
          const playerForRole = allPlayersForRole[index];
          const role = getPlayerRole(
            playerForRole,
            teamProfileForRole,
            profile.leagueAverage,
            allPlayersForRole
          );
          return { ...player, role };
        } catch (err) {
          console.error("Error calculating role for player:", player.fullName, err);
          // Return default role if calculation fails
          return {
            ...player,
            role: {
              label: "Roster Player",
              color: "gray" as const,
              reason: "Unable to calculate",
              score: 0,
            },
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
        const priorityA = rolePriority[a.role.label] || 99;
        const priorityB = rolePriority[b.role.label] || 99;
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        // Within same role, sort by score (descending)
        return b.role.score - a.role.score;
      });
    } catch (err) {
      console.error("Error calculating roles:", err);
      // Return roster without roles if calculation fails
      return roster.map((player) => ({
        ...player,
        role: {
          label: "Roster Player",
          color: "gray" as const,
          reason: "Unable to calculate",
          score: 0,
        },
      }));
    }
  }, [roster, profile]);

  useEffect(() => {
    if (contextLoading || !ctx) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, contextLoading]);

  const loadData = async () => {
    if (!ctx) return;

    setLoading(true);
    setError(null);

    try {
      const [profileData, rosterData] = await Promise.all([
        api.getTeamProfile(ctx.leagueId, ctx.teamId),
        api.getRosterStats(ctx.leagueId, ctx.teamId).catch((err) => {
          console.error("Failed to load roster stats:", err);
          // Return empty roster if endpoint fails
          return { roster: [], teamId: ctx.teamId, teamName: "" };
        }),
      ]);

      setProfile(profileData);
      setRoster(rosterData.roster || []);
    } catch (err) {
      console.error("Error loading team analysis:", err);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load team analysis data");
      }
    } finally {
      setLoading(false);
    }
  };

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await api.refreshEspnData();
      await loadData();
    } catch (err) {
      console.error("Refresh failed:", err);
      setError("Failed to refresh ESPN data");
    } finally {
      setRefreshing(false);
    }
  };

  if (contextLoading || loading || !ctx) {
    return (
      <TopNav>
        <div className="my-team-analysis">
          <Skeleton height="200px" width="100%" />
          <Skeleton height="400px" width="100%" style={{ marginTop: "2rem" }} />
        </div>
      </TopNav>
    );
  }

  if (error) {
    return (
      <TopNav>
        <div className="my-team-analysis">
          <ErrorState message={error} onRetry={loadData} />
        </div>
      </TopNav>
    );
  }

  if (!profile) {
    return (
      <TopNav>
        <div className="my-team-analysis">
          <ErrorState message="Team profile not found" />
        </div>
      </TopNav>
    );
  }

  // Safety check for profile structure
  if (!profile.profile || !profile.profile.zScores || !profile.profile.categoryRank) {
    return (
      <TopNav>
        <div className="my-team-analysis">
          <ErrorState message="Invalid team profile data structure" />
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

  // Strengths: top 3 best ranks (lowest rank numbers)
  const strengths = categoryKeys
    .map((key) => ({
      key,
      rank: profile.profile.categoryRank[key],
      zScore: profile.profile.zScores[key],
    }))
    .filter((cat) => cat.key !== "tov")
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3);

  // Weaknesses: bottom 3 worst ranks (highest rank numbers)
  const weaknesses = categoryKeys
    .map((key) => ({
      key,
      rank: profile.profile.categoryRank[key],
      zScore: profile.profile.zScores[key],
    }))
    .filter((cat) => cat.key !== "tov")
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3);

  // Punt candidates: worst 2 z-scores
  const puntCandidates = categoryKeys
    .map((key) => ({
      key,
      zScore: profile.profile.zScores[key],
      rank: profile.profile.categoryRank[key],
    }))
    .filter((cat) => cat.key !== "tov")
    .sort((a, b) => a.zScore - b.zScore)
    .slice(0, 2);

  // Keep focus: best 3-4 z-scores
  const keepFocus = categoryKeys
    .map((key) => ({
      key,
      zScore: profile.profile.zScores[key],
      rank: profile.profile.categoryRank[key],
    }))
    .filter((cat) => cat.key !== "tov")
    .sort((a, b) => b.zScore - a.zScore)
    .slice(0, 4);

  const totalTeams = profile.leagueRanksSummary?.length || 14;

  // Helper functions - these are not hooks, so they can be defined anywhere
  const formatPercentage = (value: number): string => {
    if (value === 0 || !Number.isFinite(value)) return "—";
    return `${(value * 100).toFixed(1)}%`;
  };

  const formatStat = (value: number, decimals: number = 1): string => {
    if (value === 0 || !Number.isFinite(value)) return "—";
    return value.toFixed(decimals);
  };

  return (
    <TopNav>
      <div className="my-team-analysis">
        <div className="page-header">
          <div className="page-header-text">
            <h1 className="page-title">Team Analysis: {ctx?.teamName || "My Team"}</h1>
            <p className="page-subtitle">{ctx?.leagueName || ""}</p>
          </div>
          <button 
            className="refresh-espn-button" 
            onClick={handleRefresh}
            disabled={refreshing || loading}
          >
            {refreshing ? "Refreshing..." : "Refresh ESPN Data"}
          </button>
        </div>

        {/* A) Full Roster Table */}
        <Card>
          <h2 className="card-title">Full Roster</h2>
          <p className="roster-stats-description" style={{ fontSize: "0.875rem", color: "#666", marginTop: "0.25rem", marginBottom: "1rem" }}>
            All stats shown are season-to-date per-game averages.
          </p>
          {rosterWithRoles.length > 0 ? (
            <div className="roster-table-wrapper">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th className="stat-col" title="Season per game">PTS</th>
                    <th className="stat-col" title="Season per game">REB</th>
                    <th className="stat-col" title="Season per game">AST</th>
                    <th className="stat-col" title="Season per game">STL</th>
                    <th className="stat-col" title="Season per game">BLK</th>
                    <th className="stat-col" title="Season per game">3PM</th>
                    <th className="stat-col" title="Season per game">FG%</th>
                    <th className="stat-col" title="Season per game">FT%</th>
                    <th className="stat-col" title="Season per game">TO</th>
                  </tr>
                </thead>
                <tbody>
                  {rosterWithRoles.map((player) => {
                    const stats = player.stats?.perGame;
                    const hasStats = player.stats?.totals?.gp > 0;
                    const role = player.role || {
                      label: "Roster Player",
                      color: "gray" as const,
                      reason: "Unknown",
                      score: 0,
                    };
                    return (
                      <tr key={player.id}>
                        <td className="player-cell">
                          <div className="player-info-cell">
                            {player.headshotUrl ? (
                              <img
                                src={player.headshotUrl}
                                alt={player.fullName}
                                className="player-headshot-large"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <div className="player-headshot-placeholder-large"></div>
                            )}
                            <div className="player-name-wrapper">
                              <div className="player-name-row">
                                <span className="player-name-cell">{player.fullName}</span>
                                {/* Injury status pill */}
                                {(player.injuryStatus === "IR" || player.injuryStatus === "OUT" || player.injuryStatus === "DTD" || player.injuryStatus === "SUSP") && (
                                  <span 
                                    className={`player-injury-pill injury-${player.injuryStatus.toLowerCase()}`}
                                    title={player.injuryDescription || player.injuryStatus}
                                  >
                                    {player.injuryStatus}
                                  </span>
                                )}
                                <span 
                                  className={`player-role-pill role-${role.color}`}
                                  title={"hoverText" in role ? role.hoverText || role.reason : role.reason}
                                >
                                  {role.label}
                                </span>
                              </div>
                              <div className="player-role-reason" title={"hoverText" in role ? role.hoverText || role.reason : role.reason}>
                                {role.reason}
                                {player.estimatedReturnDate && (
                                  <span className="injury-return-date" style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#999" }}>
                                    (Return: {new Date(player.estimatedReturnDate).toLocaleDateString()})
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="stat-col">{hasStats && stats ? formatStat(stats.pts, 1) : "—"}</td>
                        <td className="stat-col">{hasStats && stats ? formatStat(stats.reb, 1) : "—"}</td>
                        <td className="stat-col">{hasStats && stats ? formatStat(stats.ast, 1) : "—"}</td>
                        <td className="stat-col">{hasStats && stats ? formatStat(stats.stl, 1) : "—"}</td>
                        <td className="stat-col">{hasStats && stats ? formatStat(stats.blk, 1) : "—"}</td>
                        <td className="stat-col">{hasStats && stats ? formatStat(stats.threes, 1) : "—"}</td>
                        <td className="stat-col">{hasStats && stats ? formatPercentage(stats.fgPct) : "—"}</td>
                        <td className="stat-col">{hasStats && stats ? formatPercentage(stats.ftPct) : "—"}</td>
                        <td className="stat-col">{hasStats && stats ? formatStat(stats.tov, 1) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="roster-note">
                <small>Stats shown are per-game averages. Players sorted by overall impact score.</small>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>No roster data available. Please ensure player data has been ingested.</p>
            </div>
          )}
        </Card>

        {/* B) Strengths / Weaknesses */}
        <Card>
          <h2 className="card-title">Category Strengths & Weaknesses</h2>
          <div className="strengths-weaknesses-grid">
            <div className="strength-section">
              <h3 className="section-label">Top 3 Strengths</h3>
              <div className="category-badges">
                {strengths.map((cat) => (
                  <div key={cat.key} className="category-badge strength">
                    <div className="badge-detail">#{cat.rank}</div>
                    <div className="badge-category">{categoryLabels[cat.key]}</div>
                    <div className="badge-total-teams">out of {totalTeams} teams</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="weakness-section">
              <h3 className="section-label">Bottom 3 Weaknesses</h3>
              <div className="category-badges">
                {weaknesses.map((cat) => (
                  <div key={cat.key} className="category-badge weakness">
                    <div className="badge-detail">#{cat.rank}</div>
                    <div className="badge-category">{categoryLabels[cat.key]}</div>
                    <div className="badge-total-teams">out of {totalTeams} teams</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* C) Punt Strategy */}
        <Card>
          <h2 className="card-title">Punt Strategy Recommendation</h2>
          <div className="punt-explanation-box">
            <div className="punt-explanation-icon">💡</div>
            <div className="punt-explanation-content">
              <p className="punt-explanation-title">What is "Punting" in 9-Cat Fantasy?</p>
              <p className="punt-explanation-text">
                <strong>Punting</strong> means intentionally deprioritizing 1-2 categories to dominate the others. 
                Since 9-cat leagues award wins based on category totals (not overall stats), focusing your roster 
                on 7-8 categories can be more effective than being mediocre across all 9.
              </p>
              <p className="punt-explanation-warning">
                ⚠️ <strong>Note:</strong> Punting is a strategic choice, not mandatory. It depends on your league format, 
                roster construction, and trading opportunities. Use this as a guide, not a rule.
              </p>
            </div>
          </div>
          
          <div className="punt-strategy-grid">
            <div className="punt-section">
              <h3 className="punt-section-title">Consider Punting</h3>
              <p className="punt-section-subtitle">These are your weakest categories—you could deprioritize them to strengthen others</p>
              <div className="punt-badges-modern">
                {puntCandidates.map((cat) => (
                  <div key={cat.key} className="punt-badge-modern">
                    <div className="badge-rank-large">#{cat.rank}</div>
                    <div className="badge-category-large">{categoryLabels[cat.key]}</div>
                    <div className="badge-total-teams">out of {totalTeams} teams</div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="focus-section">
              <h3 className="focus-section-title">Double Down Here</h3>
              <p className="focus-section-subtitle">Your strongest categories—reinforce these to dominate matchups</p>
              <div className="focus-badges-modern">
                {keepFocus.map((cat) => (
                  <div key={cat.key} className="focus-badge-modern">
                    <div className="badge-rank-large strength">#{cat.rank}</div>
                    <div className="badge-category-large">{categoryLabels[cat.key]}</div>
                    <div className="badge-total-teams">out of {totalTeams} teams</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </TopNav>
  );
}

