import { useEffect, useState } from "react";
import TopNav from "../components/TopNav";
import { useActiveContext } from "../hooks/useActiveContext";
import { api, ApiError } from "../lib/api";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import "./Streaming.css";

type StreamingOverview = Awaited<ReturnType<typeof api.getStreamingOverview>>;
type FreeAgent = StreamingOverview['freeAgents'][0];

const STAT_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'threes', 'fgPct', 'ftPct', 'tov'] as const;
const STAT_LABELS: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK',
  threes: '3PM', fgPct: 'FG%', ftPct: 'FT%', tov: 'TO'
};

export default function Streaming() {
  const { loading: contextLoading, ctx } = useActiveContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<StreamingOverview | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedDropPlayerId, setSelectedDropPlayerId] = useState<string | null>(null);
  const [expandedRecId, setExpandedRecId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [impactData, setImpactData] = useState<any | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [isScheduleExpanded, setIsScheduleExpanded] = useState(false);
  const [showOnlyPlayingToday, setShowOnlyPlayingToday] = useState(false);

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
        const data = await api.getStreamingOverview(ctx.leagueId, ctx.teamId);
        if (data.status === "error") {
          setError(data.message || "Failed to load streaming data");
          setOverview(null);
        } else {
          setOverview(data);
          // Set initial selected date to today (first day in the period)
          if (data.dailyRecommendations && data.dailyRecommendations.length > 0) {
            setSelectedDate(data.dailyRecommendations[0].dateISO);
            setShowOnlyPlayingToday(true);
          }
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

  const formatStat = (value: number, key: string): string => {
    if (key === 'fgPct' || key === 'ftPct') {
      return `${(value * 100).toFixed(1)}%`;
    }
    return value.toFixed(1);
  };

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
          <Skeleton height={40} width={300} />
          <Skeleton height={200} style={{ marginTop: "1rem" }} />
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
  const selectedDrop = selectedDropPlayerId ? overview.roster.find(r => r.playerId === selectedDropPlayerId) : null;
  
  // Get recommendations for selected date
  const selectedDayData = selectedDate 
    ? dailyRecommendations?.find(d => d.dateISO === selectedDate)
    : dailyRecommendations?.[0];
  const selectedDayRecs = selectedDayData?.recommendations || [];
  
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

  // Calculate impact display data from real API impact or fallback to simple calculation
  const calculateImpactDisplay = () => {
    if (!selectedPlayer) return null;
    
    // Use real impact data if available
    if (impactData && impactData.status === "ok") {
      const impact: Record<string, { before: number; added: number; after: number; isTarget: boolean; isHelp: boolean; isHurt: boolean }> = {};
      
      for (const key of STAT_KEYS) {
        const before = impactData.before[key] || 0;
        const after = impactData.after[key] || 0;
        const delta = impactData.deltas[key] || 0;
        const isTarget = targets.contestedCats.includes(key);
        
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
        
        impact[key] = { before, added: delta, after, isTarget, isHelp, isHurt };
      }
      
      return impact;
    }
    
    // Fallback to simple calculation if no real impact data yet
    if (!matchupSnapshot) return null;
    
    const impact: Record<string, { before: number; added: number; after: number; isTarget: boolean; isHelp: boolean; isHurt: boolean }> = {};
    
    for (const key of STAT_KEYS) {
      const before = matchupSnapshot.categories.find(c => c.key === key)?.myTotal || 0;
      const added = selectedPlayer.projectedTotals[key] || 0;
      const isPct = key === 'fgPct' || key === 'ftPct';
      const after = isPct ? selectedPlayer.projectedTotals[key] : before + added;
      const isTarget = targets.contestedCats.includes(key);
      
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
      
      impact[key] = { before, added, after, isTarget, isHelp, isHurt };
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
              <span className="target-label">Target:</span>
              {targets.contestedCats.length > 0 ? (
                targets.contestedCats.map(cat => (
                  <span key={cat} className="target-pill">{STAT_LABELS[cat] || cat.toUpperCase()}</span>
                ))
              ) : (
                <span className="no-targets">No contested categories</span>
              )}
            </div>
          </div>
          {/* Streaming Explanation Blurb */}
          <div className="streaming-explanation">
            <p>
              <strong>Streaming</strong> is a strategy where you add and drop players throughout the week to maximize games played. 
              This page helps you identify the best free agents to pick up on specific days, see how they'll impact your matchup totals, 
              and find potential players to drop. Select a day above to see recommendations for that date, or browse all available free agents below.
            </p>
          </div>
        </div>

        {/* Streaming Suggestion Summary - Main Feature at Top */}
        {next7Days && next7Days.length > 0 && (
          <div className="streaming-summary-section">
            <h2 className="summary-title">📅 Streaming Suggestion Summary</h2>
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
              <h2>📊 Impact on Your Totals</h2>
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
                    <div className="impact-schedule">📅 {selectedPlayer.scheduleText || 'Schedule TBD'}</div>
                  </div>
                </div>

                <div className="impact-table">
                  <div className="impact-table-header">
                    <span>CAT</span>
                    <span>CURRENT</span>
                    <span>+ ADDS</span>
                    <span>= NEW</span>
                  </div>
                  
                  {/* Gains Section */}
                  <div className="impact-section-header gains">GAINS</div>
                  {STAT_KEYS.filter(key => {
                    const stat = selectedImpact[key];
                    const isPct = key === 'fgPct' || key === 'ftPct';
                    const isTov = key === 'tov';
                    if (isTov) return false; // TO is in losses
                    if (isPct) return stat.isHelp;
                    return stat.added > 0 && stat.isHelp;
                  }).map(key => {
                    const stat = selectedImpact[key];
                    const isPct = key === 'fgPct' || key === 'ftPct';
                    
                    return (
                      <div 
                        key={key} 
                        className={`impact-table-row ${stat.isTarget ? 'target' : ''} gains-row`}
                      >
                        <span className="impact-cat">{STAT_LABELS[key]}</span>
                        <span className="impact-current">{formatStat(stat.before, key)}</span>
                        <span className="impact-added positive">
                          {isPct ? formatStat(stat.added, key) : `+${formatStat(stat.added, key)}`}
                        </span>
                        <span className="impact-new">
                          {isPct ? '—' : formatStat(stat.after, key)}
                        </span>
                      </div>
                    );
                  })}
                  
                  {/* Losses Section */}
                  <div className="impact-section-header losses">LOSSES</div>
                  {STAT_KEYS.filter(key => {
                    const stat = selectedImpact[key];
                    const isTov = key === 'tov';
                    if (isTov) return stat.added > 0; // High TO is bad
                    return stat.isHurt;
                  }).map(key => {
                    const stat = selectedImpact[key];
                    const isPct = key === 'fgPct' || key === 'ftPct';
                    const isTov = key === 'tov';
                    
                    return (
                      <div 
                        key={key} 
                        className={`impact-table-row ${stat.isTarget ? 'target' : ''} losses-row`}
                      >
                        <span className="impact-cat">{STAT_LABELS[key]}</span>
                        <span className="impact-current">{formatStat(stat.before, key)}</span>
                        <span className="impact-added negative">
                          {isPct ? formatStat(stat.added, key) : `+${formatStat(stat.added, key)}`}
                        </span>
                        <span className="impact-new">
                          {isPct ? '—' : formatStat(stat.after, key)}
                        </span>
                      </div>
                    );
                  })}
                  
                  {/* Neutral/Other Stats */}
                  {STAT_KEYS.filter(key => {
                    const stat = selectedImpact[key];
                    const isPct = key === 'fgPct' || key === 'ftPct';
                    const isTov = key === 'tov';
                    
                    // Already shown in gains/losses
                    if (stat.isHelp) return false;
                    if (stat.isHurt) return false;
                    if (isTov && stat.added > 0) return false;
                    
                    return true;
                  }).length > 0 && (
                    <>
                      <div className="impact-section-header neutral">OTHER</div>
                      {STAT_KEYS.filter(key => {
                        const stat = selectedImpact[key];
                        const isPct = key === 'fgPct' || key === 'ftPct';
                        const isTov = key === 'tov';
                        
                        if (stat.isHelp) return false;
                        if (stat.isHurt) return false;
                        if (isTov && stat.added > 0) return false;
                        
                        return true;
                      }).map(key => {
                        const stat = selectedImpact[key];
                        const isPct = key === 'fgPct' || key === 'ftPct';
                        const isTov = key === 'tov';
                        
                        return (
                          <div 
                            key={key} 
                            className={`impact-table-row ${stat.isTarget ? 'target' : ''}`}
                          >
                            <span className="impact-cat">{STAT_LABELS[key]}</span>
                            <span className="impact-current">{formatStat(stat.before, key)}</span>
                            <span className={`impact-added ${isTov && stat.added > 0 ? 'negative' : 'positive'}`}>
                              {isPct ? formatStat(stat.added, key) : `+${formatStat(stat.added, key)}`}
                            </span>
                            <span className="impact-new">
                              {isPct ? '—' : formatStat(stat.after, key)}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>

                {/* Matchup Result Change */}
                {impactData && impactData.matchupResultBefore && impactData.matchupResultAfter && (
                  <div className="matchup-result-change">
                    <div className="matchup-label">📊 Matchup Impact</div>
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
                        ✅ +{impactData.matchupResultAfter.wins - impactData.matchupResultBefore.wins} category win{impactData.matchupResultAfter.wins - impactData.matchupResultBefore.wins > 1 ? 's' : ''}!
                      </div>
                    )}
                    {impactData.matchupResultAfter.wins < impactData.matchupResultBefore.wins && (
                      <div className="matchup-decline">
                        ⚠️ -{impactData.matchupResultBefore.wins - impactData.matchupResultAfter.wins} category win{impactData.matchupResultBefore.wins - impactData.matchupResultAfter.wins > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                )}

                <div className="impact-summary">
                  {selectedPlayer.boosts && selectedPlayer.boosts.length > 0 ? (
                    <div className="summary-boosts">
                      <span className="summary-label">✅ Helps {selectedPlayer.boosts.length} target{selectedPlayer.boosts.length > 1 ? 's' : ''}:</span>
                      <div className="summary-pills">
                        {selectedPlayer.boosts.map(b => (
                          <span key={b} className="boost-pill">{STAT_LABELS[b]}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="summary-no-boosts">
                      <span>📈 Volume play - doesn't target contested cats</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="impact-empty">
                <div className="empty-icon">👆</div>
                <p>Select a free agent to see how they impact your weekly totals</p>
                <p className="empty-hint">Click any player card or recommendation above</p>
              </div>
            )}

            {/* Drop Candidates Below */}
            {dropCandidates && dropCandidates.length > 0 && (
              <div className="drop-candidates-section">
                <h3 className="drop-header">💡 Potential Drop Candidates</h3>
                <p className="drop-explanation">Ranked by roster % — lowest rostered players are safest drops</p>
                <div className="drop-list">
                  {dropCandidates.slice(0, 5).map((drop: any, idx) => {
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
              <h2>🏀 Free Agent Pool</h2>
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
                📅 Showing only players playing on {selectedDayData.label.split(',')[0]} ({selectedDayData.label.split(',')[1]?.trim()})
              </div>
            )}

            <div className="fa-list">
              {filteredFreeAgents.length === 0 ? (
                <div className="fa-empty">No players found</div>
              ) : (
                filteredFreeAgents.slice(0, 25).map((fa) => {
                  const isSelected = selectedPlayerId === fa.playerId;
                  
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
                          <div className="fa-name">{fa.name}</div>
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
