import { useEffect, useState } from "react";
import TopNav from "../components/TopNav";
import { useActiveContext } from "../hooks/useActiveContext";
import { api, ApiError } from "../lib/api";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import "./Streaming.css";

type StreamingOverview = Awaited<ReturnType<typeof api.getStreamingOverview>>;

const STAT_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'threes', 'fgPct', 'ftPct', 'tov'] as const;
const STAT_LABELS: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK',
  threes: '3PM', fgPct: 'FG%', ftPct: 'FT%', tov: 'TO'
};

// Type for focus categories from weekly projections
type FocusCategory = {
  key: string;
  label: string;
  myValue: number;
  oppValue: number;
  delta: number;
  absDelta: number;
  isPercentage: boolean;
  isFavored: boolean;
  source: "Projected" | "Live" | "Equal";
};

export default function Streaming() {
  const { loading: contextLoading, ctx } = useActiveContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<StreamingOverview | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedDropPlayerId, setSelectedDropPlayerId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [impactData, setImpactData] = useState<any | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [showOnlyPlayingToday, setShowOnlyPlayingToday] = useState(false);
  const [focusCategories, setFocusCategories] = useState<FocusCategory[]>([]);

  // Auto-enable "only playing today" filter when date is selected
  useEffect(() => {
    if (selectedDate) {
      setShowOnlyPlayingToday(true);
    }
  }, [selectedDate]);

  // Load initial data
  useEffect(() => {
    if (contextLoading || !ctx) return;
    
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch both streaming overview and weekly projections in parallel
        const [streamingData, weeklyData] = await Promise.all([
          api.getStreamingOverview(ctx.leagueId, ctx.teamId),
          api.getWeeklyProjections(ctx.leagueId, ctx.teamId).catch(() => null)
        ]);
        
        if (streamingData.status === "error") {
          setError(streamingData.message || "Failed to load streaming data");
          setOverview(null);
        } else {
          setOverview(streamingData);
          // Set initial selected date to today (first day in the period)
          if (streamingData.dailyRecommendations && streamingData.dailyRecommendations.length > 0) {
            setSelectedDate(streamingData.dailyRecommendations[0].dateISO);
            setShowOnlyPlayingToday(true);
          }
        }
        
        // Compute Final Streaming Focus from weekly projections (same logic as WeeklyProjections.tsx)
        if (weeklyData && weeklyData.opponent && weeklyData.matchup) {
          const categoryKeys = ['pts', 'reb', 'ast', 'stl', 'blk', 'threes', 'fgPct', 'ftPct', 'tov'] as const;
          
          // Compute projected contested categories
          const projectedContested: FocusCategory[] = [];
          const liveContested: FocusCategory[] = [];
          
          for (const key of categoryKeys) {
            const myValue = weeklyData.team.projectedTotals[key];
            const oppValue = weeklyData.opponent.projectedTotals[key];
            const isPercentage = key === 'fgPct' || key === 'ftPct';
            const isTurnover = key === 'tov';
            
            let delta: number;
            let absDelta: number;
            if (isPercentage) {
              delta = (myValue - oppValue) * 100;
              absDelta = Math.abs(delta);
            } else {
              delta = myValue - oppValue;
              absDelta = Math.abs(delta);
            }
            
            const isFavored = isTurnover ? myValue < oppValue : myValue > oppValue;
            
            projectedContested.push({
              key,
              label: STAT_LABELS[key],
              myValue,
              oppValue,
              delta,
              absDelta,
              isPercentage,
              isFavored,
              source: "Projected",
            });
          }
          
          // Check for live categories (if available from API)
          const liveCategories = (weeklyData as any).liveCategories;
          if (liveCategories && liveCategories.length > 0) {
            for (const key of categoryKeys) {
              const liveCat = liveCategories.find((c: any) => c.key === key);
              if (!liveCat) continue;
              
              const myValue = liveCat.teamTotal;
              const oppValue = liveCat.opponentTotal;
              const isPercentage = key === 'fgPct' || key === 'ftPct';
              const isTurnover = key === 'tov';
              
              let delta: number;
              let absDelta: number;
              if (isPercentage) {
                delta = (myValue - oppValue) * 100;
                absDelta = Math.abs(delta);
              } else {
                delta = myValue - oppValue;
                absDelta = Math.abs(delta);
              }
              
              const isFavored = isTurnover ? myValue < oppValue : myValue > oppValue;
              
              liveContested.push({
                key,
                label: STAT_LABELS[key],
                myValue,
                oppValue,
                delta,
                absDelta,
                isPercentage,
                isFavored,
                source: "Live",
              });
            }
          }
          
          // Compute Final Streaming Focus (combine projected and live, exclude turnovers)
          const streamableKeys = categoryKeys.filter(k => k !== 'tov');
          const combined = streamableKeys.map((key) => {
            const projectedCat = projectedContested.find(c => c.key === key)!;
            const liveCat = liveContested.find(c => c.key === key);
            
            const projectedDelta = projectedCat.absDelta;
            const liveDelta = liveCat?.absDelta || projectedDelta;
            
            const smallerDelta = Math.min(projectedDelta, liveDelta);
            const source: "Projected" | "Live" | "Equal" = 
              projectedDelta < liveDelta ? "Projected" : 
              projectedDelta > liveDelta ? "Live" : 
              "Equal";
            
            const cat = source === "Live" && liveCat ? liveCat : projectedCat;
            return { ...cat, absDelta: smallerDelta, source };
          });
          
          // Sort by smallest delta (most contested) and take top 4
          combined.sort((a, b) => a.absDelta - b.absDelta);
          setFocusCategories(combined.slice(0, 4));
        }
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Failed to load streaming data");
        }
        setOverview(null);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [ctx, contextLoading]);

  // Auto-select drop candidate if none selected
  useEffect(() => {
    if (selectedPlayerId && !selectedDropPlayerId && overview?.dropCandidates && overview.dropCandidates.length > 0) {
      setSelectedDropPlayerId(overview.dropCandidates[0].playerId);
    }
  }, [selectedPlayerId, selectedDropPlayerId, overview?.dropCandidates]);

  // Fetch real impact when player selection changes
  useEffect(() => {
    if (!ctx || !overview || !selectedPlayerId || !selectedDropPlayerId) {
      setImpactData(null);
      return;
    }

    const fetchImpact = async () => {
      setImpactLoading(true);
      try {
        const teamMeta = (ctx as any).teamMeta || {};
        const opponentTeamId = teamMeta.currentOpponentId;
        
        const impact = await api.calculateStreamingImpact(
          ctx.leagueId,
          ctx.teamId,
          selectedPlayerId,
          selectedDropPlayerId,
          opponentTeamId
        );
        setImpactData(impact);
      } catch (err) {
        console.error("Failed to calculate impact:", err);
        setImpactData(null);
      } finally {
        setImpactLoading(false);
      }
    };

    fetchImpact();
  }, [ctx, overview, selectedPlayerId, selectedDropPlayerId]);

  const formatStatShort = (value: number, key: string): string => {
    if (key === 'fgPct' || key === 'ftPct') {
      return `${(value * 100).toFixed(0)}%`;
    }
    return Math.round(value).toString();
  };

  if (contextLoading || loading) {
    return (
      <TopNav>
        <div className="streaming-v2">
          <Skeleton height="40px" width="300px" />
          <Skeleton height="200px" style={{ marginTop: "1rem" }} />
        </div>
      </TopNav>
    );
  }

  if (error || !overview || overview.status === "error") {
    return (
      <TopNav>
        <div className="streaming-v2">
          <h1 className="page-title">Streaming</h1>
          <ErrorState message={error || overview?.message || "No data available"} />
        </div>
      </TopNav>
    );
  }

  const { meta, targets, dailyRecommendations, freeAgents, matchupSnapshot, dropCandidates } = overview;
  const selectedPlayer = selectedPlayerId ? freeAgents.find(fa => fa.playerId === selectedPlayerId) : null;
  
  // Get recommendations for selected date
  const selectedDayData = selectedDate 
    ? dailyRecommendations?.find(d => d.dateISO === selectedDate)
    : dailyRecommendations?.[0];
  
  // Limit to next 7 days
  const next7Days = dailyRecommendations ? dailyRecommendations.slice(0, 7) : [];
  
  // Filter free agents
  const filteredFreeAgents = freeAgents.filter((fa) => {
    // Name search
    if (!fa.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    
    // Optional date filter
    if (showOnlyPlayingToday && selectedDate && fa.gamesByDay) {
      return fa.gamesByDay[selectedDate] === true;
    }
    
    return true;
  });

  // Get focus category keys for easy lookup
  const focusCatKeys = focusCategories.map(c => c.key);
  
  // Calculate impact display data from real API impact or fallback to simple calculation
  const calculateImpactDisplay = () => {
    if (!selectedPlayer) return null;
    
    // Use real impact data if available
    if (impactData && impactData.status === "ok") {
      const impact: Record<string, { before: number; added: number; after: number; isTarget: boolean; isHelp: boolean; isHurt: boolean; focusCat: FocusCategory | undefined }> = {};
      
      for (const key of STAT_KEYS) {
        const before = impactData.before[key] || 0;
        const after = impactData.after[key] || 0;
        const delta = impactData.deltas[key] || 0;
        const isTarget = focusCatKeys.includes(key);
        const focusCat = focusCategories.find(c => c.key === key);
        
        // Determine if this helps or hurts based on delta
        let isHelp = false;
        let isHurt = false;
        if (key === 'tov') {
          isHelp = delta < -0.5; // Reducing TO is good
          isHurt = delta > 0.5; // Increasing TO is bad
        } else if (key === 'fgPct' || key === 'ftPct') {
          isHelp = delta > 0.005; // +0.5% is good
          isHurt = delta < -0.005; // -0.5% is bad
        } else {
          isHelp = delta > 0;
          isHurt = delta < 0;
        }
        
        impact[key] = { before, added: delta, after, isTarget, isHelp, isHurt, focusCat };
      }
      
      return impact;
    }
    
    // Fallback to simple calculation if no real impact data yet
    if (!matchupSnapshot) return null;
    
    const impact: Record<string, { before: number; added: number; after: number; isTarget: boolean; isHelp: boolean; isHurt: boolean; focusCat: FocusCategory | undefined }> = {};
    
    for (const key of STAT_KEYS) {
      const before = matchupSnapshot.categories.find(c => c.key === key)?.myTotal || 0;
      const added = selectedPlayer.projectedTotals[key] || 0;
      const isPct = key === 'fgPct' || key === 'ftPct';
      const after = isPct ? selectedPlayer.projectedTotals[key] : before + added;
      const isTarget = focusCatKeys.includes(key);
      const focusCat = focusCategories.find(c => c.key === key);
      
      // Determine if this helps or hurts
      let isHelp = false;
      let isHurt = false;
      if (key === 'tov') {
        isHurt = added > 3;
      } else if (key === 'fgPct') {
        isHelp = selectedPlayer.projectedPerGame.fgPct >= 0.48;
        isHurt = selectedPlayer.projectedPerGame.fgPct < 0.42;
      } else if (key === 'ftPct') {
        isHelp = selectedPlayer.projectedPerGame.ftPct >= 0.78;
        isHurt = selectedPlayer.projectedPerGame.ftPct < 0.70;
      } else {
        const threshold = before * 0.08;
        isHelp = added >= threshold;
      }
      
      impact[key] = { before, added, after, isTarget, isHelp, isHurt, focusCat };
    }
    
    return impact;
  };

  const selectedImpact = calculateImpactDisplay();

  return (
    <TopNav>
      <div className="streaming-v2">
        {/* Compact Header */}
        <div className="stream-header">
          <div className="stream-header-top">
            <div className="header-left">
              <h1 className="page-title">Streaming</h1>
              {meta.addsRemaining !== null && (
                <span className="adds-badge">{meta.addsRemaining} adds left</span>
              )}
            </div>
            <div className="header-right">
              <span className="target-label">Focus:</span>
              {focusCategories.length > 0 ? (
                focusCategories.map(cat => (
                  <span key={cat.key} className={`target-pill ${cat.isFavored ? 'favored' : 'behind'}`} title={`${cat.source}: ${cat.isFavored ? 'Ahead' : 'Behind'}`}>
                    {cat.label}
                  </span>
                ))
              ) : targets.contestedCats.length > 0 ? (
                targets.contestedCats.map(cat => (
                  <span key={cat} className="target-pill">{STAT_LABELS[cat] || cat.toUpperCase()}</span>
                ))
              ) : (
                <span className="no-targets">No focus categories</span>
              )}
            </div>
          </div>
          {/* Streaming Explanation Blurb */}
          <div className="streaming-explanation">
            <p>
              <strong>Streaming</strong> is a strategy where you add and drop players throughout the week to maximize games played. 
              Players are ranked by how well they help your <strong>Focus Categories</strong> — the closest contested stats from your Weekly Projections. 
              Select a day to see only players with games that day. Players who hurt FG%/FT% are penalized.
            </p>
          </div>
        </div>

        {/* Final Streaming Focus - From Weekly Projections */}
        {focusCategories.length > 0 && (
          <div className="final-streaming-focus-section">
            <div className="focus-section-header">
              <h2 className="focus-section-title">Focus Categories</h2>
              <span className="focus-section-subtitle">Closest contested categories from Weekly Projections</span>
            </div>
            <div className="focus-chips-row">
              {focusCategories.map((cat) => (
                <div 
                  key={cat.key} 
                  className={`focus-chip ${cat.isFavored ? 'favored' : 'behind'}`}
                >
                  <span className="focus-chip-label">{cat.label}</span>
                  <span className="focus-chip-values">
                    <span className="focus-my-value">{cat.isPercentage ? `${(cat.myValue * 100).toFixed(1)}%` : cat.myValue.toFixed(1)}</span>
                    <span className="focus-vs">vs</span>
                    <span className="focus-opp-value">{cat.isPercentage ? `${(cat.oppValue * 100).toFixed(1)}%` : cat.oppValue.toFixed(1)}</span>
                  </span>
                  <span className={`focus-chip-status ${cat.isFavored ? 'ahead' : 'behind'}`}>
                    {cat.isFavored ? 'AHEAD' : 'BEHIND'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Streaming Suggestion Summary - Main Feature at Top */}
        {next7Days && next7Days.length > 0 && (
          <div className="streaming-summary-section">
            <h2 className="summary-title">Streaming Suggestion Summary</h2>
            <div className="summary-days-grid">
              {next7Days.map((day, dayIndex) => {
                const dayRecs = day.recommendations || [];
                return (
                  <div 
                    key={day.dateISO} 
                    className={`summary-day-card day-card-${dayIndex} ${selectedDate === day.dateISO ? 'active' : ''}`}
                  >
                    <div className="day-card-header">
                      <span className="day-card-label">{day.label.split(',')[0]}</span>
                    </div>
                    {dayRecs.length > 0 ? (
                      <div className="day-card-recs">
                        {dayRecs.slice(0, 2).map((rec, idx) => {
                          const player = freeAgents.find(fa => fa.playerId === rec.addPlayerId);
                          return (
                            <div 
                              key={idx} 
                              className="day-card-rec"
                              onClick={() => setSelectedPlayerId(rec.addPlayerId)}
                            >
                              {player?.headshotUrl ? (
                                <img src={player.headshotUrl} alt="" className="rec-headshot" />
                              ) : (
                                <div className="rec-headshot-placeholder">
                                  {rec.addPlayerName.substring(0, 2)}
                                </div>
                              )}
                              <div className="rec-info">
                                <span className="rec-name">{rec.addPlayerName}</span>
                                {rec.addBoosts.length > 0 && (
                                  <span className="rec-boost-badge">{rec.addBoosts[0]}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="day-card-no-recs">{day.noRecommendationReason || 'No pickups'}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Date Selector Buttons */}
        {next7Days && next7Days.length > 0 && (
          <div className="top-day-selector">
            <div className="top-day-pills">
              {next7Days.map((day) => (
                <button
                  key={day.dateISO}
                  className={`top-day-pill ${selectedDate === day.dateISO ? 'active' : ''}`}
                  onClick={() => setSelectedDate(day.dateISO)}
                >
                  {day.label.split(',')[0]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Main Layout: Impact Panel (Left) + Free Agents (Right) */}
        <div className="stream-main">
          {/* LEFT: Impact Preview - Always Visible */}
          <div className="impact-panel">
            <div className="impact-header">
              <h2>Impact on Your Totals</h2>
            </div>

            {selectedPlayer && selectedImpact ? (
              <>
                <div className="player-quick-info">
                  {selectedPlayer.headshotUrl ? (
                    <img src={selectedPlayer.headshotUrl} alt="" className="impact-headshot" />
                  ) : (
                    <div className="impact-headshot-placeholder">{selectedPlayer.name.substring(0, 2)}</div>
                  )}
                  <div className="impact-player-details">
                    <div className="impact-player-name">{selectedPlayer.name}</div>
                    <div className="impact-player-meta">
                      {selectedPlayer.teamAbbr} • {selectedPlayer.gamesThisWeek} games this week
                    </div>
                    <div className="impact-schedule">{selectedPlayer.scheduleText || 'Schedule TBD'}</div>
                  </div>
                </div>

                {/* Focus Categories Impact - Most Important */}
                {focusCategories.length > 0 && (
                  <div className="focus-impact-section">
                    <div className="focus-impact-header">
                      <span className="focus-impact-title">Focus Categories Impact</span>
                    </div>
                    <div className="focus-impact-grid">
                      {focusCategories.map(cat => {
                        const stat = selectedImpact[cat.key];
                        if (!stat) return null;
                        const isPct = cat.isPercentage;
                        const currentYou = isPct ? (stat.before * 100).toFixed(1) + '%' : stat.before.toFixed(1);
                        const currentOpp = isPct ? (cat.oppValue * 100).toFixed(1) + '%' : cat.oppValue.toFixed(1);
                        const addedValue = isPct ? (stat.added * 100).toFixed(1) + 'pp' : `+${stat.added.toFixed(1)}`;
                        const newValue = isPct ? ((stat.before + stat.added) * 100).toFixed(1) + '%' : stat.after.toFixed(1);
                        const newDiff = isPct ? ((stat.after - cat.oppValue) * 100).toFixed(1) : (stat.after - cat.oppValue).toFixed(1);
                        
                        // Determine if adding this player flips the category
                        const wasAhead = cat.isFavored;
                        const willBeAhead = cat.key === 'tov' 
                          ? stat.after < cat.oppValue 
                          : stat.after > cat.oppValue;
                        const flipped = wasAhead !== willBeAhead;
                        
                        return (
                          <div key={cat.key} className={`focus-impact-card ${willBeAhead ? 'winning' : 'losing'} ${flipped ? 'flipped' : ''}`}>
                            <div className="focus-impact-cat-header">
                              <span className="focus-impact-cat-name">{cat.label}</span>
                              {flipped && (
                                <span className={`flip-badge ${willBeAhead ? 'flip-win' : 'flip-loss'}`}>
                                  {willBeAhead ? 'FLIP' : 'LOSE'}
                                </span>
                              )}
                            </div>
                            <div className="focus-impact-comparison">
                              <div className="focus-impact-you">
                                <span className="label">You</span>
                                <span className="current">{currentYou}</span>
                                <span className={`added ${stat.added >= 0 ? 'positive' : 'negative'}`}>{addedValue}</span>
                                <span className="new-value">{newValue}</span>
                              </div>
                              <div className="focus-impact-vs">vs</div>
                              <div className="focus-impact-opp">
                                <span className="label">Opp</span>
                                <span className="opp-value">{currentOpp}</span>
                              </div>
                            </div>
                            <div className={`focus-impact-result ${willBeAhead ? 'ahead' : 'behind'}`}>
                              {willBeAhead ? `↑ Ahead by ${Math.abs(Number(newDiff)).toFixed(1)}` : `↓ Behind by ${Math.abs(Number(newDiff)).toFixed(1)}`}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}


                {/* Matchup Result Change */}
                {impactData && impactData.matchupResultBefore && impactData.matchupResultAfter && (
                  <div className="matchup-result-change">
                    <div className="matchup-label">Matchup Impact</div>
                    <div className="matchup-comparison">
                      <div className="matchup-before">
                        <span className="matchup-score">
                          {impactData.matchupResultBefore.wins}-{impactData.matchupResultBefore.losses}-{impactData.matchupResultBefore.ties}
                        </span>
                        <span className="matchup-label-sub">Before</span>
                      </div>
                      <span className="matchup-arrow">→</span>
                      <div className="matchup-after">
                        <span className="matchup-score">
                          {impactData.matchupResultAfter.wins}-{impactData.matchupResultAfter.losses}-{impactData.matchupResultAfter.ties}
                        </span>
                        <span className="matchup-label-sub">After</span>
                      </div>
                    </div>
                    {impactData.matchupResultAfter.wins > impactData.matchupResultBefore.wins && (
                      <div className="matchup-improvement">
                        +{impactData.matchupResultAfter.wins - impactData.matchupResultBefore.wins} category win{impactData.matchupResultAfter.wins - impactData.matchupResultBefore.wins > 1 ? 's' : ''}
                      </div>
                    )}
                    {impactData.matchupResultAfter.wins < impactData.matchupResultBefore.wins && (
                      <div className="matchup-decline">
                        -{impactData.matchupResultBefore.wins - impactData.matchupResultAfter.wins} category win{impactData.matchupResultBefore.wins - impactData.matchupResultAfter.wins > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                )}

              </>
            ) : (
              <div className="impact-empty">
                <div className="empty-icon">↑</div>
                <p>Select a free agent to see how they impact your weekly totals</p>
                <p className="empty-hint">Click any player card or recommendation above</p>
              </div>
            )}

            {/* Drop Candidates Below */}
            {dropCandidates && dropCandidates.length > 0 && (
              <div className="drop-candidates-section">
                <h3 className="drop-header">Potential Drop Candidates</h3>
                <p className="drop-explanation">Ranked by roster % — lowest rostered players are safest drops</p>
                <div className="drop-list">
                  {dropCandidates.slice(0, 5).map((drop: any) => {
                    const dropRosterPlayer = overview.roster.find(r => r.playerId === drop.playerId);
                    const rosterPct = drop.rosterPct;
                    
                    // Determine drop tier based on roster%
                    let dropTier: string;
                    let dropLabel: string;
                    if (rosterPct === null || rosterPct === undefined) {
                      dropTier = "unknown";
                      dropLabel = "Unknown";
                    } else if (rosterPct <= 20) {
                      dropTier = "best";
                      dropLabel = "Rare rostered";
                    } else if (rosterPct <= 40) {
                      dropTier = "strong";
                      dropLabel = "Low rostered";
                    } else if (rosterPct <= 60) {
                      dropTier = "possible";
                      dropLabel = "Moderate rostered";
                    } else {
                      dropTier = "risky";
                      dropLabel = "Widely rostered";
                    }
                    
                    return (
                      <div key={drop.playerId} className={`drop-item drop-tier-${dropTier}`}>
                        {dropRosterPlayer?.headshotUrl ? (
                          <img src={dropRosterPlayer.headshotUrl} alt="" className="drop-avatar" />
                        ) : (
                          <div className="drop-avatar-placeholder">{drop.name.substring(0, 2)}</div>
                        )}
                        <div className="drop-info">
                          <div className="drop-name-row">
                            <div className="drop-name">{drop.name}</div>
                            <span className={`drop-tier-badge tier-${dropTier}`}>{dropLabel}</span>
                          </div>
                          <div className="drop-reason">{drop.reason}</div>
                          <div className="drop-meta">
                            {drop.gamesRemaining}g left • Next: {drop.nextGameDate || 'None'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Free Agent Pool */}
          <div className="fa-pool-card">
            <div className="fa-header">
              <h2>Free Agent Pool</h2>
              <div className="fa-filters">
                <input
                  type="text"
                  placeholder="Search players..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="fa-search"
                />
                {selectedDate && selectedDayData && (
                  <button
                    className={`fa-filter-btn ${showOnlyPlayingToday ? 'active' : ''}`}
                    onClick={() => setShowOnlyPlayingToday(!showOnlyPlayingToday)}
                    title="Filter to players playing on selected date"
                  >
                    {showOnlyPlayingToday ? '✓ Showing players playing ' : 'All Players'}
                    {showOnlyPlayingToday && ` ${selectedDayData.label.split(',')[0]}`}
                  </button>
                )}
              </div>
            </div>
            {selectedDate && selectedDayData && showOnlyPlayingToday && (
              <div className="fa-filter-notice">
                Showing only players playing on {selectedDayData.label.split(',')[0]} ({selectedDayData.label.split(',')[1]?.trim()})
              </div>
            )}

            <div className="fa-list">
              {filteredFreeAgents.length === 0 ? (
                <div className="fa-empty">No players found</div>
              ) : (
                filteredFreeAgents.slice(0, 25).map((fa) => {
                  const isSelected = selectedPlayerId === fa.playerId;
                  
                  // Calculate fit based on player's per-game stats vs focus categories
                  // Lower thresholds for free agents (waiver wire players are less productive)
                  const perGame = fa.projectedPerGame || {};
                  
                  // General thresholds for any category contribution
                  const thresholds: Record<string, number> = {
                    pts: 8, reb: 4, ast: 2.5, stl: 0.6, blk: 0.5, threes: 1.0, fgPct: 0.42, ftPct: 0.70, tov: 2.5
                  };
                  
                  let focusHits = 0;
                  let totalFocusScore = 0;
                  
                  // Check how well this player contributes to focus categories
                  if (focusCategories.length > 0) {
                    for (const cat of focusCategories) {
                      const key = cat.key;
                      const playerVal = perGame[key] || 0;
                      const threshold = thresholds[key] || 0;
                      
                      if (key === 'fgPct' || key === 'ftPct') {
                        // For percentages, check if above threshold
                        if (playerVal >= threshold) {
                          focusHits++;
                          totalFocusScore += 25;
                        }
                      } else if (key === 'tov') {
                        // For TO, lower is better - skip (can't stream for lower TO)
                      } else {
                        // For counting stats, check against threshold
                        if (playerVal >= threshold) {
                          focusHits++;
                          totalFocusScore += 25;
                        } else if (playerVal >= threshold * 0.6) {
                          focusHits++; // Still counts as a partial hit
                          totalFocusScore += 10;
                        }
                      }
                    }
                  } else {
                    // No focus categories - evaluate based on overall stats quality
                    const countingKeys = ['pts', 'reb', 'ast', 'stl', 'blk', 'threes'] as const;
                    for (const key of countingKeys) {
                      const playerVal = perGame[key] || 0;
                      const threshold = thresholds[key] || 0;
                      if (playerVal >= threshold) {
                        focusHits++;
                        totalFocusScore += 15;
                      } else if (playerVal >= threshold * 0.6) {
                        totalFocusScore += 5;
                      }
                    }
                  }
                  
                  let fitLabel = '';
                  let fitClass = '';
                  
                  // Determine fit level
                  if (focusCategories.length > 0) {
                    // When we have focus categories, evaluate against those
                    if (focusHits >= 3 || totalFocusScore >= 75) {
                      fitLabel = 'Best Fit';
                      fitClass = 'fit-best';
                    } else if (focusHits >= 2 || totalFocusScore >= 50) {
                      fitLabel = 'Good Fit';
                      fitClass = 'fit-good';
                    } else if (focusHits >= 1 || totalFocusScore >= 20) {
                      fitLabel = 'Fair Fit';
                      fitClass = 'fit-fair';
                    } else {
                      fitLabel = 'Volume';
                      fitClass = 'fit-volume';
                    }
                  } else {
                    // No focus categories - use general quality
                    if (focusHits >= 4 || totalFocusScore >= 60) {
                      fitLabel = 'Best Fit';
                      fitClass = 'fit-best';
                    } else if (focusHits >= 3 || totalFocusScore >= 40) {
                      fitLabel = 'Good Fit';
                      fitClass = 'fit-good';
                    } else if (focusHits >= 2 || totalFocusScore >= 20) {
                      fitLabel = 'Fair Fit';
                      fitClass = 'fit-fair';
                    } else {
                      fitLabel = 'Volume';
                      fitClass = 'fit-volume';
                    }
                  }
                  
                  return (
                    <div
                      key={fa.playerId}
                      className={`fa-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedPlayerId(fa.playerId)}
                    >
                      <div className="fa-card-top">
                        {fa.headshotUrl ? (
                          <img src={fa.headshotUrl} alt="" className="fa-avatar" />
                        ) : (
                          <div className="fa-avatar-placeholder">{fa.name.substring(0, 2)}</div>
                        )}
                        <div className="fa-info">
                          <div className="fa-name-row">
                            <span className="fa-name">{fa.name}</span>
                            {fitLabel && <span className={`fa-fit-badge ${fitClass}`}>{fitLabel}</span>}
                          </div>
                          <div className="fa-meta">
                            {fa.teamAbbr} • {fa.gamesThisWeek}g • {fa.scheduleText || 'TBD'}
                          </div>
                        </div>
                      </div>

                      {/* Full Stats Row */}
                      <div className="fa-stats-grid">
                        {STAT_KEYS.map(key => {
                          const value = fa.projectedPerGame[key];
                          const isTarget = targets.contestedCats.includes(key);
                          const isStrength = fa.strengths?.includes(key);
                          const isWeakness = fa.weaknesses?.includes(key);
                          
                          return (
                            <div 
                              key={key} 
                              className={`fa-stat ${isTarget ? 'target' : ''} ${isStrength ? 'strength' : ''} ${isWeakness ? 'weakness' : ''}`}
                            >
                              <span className="fa-stat-val">{formatStatShort(value, key)}</span>
                              <span className="fa-stat-label">{STAT_LABELS[key]}</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Quick Tags */}
                      {((fa.strengths && fa.strengths.length > 0) || (fa.weaknesses && fa.weaknesses.length > 0)) && (
                        <div className="fa-tags">
                          {fa.strengths?.slice(0, 3).map(s => (
                            <span key={s} className="tag-help">+{STAT_LABELS[s]}</span>
                          ))}
                          {fa.weaknesses?.slice(0, 2).map(w => (
                            <span key={w} className="tag-hurt">-{STAT_LABELS[w]}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>
    </TopNav>
  );
}
