import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopNav from "../components/TopNav";
import { useActiveContext } from "../hooks/useActiveContext";
import { api, ApiError } from "../lib/api";
import Card from "../components/Card";
import WeeklyBarChart from "../components/WeeklyBarChart";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import "./WeeklyProjections.css";

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

type TeamProjectionSummary = {
  teamId: string;
  teamName: string;
  avatarUrl: string | null;
  projectedScore: string;
  opponentId: string | null;
  opponentName: string | null;
  opponentAvatarUrl: string | null;
  matchupCategories: Array<{
    key: "pts" | "reb" | "ast" | "stl" | "blk" | "threes" | "fgPct" | "ftPct" | "tov";
    teamTotal: number;
    opponentTotal: number;
    winner: "TEAM" | "OPPONENT" | "TIE";
  }> | null;
};

export default function WeeklyProjections() {
  const { loading: contextLoading, ctx } = useActiveContext();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projections, setProjections] = useState<Awaited<ReturnType<typeof api.getWeeklyProjections>> | null>(null);
  const [otherTeamsProjections, setOtherTeamsProjections] = useState<TeamProjectionSummary[]>([]);
  const [loadingOtherTeams, setLoadingOtherTeams] = useState(false);

  useEffect(() => {
    if (contextLoading || !ctx) return;
    loadData();
  }, [ctx, contextLoading]);

  const loadData = async () => {
    if (!ctx) return;

    setLoading(true);
    setError(null);

    try {
      const [data, teamsData] = await Promise.all([
        api.getWeeklyProjections(ctx.leagueId, ctx.teamId),
        api.getTeams(ctx.leagueId).catch(() => ({ teams: [], league: { id: "", name: "" } })),
      ]);
      setProjections(data);
      const teamsList = teamsData.teams || [];
      const otherTeams = teamsList.filter((t) => t.id !== ctx.teamId); // Exclude current team
      
      // Load projections for other teams
      loadOtherTeamsProjections(otherTeams);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load projections");
      }
    } finally {
      setLoading(false);
    }
  };

  const loadOtherTeamsProjections = async (teams: Array<{ id: string; name: string }>) => {
    if (!ctx || teams.length === 0) return;

    setLoadingOtherTeams(true);
    try {
      const projectionsPromises = teams.map(async (team) => {
        try {
          const proj = await api.getWeeklyProjections(ctx.leagueId, team.id);
          return {
            teamId: team.id,
            teamName: proj.team.teamName,
            avatarUrl: proj.team.avatarUrl,
            projectedScore: proj.matchup
              ? `${proj.matchup.projectedScore.teamCatsWon}-${proj.matchup.projectedScore.opponentCatsWon}${proj.matchup.projectedScore.tied > 0 ? `-${proj.matchup.projectedScore.tied}` : ""}`
              : "—",
            opponentId: proj.opponent?.teamId || null,
            opponentName: proj.opponent?.teamName || null,
            opponentAvatarUrl: proj.opponent?.avatarUrl || null,
            matchupCategories: proj.matchup?.categories || null,
          };
        } catch (err) {
          console.error(`Failed to load projections for team ${team.id}:`, err);
          return null;
        }
      });

      const results = await Promise.all(projectionsPromises);
      const allProjections = results.filter((r): r is TeamProjectionSummary => r !== null);
      
      // Deduplicate matchups: each matchup should only appear once
      // Create a unique matchup key by sorting team IDs
      const matchupMap = new Map<string, TeamProjectionSummary>();
      
      for (const proj of allProjections) {
        if (!proj.opponentId) {
          // No opponent, include it
          matchupMap.set(proj.teamId, proj);
          continue;
        }
        
        // Create a unique key by sorting team IDs
        const matchupKey = [proj.teamId, proj.opponentId].sort().join("-");
        
        // Only add if we haven't seen this matchup yet
        if (!matchupMap.has(matchupKey)) {
          matchupMap.set(matchupKey, proj);
        }
      }
      
      setOtherTeamsProjections(Array.from(matchupMap.values()));
    } catch (err) {
      console.error("Failed to load other teams projections:", err);
    } finally {
      setLoadingOtherTeams(false);
    }
  };

  if (contextLoading || loading || !ctx) {
    return (
      <TopNav>
        <div className="weekly-projections-page">
          <Skeleton height="400px" width="100%" />
        </div>
      </TopNav>
    );
  }

  if (error) {
    return (
      <TopNav>
        <div className="weekly-projections-page">
          <ErrorState message={error} onRetry={loadData} />
        </div>
      </TopNav>
    );
  }

  if (!projections) {
    return (
      <TopNav>
        <div className="weekly-projections-page">
          <ErrorState message="No projections found" onRetry={loadData} />
        </div>
      </TopNav>
    );
  }

  // Prepare chart data (all 9 categories)
  const categoryKeys: Array<keyof typeof projections.leagueAverages> = [
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

  // Normalize values for chart (0-100 scale)
  const countingStats = categoryKeys.filter((k) => k !== "fgPct" && k !== "ftPct" && k !== "tov");
  const maxValue = Math.max(
    ...countingStats.map((k) => projections.team.projectedTotals[k]),
    ...countingStats.map((k) => (projections.opponent?.projectedTotals[k] || 0)),
    ...countingStats.map((k) => projections.leagueAverages[k]),
    100
  );

  const weeklyData = categoryKeys.map((key) => {
    const teamValue = projections.team.projectedTotals[key];
    const opponentValue = projections.opponent?.projectedTotals[key] || 0;
    const leagueAvg = projections.leagueAverages[key];

    let displayTeamValue: number;
    let displayOpponentValue: number;
    let displayLeagueAvg: number;
    let rawTeamValue: number;
    let rawOpponentValue: number;
    let rawLeagueAvg: number;

    if (key === "fgPct" || key === "ftPct") {
      // Percentages: already 0-1 scale, convert to 0-100 for display
      displayTeamValue = teamValue * 100;
      displayOpponentValue = opponentValue * 100;
      displayLeagueAvg = leagueAvg * 100;
      rawTeamValue = teamValue;
      rawOpponentValue = opponentValue;
      rawLeagueAvg = leagueAvg;
    } else {
      // Counting stats: normalize to 0-100
      displayTeamValue = (teamValue / maxValue) * 100;
      displayOpponentValue = (opponentValue / maxValue) * 100;
      displayLeagueAvg = (leagueAvg / maxValue) * 100;
      rawTeamValue = teamValue;
      rawOpponentValue = opponentValue;
      rawLeagueAvg = leagueAvg;
    }

    return {
      category: categoryLabels[key],
      myTeam: displayTeamValue,
      opponent: displayOpponentValue,
      leagueAvg: displayLeagueAvg,
      isPercentage: key === "fgPct" || key === "ftPct",
      rawTeamValue,
      rawOpponentValue,
      rawLeagueAvg,
    };
  });

  const formatStat = (value: number, isPercentage: boolean): string => {
    if (isPercentage) {
      return `${(value * 100).toFixed(1)}%`;
    }
    return value.toFixed(1);
  };

  // Compute contention (closest categories)
  type ContestedCategory = {
    key: string;
    label: string;
    myValue: number;
    oppValue: number;
    delta: number;
    absDelta: number;
    isPercentage: boolean;
    isFavored: boolean;
    isTurnover: boolean;
  };

  const contestedCategories: ContestedCategory[] = [];

  if (projections.opponent) {
    categoryKeys.forEach((key) => {
      const myValue = projections.team.projectedTotals[key];
      const oppValue = projections.opponent!.projectedTotals[key];
      const isPercentage = key === "fgPct" || key === "ftPct";
      const isTurnover = key === "tov";

      let delta: number;
      let absDelta: number;

      if (isPercentage) {
        // For percentages (stored as decimals), convert to percentage points for comparison
        delta = (myValue - oppValue) * 100;
        absDelta = Math.abs(delta);
      } else {
        // For counting stats, raw difference
        delta = myValue - oppValue;
        absDelta = Math.abs(delta);
      }

      // Determine if favored
      // For TO, lower is better
      const isFavored = isTurnover ? myValue < oppValue : myValue > oppValue;

      contestedCategories.push({
        key,
        label: categoryLabels[key],
        myValue,
        oppValue,
        delta,
        absDelta,
        isPercentage,
        isFavored,
        isTurnover,
      });
    });

    // Sort by smallest absolute difference (most contested)
    contestedCategories.sort((a, b) => a.absDelta - b.absDelta);
  }

  // Take top 4, excluding turnovers (can't stream for fewer TOs)
  const topContested = contestedCategories
    .filter(c => c.key !== "tov")
    .slice(0, 4);

  // Compute live contested categories (if live category data available)
  const liveCategories = (projections as any).liveCategories;
  const liveContestedCategories: ContestedCategory[] = [];
  const liveMatchupScore = (projections as any).liveMatchupScore;
  
  if (liveCategories && projections.opponent) {
    categoryKeys.forEach((key) => {
      const liveCat = liveCategories.find((c: any) => c.key === key);
      if (!liveCat) return;
      
      const myValue = liveCat.teamTotal;
      const oppValue = liveCat.opponentTotal;
      const isPercentage = key === "fgPct" || key === "ftPct";
      const isTurnover = key === "tov";

      let delta: number;
      let absDelta: number;

      if (isPercentage) {
        // Percentages come as decimals (0.45), convert to percentage points for comparison
        delta = (myValue - oppValue) * 100;
        absDelta = Math.abs(delta);
      } else {
        delta = myValue - oppValue;
        absDelta = Math.abs(delta);
      }

      const isFavored = isTurnover ? myValue < oppValue : myValue > oppValue;

      liveContestedCategories.push({
        key,
        label: categoryLabels[key],
        myValue,
        oppValue,
        delta,
        absDelta,
        isPercentage,
        isFavored,
        isTurnover,
      });
    });

    // Sort by absDelta (smallest = most contested)
    // Exclude turnovers from top contested since you can't stream for fewer TOs
    liveContestedCategories.sort((a, b) => a.absDelta - b.absDelta);
  }
  
  // Filter out turnovers for display - can't improve TO by streaming
  const topLiveContested = liveContestedCategories
    .filter(c => c.key !== "tov")
    .slice(0, 4);

  // Compute final combined contested categories
  // Exclude turnovers - you can't stream for fewer turnovers
  let finalContestedCategories: Array<ContestedCategory & { source: "Projected" | "Live" | "Equal" }> = [];
  const finalSelectedKeys = new Set<string>();
  
  if (projections.opponent) {
    // Filter out turnovers from consideration
    const streamableKeys = categoryKeys.filter(k => k !== "tov");
    
    const combined = streamableKeys.map((key) => {
      const projectedCat = contestedCategories.find(c => c.key === key);
      const liveCat = liveContestedCategories.find(c => c.key === key);
      
      // For percentages, projected values need same scaling as live (multiply by 100)
      const isPercentage = key === "fgPct" || key === "ftPct";
      const projectedDelta = projectedCat 
        ? (isPercentage ? projectedCat.absDelta * 100 : projectedCat.absDelta)
        : 0;
      const liveDelta = liveCat?.absDelta || projectedDelta;
      
      const smallerDelta = Math.min(projectedDelta, liveDelta);
      const source: "Projected" | "Live" | "Equal" = 
        projectedDelta < liveDelta ? "Projected" : 
        projectedDelta > liveDelta ? "Live" : 
        "Equal";
      
      // Use live values when source is "Live", otherwise use projected
      const cat = source === "Live" && liveCat ? liveCat : projectedCat!;
      return { ...cat, priorityDelta: smallerDelta, source };
    });
    
    // Sort by priority delta (smallest = most contested)
    combined.sort((a, b) => a.priorityDelta - b.priorityDelta);
    finalContestedCategories = combined.slice(0, 4);
    
    // Track which keys are selected for final focus
    finalContestedCategories.forEach(cat => finalSelectedKeys.add(cat.key));
  }

  return (
    <TopNav>
      <div className="weekly-projections-page">
        <div className="weekly-projections-header">
          <div className="header-left-section">
            <h1 className="weekly-projections-title">Weekly Projections</h1>
            <p className="weekly-projections-description">
              Track your matchup in real-time. <strong>Projected</strong> shows where you'll end up based on scheduled games. 
              <strong> Live</strong> shows your current actual score. Use <strong>Final Streaming Focus</strong> to guide your add/drop decisions.
            </p>
            <div className="weekly-projections-meta">
              <span>
                Scoring Period {projections.scoringPeriod.id}:{" "}
                {new Date(projections.scoringPeriod.startAt).toLocaleDateString()} -{" "}
                {new Date(projections.scoringPeriod.endAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          <button 
            className="refresh-espn-button"
            onClick={async () => {
              try {
                setLoading(true);
                await api.refreshEspnData();
                alert('ESPN data refreshed! Reloading...');
                await loadData();
              } catch (err) {
                alert('Error refreshing ESPN data: ' + (err instanceof Error ? err.message : 'Unknown error'));
              } finally {
                setLoading(false);
              }
            }}
          >
            🔄 Refresh ESPN Data
          </button>
        </div>

        {/* Two-Column Layout: Projected vs Live */}
        <div className="projections-two-column">
          {/* LEFT COLUMN: PROJECTED */}
          <div className="projection-column projected-column">
            <h2 className="column-title">📊 Projected</h2>
            
            {/* Projected Matchup Summary */}
            {projections.matchup && projections.opponent && (
              <Card className="matchup-summary-card projected-card">
                <div className="matchup-summary-header">
                  <h3 className="card-title">Projected Matchup Score</h3>
                </div>
            <div className="matchup-summary-content">
              <div className="matchup-teams">
                <div className="matchup-team-card">
                  {projections.team.avatarUrl ? (
                    <img src={projections.team.avatarUrl} alt={projections.team.teamName} className="team-avatar" />
                  ) : (
                    <div className="team-avatar-placeholder"></div>
                  )}
                  <div className="team-name">{projections.team.teamName}</div>
                  <div className="team-score">
                    {projections.matchup.projectedScore.teamCatsWon}
                  </div>
                </div>
                <div className="matchup-vs">VS</div>
                <div className="matchup-team-card">
                  {projections.opponent.avatarUrl ? (
                    <img src={projections.opponent.avatarUrl} alt={projections.opponent.teamName} className="team-avatar" />
                  ) : (
                    <div className="team-avatar-placeholder"></div>
                  )}
                  <div className="team-name">{projections.opponent.teamName}</div>
                  <div className="team-score">
                    {projections.matchup.projectedScore.opponentCatsWon}
                  </div>
                </div>
              </div>
              {projections.matchup.categories && projections.matchup.categories.length > 0 && (
                <div className="matchup-summary-categories">
                  {projections.matchup.categories.map((cat) => {
                    const isTeamWinner = cat.winner === "TEAM";
                    const isOpponentWinner = cat.winner === "OPPONENT";
                    return (
                      <div
                        key={cat.key}
                        className={`summary-category-box ${
                          isTeamWinner
                            ? "category-winner-team"
                            : isOpponentWinner
                            ? "category-winner-opponent"
                            : "category-tie"
                        }`}
                        title={`${categoryLabels[cat.key]}: ${isTeamWinner ? projections.team.teamName : isOpponentWinner && projections.opponent ? projections.opponent.teamName : "Tie"}`}
                      >
                        <div className="category-box-label">{categoryLabels[cat.key]}</div>
                        {isTeamWinner && projections.team.avatarUrl ? (
                          <img
                            src={projections.team.avatarUrl}
                            alt={projections.team.teamName}
                            className="category-box-avatar"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : isOpponentWinner && projections.opponent && projections.opponent.avatarUrl ? (
                          <img
                            src={projections.opponent.avatarUrl}
                            alt={projections.opponent.teamName}
                            className="category-box-avatar"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="category-box-tie">—</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        )}

            {/* Projected Biggest Contentions */}
            <Card className="biggest-contention-card projected-card">
              <h3 className="card-title">Projected Biggest Contentions</h3>
              {projections.opponent ? (
                <>
                  <p className="contention-description">
                    Closest projected categories — small swings can decide the outcome.
                  </p>
              <div className="contested-categories-grid">
                {topContested.map((cat) => {
                  return (
                    <div
                      key={cat.key}
                      className={`contested-category-pill ${cat.isFavored ? "favored" : "behind"}`}
                    >
                      <div className="contested-cat-label">{cat.label}</div>
                    <div className="contested-cat-values">
                      <div className="value-with-label">
                        <span className="value-owner-label">You</span>
                        <span className="my-value">
                          {cat.isPercentage ? (cat.myValue * 100).toFixed(1) + "%" : cat.myValue.toFixed(1)}
                        </span>
                      </div>
                      <span className="vs-separator">vs</span>
                      <div className="value-with-label">
                        <span className="value-owner-label">Them</span>
                        <span className="opp-value">
                          {cat.isPercentage ? (cat.oppValue * 100).toFixed(1) + "%" : cat.oppValue.toFixed(1)}
                        </span>
                      </div>
                    </div>
                    <div className="contested-cat-delta">
                      <span className={`delta-badge ${cat.isFavored ? "positive" : "negative"}`}>
                        {cat.isFavored ? "↑" : "↓"}{" "}
                        {cat.isPercentage
                          ? `${Math.abs(cat.delta).toFixed(1)}pp`
                          : cat.delta > 0
                          ? `+${cat.delta.toFixed(1)}`
                          : cat.delta.toFixed(1)}
                      </span>
                      <span className="advantage-indicator">
                        {cat.isFavored ? "Ahead" : "Behind"}
                      </span>
                    </div>
                  </div>
                  );
                })}
              </div>
                </>
              ) : (
                <p className="no-opponent-message">
                  No opponent matchup found — contention analysis unavailable.
                </p>
              )}
            </Card>
          </div>

          {/* RIGHT COLUMN: LIVE */}
          <div className="projection-column live-column">
            <h2 className="column-title">🔴 Live</h2>
            
            {/* Live Matchup Score */}
            {liveMatchupScore && projections.opponent && (
              <Card className="matchup-summary-card live-card">
                <div className="matchup-summary-header">
                  <h3 className="card-title">Live Matchup Score</h3>
                </div>
                <div className="matchup-summary-content">
                  <div className="matchup-teams">
                    <div className="matchup-team-card">
                      {projections.team.avatarUrl ? (
                        <img src={projections.team.avatarUrl} alt={projections.team.teamName} className="team-avatar" />
                      ) : (
                        <div className="team-avatar-placeholder"></div>
                      )}
                      <div className="team-name">{projections.team.teamName}</div>
                      <div className="team-score live-score">
                        {liveMatchupScore.teamCatsWon}
                      </div>
                    </div>
                    <div className="matchup-vs">VS</div>
                    <div className="matchup-team-card">
                      {projections.opponent.avatarUrl ? (
                        <img src={projections.opponent.avatarUrl} alt={projections.opponent.teamName} className="team-avatar" />
                      ) : (
                        <div className="team-avatar-placeholder"></div>
                      )}
                      <div className="team-name">{projections.opponent.teamName}</div>
                      <div className="team-score live-score">
                        {liveMatchupScore.opponentCatsWon}
                      </div>
                    </div>
                  </div>
                  {liveCategories && liveCategories.length > 0 && (
                    <div className="matchup-summary-categories">
                      {liveCategories.map((cat: any) => {
                        const isTeamWinner = cat.winner === "TEAM";
                        const isOpponentWinner = cat.winner === "OPPONENT";
                        return (
                          <div
                            key={cat.key}
                            className={`summary-category-box ${
                              isTeamWinner
                                ? "category-winner-team"
                                : isOpponentWinner
                                ? "category-winner-opponent"
                                : "category-tie"
                            }`}
                            title={`${categoryLabels[cat.key]}: ${isTeamWinner ? projections.team.teamName : isOpponentWinner && projections.opponent ? projections.opponent.teamName : "Tie"}`}
                          >
                            <div className="category-box-label">{categoryLabels[cat.key]}</div>
                            {isTeamWinner && projections.team.avatarUrl ? (
                              <img
                                src={projections.team.avatarUrl}
                                alt={projections.team.teamName}
                                className="category-box-avatar"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : isOpponentWinner && projections.opponent && projections.opponent.avatarUrl ? (
                              <img
                                src={projections.opponent.avatarUrl}
                                alt={projections.opponent.teamName}
                                className="category-box-avatar"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <div className="category-box-tie">—</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Live Biggest Contentions */}
            <Card className="biggest-contention-card live-card">
              <h3 className="card-title">Live Biggest Contentions</h3>
              {projections.opponent && topLiveContested.length > 0 ? (
                <>
                  <p className="contention-description">
                    Closest categories based on current live scores.
                  </p>
                  <div className="contested-categories-grid">
                    {topLiveContested.map((cat) => {
                      return (
                        <div
                          key={cat.key}
                          className={`contested-category-pill ${cat.isFavored ? "favored" : "behind"}`}
                        >
                          <div className="contested-cat-label">{cat.label}</div>
                          <div className="contested-cat-values">
                            <div className="value-with-label">
                              <span className="value-owner-label">You</span>
                              <span className="my-value">
                                {cat.isPercentage ? (cat.myValue * 100).toFixed(1) + "%" : cat.myValue.toFixed(1)}
                              </span>
                            </div>
                            <span className="vs-separator">vs</span>
                            <div className="value-with-label">
                              <span className="value-owner-label">Them</span>
                              <span className="opp-value">
                                {cat.isPercentage ? (cat.oppValue * 100).toFixed(1) + "%" : cat.oppValue.toFixed(1)}
                              </span>
                            </div>
                          </div>
                          <div className="contested-cat-delta">
                            <span className={`delta-badge ${cat.isFavored ? "positive" : "negative"}`}>
                              {cat.isFavored ? "↑" : "↓"}{" "}
                              {cat.isPercentage
                                ? `${Math.abs(cat.delta).toFixed(1)}pp`
                                : cat.delta > 0
                                ? `+${cat.delta.toFixed(1)}`
                                : cat.delta.toFixed(1)}
                            </span>
                            <span className="advantage-indicator">
                              {cat.isFavored ? "Ahead" : "Behind"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : projections.opponent ? (
                <p className="no-opponent-message">
                  Live category data not yet available. Check back once games start.
                </p>
              ) : (
                <p className="no-opponent-message">
                  No live matchup data available.
                </p>
              )}
            </Card>
          </div>
        </div>

        {/* Final Streaming Focus Section */}
        {projections.opponent && finalContestedCategories.length > 0 && (
          <Card className="final-streaming-focus-card">
            <div className="final-focus-header">
              <h2 className="card-title">🎯 Final Streaming Focus</h2>
              <p className="final-focus-description">
                Top 4 most contested categories combining both projected and live analysis. Focus your streaming targets on these.
              </p>
            </div>
            <div className="final-focus-grid">
              {finalContestedCategories.map((cat) => (
                <div
                  key={cat.key}
                  className={`final-focus-pill ${cat.isFavored ? "favored" : "behind"} selected-for-final`}
                >
                  <div className="selected-indicator">✓ SELECTED</div>
                  <div className="final-focus-cat-label">{cat.label}</div>
                  <div className="final-focus-source-badge">
                    <span className="source-label">Closest because:</span>
                    <span className={`source-value source-${cat.source.toLowerCase()}`}>
                      {cat.source}
                    </span>
                  </div>
                  <div className="final-focus-values">
                    <div className="value-with-label">
                      <span className="value-owner-label">You</span>
                      <span className="my-value">
                        {cat.isPercentage ? (cat.myValue * 100).toFixed(1) + "%" : cat.myValue.toFixed(1)}
                      </span>
                    </div>
                    <span className="vs-separator">vs</span>
                    <div className="value-with-label">
                      <span className="value-owner-label">Them</span>
                      <span className="opp-value">
                        {cat.isPercentage ? (cat.oppValue * 100).toFixed(1) + "%" : cat.oppValue.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <div className="final-focus-delta">
                    <span className={`delta-badge ${cat.isFavored ? "positive" : "negative"}`}>
                      {cat.isFavored ? "↑" : "↓"}{" "}
                      {cat.isPercentage
                        ? `${Math.abs(cat.delta).toFixed(1)}pp`
                        : cat.delta > 0
                        ? `+${cat.delta.toFixed(1)}`
                        : cat.delta.toFixed(1)}
                    </span>
                    <span className="advantage-indicator">
                      {cat.isFavored ? "Ahead" : "Behind"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="contention-cta">
              <p className="cta-text">Use these categories to guide your streaming decisions.</p>
              <button className="cta-button" onClick={() => navigate("/streaming")}>
                Go to Streaming →
              </button>
            </div>
          </Card>
        )}

        {/* Chart */}
        <Card className="weekly-projections-card-full">
          <h2 className="card-title">Category Comparison</h2>
          <p className="chart-description">
            Compare your projected stats against your opponent and the league average across all 9 categories.
          </p>
          <div className="weekly-projections-content-full">
            <div className="weekly-chart-container-full">
              <WeeklyBarChart data={weeklyData} />
              <div className="weekly-chart-note">
                All 9 categories shown. FG%/FT% shown as percentages. Values normalized for comparison.
                {!projections.opponent && " No opponent matchup found for this scoring period."}
              </div>
            </div>
          </div>
        </Card>

        {/* Category Winners Table */}
        {projections.matchup && (
          <Card className="category-winners-card">
            <h2 className="card-title">Category Winners</h2>
            <p className="category-winners-description">
              Detailed breakdown of projected category winners. ✓ means you win, ✗ means opponent wins, — means tie.
            </p>
            <div className="category-winners-table">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Your Team</th>
                    <th>Opponent</th>
                    <th>Winner</th>
                  </tr>
                </thead>
                <tbody>
                  {projections.matchup.categories.map((cat) => {
                    const isPercentage = cat.key === "fgPct" || cat.key === "ftPct";
                    const winnerClass =
                      cat.winner === "TEAM"
                        ? "winner-team"
                        : cat.winner === "OPPONENT"
                        ? "winner-opponent"
                        : "winner-tie";
                    return (
                      <tr key={cat.key} className={winnerClass}>
                        <td className="category-name">{categoryLabels[cat.key]}</td>
                        <td>{formatStat(cat.teamTotal, isPercentage)}</td>
                        <td>{formatStat(cat.opponentTotal, isPercentage)}</td>
                        <td>
                          {cat.winner === "TEAM" ? "✓" : cat.winner === "OPPONENT" ? "✗" : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Other Teams Matchup Projections */}
        <Card className="other-teams-projections-card">
          <h2 className="card-title">Other Teams' Matchup Projections</h2>
          <div className="other-teams-projections-content">
            <p className="other-teams-note">
              View weekly projections for other teams in your league.
            </p>
            {loadingOtherTeams ? (
              <div className="other-teams-loading">
                <p style={{ padding: "2rem", textAlign: "center", color: "#666" }}>Loading team projections...</p>
              </div>
            ) : otherTeamsProjections.length > 0 ? (
              <div className="other-teams-list">
                {otherTeamsProjections.map((teamProj) => (
                  <div key={teamProj.teamId} className="other-matchup-card">
                    <div className="other-matchup-header">
                      <div className="other-matchup-teams">
                        <div className="other-matchup-team">
                          {teamProj.avatarUrl ? (
                            <img
                              src={teamProj.avatarUrl}
                              alt={teamProj.teamName}
                              className="other-matchup-avatar"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                                const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = "flex";
                              }}
                            />
                          ) : null}
                          <div
                            className="other-matchup-avatar-fallback"
                            style={{ display: teamProj.avatarUrl ? "none" : "flex" }}
                          >
                            {teamProj.teamName.substring(0, 2).toUpperCase()}
                          </div>
                          <span className="other-matchup-team-name">{teamProj.teamName}</span>
                          {teamProj.matchupCategories && (
                            <div className="other-matchup-team-score">
                              {teamProj.matchupCategories.filter((c) => c.winner === "TEAM").length}
                            </div>
                          )}
                        </div>
                        <div className="other-matchup-vs">VS</div>
                        <div className="other-matchup-team">
                          {teamProj.opponentAvatarUrl ? (
                            <img
                              src={teamProj.opponentAvatarUrl}
                              alt={teamProj.opponentName || "Opponent"}
                              className="other-matchup-avatar"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                                const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = "flex";
                              }}
                            />
                          ) : null}
                          <div
                            className="other-matchup-avatar-fallback"
                            style={{ display: teamProj.opponentAvatarUrl ? "none" : "flex" }}
                          >
                            {teamProj.opponentName ? teamProj.opponentName.substring(0, 2).toUpperCase() : "—"}
                          </div>
                          <span className="other-matchup-team-name">
                            {teamProj.opponentName || "No opponent"}
                          </span>
                          {teamProj.matchupCategories && (
                            <div className="other-matchup-team-score">
                              {teamProj.matchupCategories.filter((c) => c.winner === "OPPONENT").length}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {teamProj.matchupCategories && teamProj.matchupCategories.length > 0 && (
                      <div className="other-matchup-categories">
                        {teamProj.matchupCategories.map((cat) => {
                          const isTeamWinner = cat.winner === "TEAM";
                          const isOpponentWinner = cat.winner === "OPPONENT";
                          return (
                            <div
                              key={cat.key}
                              className={`other-category-box ${
                                isTeamWinner
                                  ? "category-winner-team"
                                  : isOpponentWinner
                                  ? "category-winner-opponent"
                                  : "category-tie"
                              }`}
                              title={`${categoryLabels[cat.key]}: ${isTeamWinner ? teamProj.teamName : isOpponentWinner ? teamProj.opponentName : "Tie"}`}
                            >
                              <div className="category-box-label">{categoryLabels[cat.key]}</div>
                              {isTeamWinner && teamProj.avatarUrl ? (
                                <img
                                  src={teamProj.avatarUrl}
                                  alt={teamProj.teamName}
                                  className="category-box-avatar"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              ) : isOpponentWinner && teamProj.opponentAvatarUrl ? (
                                <img
                                  src={teamProj.opponentAvatarUrl}
                                  alt={teamProj.opponentName || "Opponent"}
                                  className="category-box-avatar"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <div className="category-box-tie">—</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="other-teams-empty">
                <p style={{ padding: "2rem", textAlign: "center", color: "#666" }}>
                  No other teams found in league.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </TopNav>
  );
}
