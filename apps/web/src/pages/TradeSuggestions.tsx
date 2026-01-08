import { useState, useEffect, useMemo } from "react";
import TopNav from "../components/TopNav";
import { useActiveContext } from "../hooks/useActiveContext";
import { api } from "../lib/api";
import Card from "../components/Card";
import "./TradeSuggestions.css";

type PlayerInTrade = {
  playerId: string;
  name: string;
  headshotUrl: string | null;
  status: string;
  perGameStats?: {
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
  weeklyProjectedStats?: {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    threes: number;
    fgPct: number;
    ftPct: number;
    tov: number;
    fgAttempts?: number;
    ftAttempts?: number;
  };
  gp?: number;
  statsSource?: string;
};

type TradeSuggestion = {
  id: string;
  partnerTeam: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  trade: {
    send: Array<PlayerInTrade>;
    receive: Array<PlayerInTrade>;
    type: "1for1" | "2for1" | "2for2";
  };
  impact: {
    my: {
      teamScoreBefore: number;
      teamScoreAfter: number;
      teamScoreDelta: number;
      avgPlacementBefore: number;
      avgPlacementAfter: number;
      avgPlacementDelta: number;
      categoryPercentilesBefore: Record<string, number>;
      categoryPercentilesAfter: Record<string, number>;
      categoryPercentilesDelta: Record<string, number>;
      categoryDetails: Array<{
        category: string;
        totalBefore: number;
        totalAfter: number;
        deltaTotal?: number;
        deltaTotalPct?: number;
        rankBefore: number;
        rankAfter: number;
        rankDelta: number;
        percentileBefore?: number;
        percentileAfter?: number;
        percentileDelta?: number;
      }>;
      grade: string;
      probability: number;
      confidence: number;
    };
    opp: {
      teamScoreBefore: number;
      teamScoreAfter: number;
      teamScoreDelta: number;
      avgPlacementBefore: number;
      avgPlacementAfter: number;
      avgPlacementDelta: number;
      categoryPercentilesBefore: Record<string, number>;
      categoryPercentilesAfter: Record<string, number>;
      categoryPercentilesDelta: Record<string, number>;
      categoryDetails: Array<{
        category: string;
        totalBefore: number;
        totalAfter: number;
        deltaTotal?: number;
        deltaTotalPct?: number;
        rankBefore: number;
        rankAfter: number;
        rankDelta: number;
        percentileBefore?: number;
        percentileAfter?: number;
        percentileDelta?: number;
      }>;
      grade: string;
      probability: number;
      confidence: number;
    };
  };
  summary: {
    myTopGains: Array<{ category: string; delta: number }>;
    myTopLosses: Array<{ category: string; delta: number }>;
    oppTopGains: Array<{ category: string; delta: number }>;
    oppTopLosses: Array<{ category: string; delta: number }>;
  };
  rationaleBullets: string[];
};

const CATEGORY_NAMES: Record<string, string> = {
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

type SortOption = 
  | "myTeamScoreDeltaDesc"
  | "myAvgPlacementDeltaAsc"
  | "myGradeDesc"
  | "myPtsPctDesc"
  | "myRebPctDesc"
  | "myAstPctDesc"
  | "myStlPctDesc"
  | "myBlkPctDesc"
  | "myThreesPctDesc"
  | "myFgPctDesc"
  | "myFtPctDesc"
  | "myTovPctDesc"
  | "myBestGainDesc"
  | "myWorstLossAsc";

export default function TradeSuggestions() {
  const { loading: contextLoading, ctx } = useActiveContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myTeam, setMyTeam] = useState<{ id: string; name: string; avatarUrl: string | null } | null>(null);
  const [suggestions, setSuggestions] = useState<TradeSuggestion[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tradeSize, setTradeSize] = useState<"1for1" | "2for2" | undefined>(undefined);
  const [excludeUntouchables, setExcludeUntouchables] = useState(true);
  const [minOppGrade, setMinOppGrade] = useState("B-");
  const [showQuestionable, setShowQuestionable] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("myTeamScoreDeltaDesc");
  const [, setLeagueTeamsCount] = useState<number>(12);
  const [displayCount, setDisplayCount] = useState(10);

  useEffect(() => {
    if (contextLoading || !ctx) return;

    const fetchSuggestions = async () => {
      try {
        setLoading(true);
        setError(null);
        // Get untouchables from localStorage (if stored)
        const untouchablesStr = localStorage.getItem("icantdraft_untouchables");
        const untouchables = untouchablesStr ? JSON.parse(untouchablesStr) : [];
        
        const data = await api.getTradeSuggestions(ctx.leagueId, ctx.teamId, {
          tradeSize,
          excludeUntouchables,
          minOppGrade,
          showQuestionable,
          untouchables: excludeUntouchables ? untouchables : [],
        });
        
        // Log response for debugging
        console.log("Trade suggestions response:", data);
        
        setMyTeam(data.myTeam);
        // Always set suggestions - don't filter in UI (server already filtered)
        setSuggestions(data.suggestions || []);
        
        // Reset display count when filters change
        setDisplayCount(10);
        
        // Store league teams count
        if (data.leagueTeamsCount) {
          setLeagueTeamsCount(data.leagueTeamsCount);
        }
        
        // Store debug info
        if (data.debug) {
          setDebugInfo(data.debug);
        }
        
        // Set warning if present
        if (data.warning) {
          setWarning(data.warning);
        } else {
          setWarning(null);
        }
        
        // Set error if ok is false
        if (data.ok === false && data.reason) {
          setError(data.reason);
        } else {
          setError(null);
        }
      } catch (err) {
        console.error("Error fetching trade suggestions:", err);
        setError(err instanceof Error ? err.message : "Failed to load trade suggestions");
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestions();
  }, [ctx, tradeSize, excludeUntouchables, minOppGrade, showQuestionable, contextLoading]);

  // Sort suggestions client-side
  const sortedSuggestions = useMemo(() => {
    const sorted = [...suggestions].sort((a, b) => {
      const myA = a.impact.my;
      const myB = b.impact.my;
      
      switch (sortBy) {
        case "myTeamScoreDeltaDesc":
          return myB.teamScoreDelta - myA.teamScoreDelta;
        case "myAvgPlacementDeltaAsc":
          // Lower avg placement is better, so ascending (more negative delta is better)
          return myA.avgPlacementDelta - myB.avgPlacementDelta;
        case "myGradeDesc": {
          const gradeOrder: Record<string, number> = {
            "A+": 10, "A": 9, "A-": 8,
            "B+": 7, "B": 6, "B-": 5,
            "C+": 4, "C": 3, "C-": 2,
            "D": 1, "F": 0
          };
          return (gradeOrder[myB.grade] || 0) - (gradeOrder[myA.grade] || 0);
        }
        case "myBestGainDesc": {
          // Largest positive deltaTotalPct (adjusted for TO)
          const getMaxGain = (impact: typeof myA) => {
            return Math.max(...impact.categoryDetails.map(d => {
              const deltaTotalPct = d.deltaTotalPct ?? 0;
              const effectivePct = d.category === "tov" ? -deltaTotalPct : deltaTotalPct;
              return effectivePct > 0 ? effectivePct : 0;
            }));
          };
          return getMaxGain(myB) - getMaxGain(myA);
        }
        case "myWorstLossAsc": {
          // Largest negative deltaTotalPct (adjusted for TO)
          const getMaxLoss = (impact: typeof myA) => {
            return Math.min(...impact.categoryDetails.map(d => {
              const deltaTotalPct = d.deltaTotalPct ?? 0;
              const effectivePct = d.category === "tov" ? -deltaTotalPct : deltaTotalPct;
              return effectivePct < 0 ? effectivePct : 0;
            }));
          };
          return getMaxLoss(myA) - getMaxLoss(myB); // Ascending (most negative first)
        }
        case "myPtsPctDesc":
        case "myRebPctDesc":
        case "myAstPctDesc":
        case "myStlPctDesc":
        case "myBlkPctDesc":
        case "myThreesPctDesc":
        case "myFgPctDesc":
        case "myFtPctDesc":
        case "myTovPctDesc": {
          // Extract category from sort option (e.g., "myPtsPctDesc" -> "pts")
          const cat = sortBy.replace("my", "").replace("PctDesc", "").toLowerCase();
          const detailA = myA.categoryDetails.find(d => d.category === cat);
          const detailB = myB.categoryDetails.find(d => d.category === cat);
          const deltaA = detailA?.deltaTotalPct ?? 0;
          const deltaB = detailB?.deltaTotalPct ?? 0;
          // For TO, invert: lower TO is better, so negative deltaTotalPct is good
          if (cat === "tov") {
            return deltaA - deltaB; // Inverted: negative delta (lower TO) is better
          }
          return deltaB - deltaA;
        }
        default:
          return 0;
      }
    });
    
    // Debug log
    console.log(`[Trade Sort] Mode: ${sortBy}, First 5 IDs:`, sorted.slice(0, 5).map(s => s.id));
    
    return sorted;
  }, [suggestions, sortBy]);

  // Reset display count when sort changes
  useEffect(() => {
    setDisplayCount(10);
  }, [sortBy]);

  // Get paginated suggestions
  const displayedSuggestions = useMemo(() => {
    return sortedSuggestions.slice(0, displayCount);
  }, [sortedSuggestions, displayCount]);

  const hasMoreTrades = displayCount < sortedSuggestions.length;

  const handleLoadMore = () => {
    setDisplayCount(prev => Math.min(prev + 10, sortedSuggestions.length));
  };

  if (contextLoading || loading) {
    return (
      <TopNav>
        <div className="trade-suggestions-page">
          <div className="loading">Loading trade suggestions...</div>
        </div>
      </TopNav>
    );
  }

  if (error) {
    return (
      <TopNav>
        <div className="trade-suggestions-page">
          <div className="error">{error}</div>
        </div>
      </TopNav>
    );
  }

  return (
    <TopNav>
      <div className="trade-suggestions-page">
        <div className="trade-suggestions-header">
          <div className="my-team-header">
            {myTeam?.avatarUrl && (
              <img src={myTeam.avatarUrl} alt={myTeam.name} className="team-avatar" />
              )}
              <div className="header-text">
                <h1 className="trade-suggestions-title">Trade Suggestions</h1>
                <p className="team-name">{myTeam?.name}</p>
                <p className="trade-suggestions-description">
                  AI-powered trade recommendations based on your team's strengths and weaknesses.
                </p>
              </div>
            </div>
        </div>

        <Card className="filters-card">
          <div className="filters">
            <div className="filter-group">
              <label>Trade Size:</label>
              <div className="filter-buttons">
                <button
                  className={tradeSize === undefined ? "active" : ""}
                  onClick={() => setTradeSize(undefined)}
                >
                  All
                </button>
                <button
                  className={tradeSize === "1for1" ? "active" : ""}
                  onClick={() => setTradeSize("1for1")}
                >
                  1-for-1
                </button>
                <button
                  className={tradeSize === "2for2" ? "active" : ""}
                  onClick={() => setTradeSize("2for2")}
                >
                  2-for-2
                </button>
              </div>
            </div>
            <div className="filter-group">
              <label>
                <input
                  type="checkbox"
                  checked={excludeUntouchables}
                  onChange={(e) => setExcludeUntouchables(e.target.checked)}
                />
                Exclude Untouchables
              </label>
            </div>
            <div className="filter-group">
              <label>Min Opponent Grade:</label>
              <select
                value={minOppGrade}
                onChange={(e) => setMinOppGrade(e.target.value)}
                className="grade-select"
              >
                <option value="C+">C+</option>
                <option value="B-">B-</option>
                <option value="B">B</option>
                <option value="B+">B+</option>
                <option value="A-">A-</option>
                <option value="A">A</option>
              </select>
            </div>
            <div className="filter-group">
              <label>
                <input
                  type="checkbox"
                  checked={showQuestionable}
                  onChange={(e) => setShowQuestionable(e.target.checked)}
                />
                Show Questionable Trades
              </label>
            </div>
            <div className="filter-group">
              <label>Sort By:</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="grade-select"
              >
                <option value="myTeamScoreDeltaDesc">Best for me: Team Score Δ</option>
                <option value="myAvgPlacementDeltaAsc">Best for me: Avg Placement Δ</option>
                <option value="myGradeDesc">Best grades (my grade)</option>
                <option value="myBestGainDesc">My best gain</option>
                <option value="myWorstLossAsc">My worst loss</option>
                <option value="myPtsPctDesc">Biggest gain in: PTS</option>
                <option value="myRebPctDesc">Biggest gain in: REB</option>
                <option value="myAstPctDesc">Biggest gain in: AST</option>
                <option value="myStlPctDesc">Biggest gain in: STL</option>
                <option value="myBlkPctDesc">Biggest gain in: BLK</option>
                <option value="myThreesPctDesc">Biggest gain in: 3PM</option>
                <option value="myFgPctDesc">Biggest gain in: FG%</option>
                <option value="myFtPctDesc">Biggest gain in: FT%</option>
                <option value="myTovPctDesc">Biggest gain in: TO</option>
              </select>
            </div>
          </div>
        </Card>

        {suggestions.length === 0 ? (
          <Card className="trade-suggestions-card-full">
            <div className="trade-suggestions-empty">
              <p className="empty-state-text">
                {error || "No trade suggestions found. Try adjusting filters."}
              </p>
              {debugInfo && (
                <div style={{ marginTop: "1rem" }}>
                  <button
                    onClick={() => setShowDebug(!showDebug)}
                    style={{
                      padding: "0.5rem 1rem",
                      background: "#f0f0f0",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                    }}
                  >
                    {showDebug ? "Hide" : "Show"} Debug Info
                  </button>
                  {showDebug && (
                    <pre
                      style={{
                        marginTop: "1rem",
                        padding: "1rem",
                        background: "#f9f9f9",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        overflow: "auto",
                        maxHeight: "400px",
                      }}
                    >
                      {JSON.stringify(debugInfo, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </Card>
        ) : (
          <>
            {warning && (
              <div style={{ marginBottom: "1rem", background: "#fff3cd", border: "1px solid #ffc107", borderRadius: "4px" }}>
                <div style={{ padding: "0.75rem", color: "#856404" }}>
                  <strong>⚠️ {warning}</strong>
                </div>
              </div>
            )}
            <div className="trade-suggestions-list">
              {displayedSuggestions.map((suggestion) => (
                <TradeCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  expanded={expandedId === suggestion.id}
                  onToggle={() => setExpandedId(expandedId === suggestion.id ? null : suggestion.id)}
                />
              ))}
            </div>
            
            {sortedSuggestions.length > 0 && (
              <div className="trade-pagination-container">
                {hasMoreTrades ? (
                  <button
                    onClick={handleLoadMore}
                    className="load-more-button"
                  >
                    Load More ({sortedSuggestions.length - displayCount} remaining)
                  </button>
                ) : displayedSuggestions.length >= 10 ? (
                  <p className="no-more-trades">
                    No more trades — showing all {sortedSuggestions.length} suggestions
                  </p>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </TopNav>
  );
}

function TradeCard({
  suggestion,
  expanded,
  onToggle,
}: {
  suggestion: TradeSuggestion;
  expanded: boolean;
  onToggle: () => void;
}) {
  const myImpact = suggestion.impact.my;
  const oppImpact = suggestion.impact.opp;
  
  return (
    <Card className="trade-card">
      <div className="trade-card-header-grid">
        <div className="partner-team">
          {suggestion.partnerTeam.avatarUrl && (
            <img
              src={suggestion.partnerTeam.avatarUrl}
              alt={suggestion.partnerTeam.name}
              className="partner-avatar"
            />
          )}
          <div>
            <div className="partner-name">{suggestion.partnerTeam.name}</div>
          </div>
        </div>
        <div className="trade-metrics-row">
          <div className="metric-pill">
            <div className="metric-pill-label">Your Grade</div>
            <div className={`grade-badge grade-${myImpact.grade.replace(/[+-]/g, "")}`}>
              {myImpact.grade}
            </div>
          </div>
          <div className="metric-pill">
            <div className="metric-pill-label">Their Grade</div>
            <div className={`grade-badge grade-${oppImpact.grade.replace(/[+-]/g, "")}`}>
              {oppImpact.grade}
            </div>
          </div>
          <div className="metric-pill" title="Team Score measures your overall fantasy team strength across all 9 categories. Higher is better. A positive delta means the trade improves your team.">
            <div className="metric-pill-label">Team Score Δ</div>
            <div className={`metric-pill-value ${myImpact.teamScoreDelta >= 0 ? "positive" : "negative"}`}>
              {myImpact.teamScoreDelta >= 0 ? "+" : ""}{myImpact.teamScoreDelta.toFixed(2)}
            </div>
          </div>
          <div className="metric-pill" title="Average Placement is your average rank across all 9 categories. Lower is better (1st place = best). A negative delta means you're moving up in the rankings.">
            <div className="metric-pill-label">Avg Placement Δ</div>
            <div className={`metric-pill-value ${myImpact.avgPlacementDelta <= 0 ? "positive" : "negative"}`}>
              {myImpact.avgPlacementDelta <= 0 ? "" : "+"}{myImpact.avgPlacementDelta.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      <div className="trade-players">
        <div className="trade-side">
          <div className="trade-side-label">You Send:</div>
          <div className="players-list">
            {suggestion.trade.send.map((player) => (
              <div key={player.playerId} className="player-item">
                {player.headshotUrl && (
                  <img src={player.headshotUrl} alt={player.name} className="player-headshot" />
                )}
                <div className="player-info">
                  <div className="player-name">{player.name}</div>
                  {player.status !== "ACTIVE" && (
                    <span className={`status-pill ${player.status.toLowerCase()}`}>{player.status}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="trade-arrow">→</div>
        <div className="trade-side">
          <div className="trade-side-label">You Receive:</div>
          <div className="players-list">
            {suggestion.trade.receive.map((player) => (
              <div key={player.playerId} className="player-item">
                {player.headshotUrl && (
                  <img src={player.headshotUrl} alt={player.name} className="player-headshot" />
                )}
                <div className="player-info">
                  <div className="player-name">{player.name}</div>
                  {player.status !== "ACTIVE" && (
                    <span className={`status-pill ${player.status.toLowerCase()}`}>{player.status}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="trade-impact-summary">
        {(() => {
          // Use deltaTotalPct (percent change of totals) from API, not rank-based
          const isPctCategory = (cat: string) => cat === "fgPct" || cat === "ftPct";
          const gains = myImpact.categoryDetails
            .map((detail) => {
              // For TO, invert for classification: higher TO is bad, so negative deltaTotalPct is good
              const deltaTotalPct = detail.deltaTotalPct ?? 0;
              const effectivePct = detail.category === "tov" ? -deltaTotalPct : deltaTotalPct;
              return {
                category: detail.category,
                deltaTotalPct,
                effectivePct
              };
            })
            .filter(item => Math.abs(item.effectivePct) >= 0.1) // Filter out < 0.1% changes
            .filter(item => item.effectivePct > 0) // Only gains
            .sort((a, b) => b.effectivePct - a.effectivePct)
            .slice(0, 3);
          
          const losses = myImpact.categoryDetails
            .map((detail) => {
              const deltaTotalPct = detail.deltaTotalPct ?? 0;
              const effectivePct = detail.category === "tov" ? -deltaTotalPct : deltaTotalPct;
              return {
                category: detail.category,
                deltaTotalPct,
                effectivePct
              };
            })
            .filter(item => Math.abs(item.effectivePct) >= 0.1) // Filter out < 0.1% changes
            .filter(item => item.effectivePct < 0) // Only losses
            .sort((a, b) => a.effectivePct - b.effectivePct)
            .slice(0, 3);
          
          return (
            <>
              {gains.length > 0 && (
                <div className="impact-section">
                  <div className="impact-label">Top Gains:</div>
                  <div className="impact-categories">
                    {gains.map((item) => {
                      const displayValue = isPctCategory(item.category)
                        ? `${item.effectivePct > 0 ? "+" : ""}${item.effectivePct.toFixed(1)}pp`
                        : `${item.effectivePct > 0 ? "+" : ""}${item.effectivePct.toFixed(1)}%`;
                      return (
                        <div key={item.category} className="category-delta-box gain">
                          <span className="category-delta-label">{CATEGORY_NAMES[item.category] || item.category}</span>
                          <span className="category-delta-value">{displayValue}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {losses.length > 0 && (
                <div className="impact-section">
                  <div className="impact-label">Top Losses:</div>
                  <div className="impact-categories">
                    {losses.map((item) => {
                      const displayValue = isPctCategory(item.category)
                        ? `${item.effectivePct.toFixed(1)}pp`
                        : `${item.effectivePct.toFixed(1)}%`;
                      return (
                        <div key={item.category} className="category-delta-box loss">
                          <span className="category-delta-label">{CATEGORY_NAMES[item.category] || item.category}</span>
                          <span className="category-delta-value">{displayValue}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      <button className="expand-button" onClick={onToggle}>
        {expanded ? "Hide Details" : "Show Details"}
      </button>

      {expanded && (
        <div className="trade-details">
          <div className="details-section">
            <h3>Category Rank Impact</h3>
            <div className="category-rank-impact">
              <div className="rank-impact-team">
                <h4>You</h4>
                <div className="rank-impact-chips">
                  {(() => {
                    // Fixed category order for consistency
                    const categoryOrder: Array<keyof typeof CATEGORY_NAMES> = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];
                    
                    // Create a map for quick lookup
                    const detailsMap = new Map(myImpact.categoryDetails.map(d => [d.category, d]));
                    
                    return categoryOrder.map((cat) => {
                      const detail = detailsMap.get(cat);
                      if (!detail) return null;
                      
                      const isTO = cat === "tov";
                      const isPct = cat === "fgPct" || cat === "ftPct";
                      const deltaTotalPct = detail.deltaTotalPct ?? 0;
                      const effectivePct = isTO ? -deltaTotalPct : deltaTotalPct;
                      const isGain = effectivePct >= 0.1;
                      const isLoss = effectivePct <= -0.1;
                      const isNeutral = Math.abs(effectivePct) < 0.1;
                      
                      const displayValue = isNeutral 
                        ? "—"
                        : isPct
                          ? `${isGain ? "+" : ""}${effectivePct.toFixed(1)}pp`
                          : `${isGain ? "+" : ""}${effectivePct.toFixed(1)}%`;
                      
                      return (
                        <div 
                          key={cat} 
                          className={`category-rank-chip ${
                            isGain ? "gain" : isLoss ? "loss" : "neutral"
                          }`}
                        >
                          <span className="chip-category">{CATEGORY_NAMES[cat]}</span>
                          <span className="chip-value">{displayValue}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
              <div className="rank-impact-team">
                <h4>Them</h4>
                <div className="rank-impact-chips">
                  {(() => {
                    // Fixed category order for consistency
                    const categoryOrder: Array<keyof typeof CATEGORY_NAMES> = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];
                    
                    // Create a map for quick lookup
                    const detailsMap = new Map(oppImpact.categoryDetails.map(d => [d.category, d]));
                    
                    return categoryOrder.map((cat) => {
                      const detail = detailsMap.get(cat);
                      if (!detail) return null;
                      
                      const isTO = cat === "tov";
                      const isPct = cat === "fgPct" || cat === "ftPct";
                      const deltaTotalPct = detail.deltaTotalPct ?? 0;
                      const effectivePct = isTO ? -deltaTotalPct : deltaTotalPct;
                      const isGain = effectivePct >= 0.1;
                      const isLoss = effectivePct <= -0.1;
                      const isNeutral = Math.abs(effectivePct) < 0.1;
                      
                      const displayValue = isNeutral 
                        ? "—"
                        : isPct
                          ? `${isGain ? "+" : ""}${effectivePct.toFixed(1)}pp`
                          : `${isGain ? "+" : ""}${effectivePct.toFixed(1)}%`;
                      
                      return (
                        <div 
                          key={cat} 
                          className={`category-rank-chip ${
                            isGain ? "gain" : isLoss ? "loss" : "neutral"
                          }`}
                        >
                          <span className="chip-category">{CATEGORY_NAMES[cat]}</span>
                          <span className="chip-value">{displayValue}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          </div>
          <div className="details-section">
            <h3>Player Comparison</h3>
            <div className="player-comparison-stack">
              <div className="comparison-section">
                <h4>You Send</h4>
                {suggestion.trade.send.map((player) => (
                  <div key={player.playerId} className="player-stat-card">
                    <div className="player-stat-row">
                      {player.headshotUrl && (
                        <img src={player.headshotUrl} alt={player.name} className="player-stat-headshot" />
                      )}
                      <div className="player-stat-name-compact">{player.name}</div>
                      {player.perGameStats && (
                        <div className="player-stat-grid">
                          <div className="stat-column">
                            <div className="stat-label">PTS</div>
                            <div className="stat-value">{player.perGameStats.pts.toFixed(1)}</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">REB</div>
                            <div className="stat-value">{player.perGameStats.reb.toFixed(1)}</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">AST</div>
                            <div className="stat-value">{player.perGameStats.ast.toFixed(1)}</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">STL</div>
                            <div className="stat-value">{player.perGameStats.stl.toFixed(1)}</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">BLK</div>
                            <div className="stat-value">{player.perGameStats.blk.toFixed(1)}</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">3PM</div>
                            <div className="stat-value">{player.perGameStats.threes.toFixed(1)}</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">FG%</div>
                            <div className="stat-value">{(player.perGameStats.fgPct * 100).toFixed(1)}%</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">FT%</div>
                            <div className="stat-value">{(player.perGameStats.ftPct * 100).toFixed(1)}%</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">TO</div>
                            <div className="stat-value">{player.perGameStats.tov.toFixed(1)}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {suggestion.trade.send.length > 1 && (() => {
                  const combined = suggestion.trade.send.reduce((acc, p) => {
                    const stats = p.weeklyProjectedStats || p.perGameStats;
                    if (!stats) return acc;
                    
                    // Use attempts from weeklyProjectedStats if available and > 0
                    // Otherwise estimate: typical NBA player takes ~1.8-2.2 FGA per point, ~0.25-0.35 FTA per point
                    let fgAttempts = p.weeklyProjectedStats?.fgAttempts;
                    if (!fgAttempts || fgAttempts === 0) {
                      // Estimate FGA: points / (FG% * typical points per FGA)
                      // Average NBA player scores ~1.2 points per FGA, so FGA ≈ points / 1.2
                      fgAttempts = stats.pts / 1.2;
                    }
                    
                    let ftAttempts = p.weeklyProjectedStats?.ftAttempts;
                    if (!ftAttempts || ftAttempts === 0) {
                      // Estimate FTA: typically 0.3-0.4x points for most players
                      ftAttempts = stats.pts * 0.35;
                    }
                    
                    return {
                      pts: acc.pts + stats.pts,
                      reb: acc.reb + stats.reb,
                      ast: acc.ast + stats.ast,
                      stl: acc.stl + stats.stl,
                      blk: acc.blk + stats.blk,
                      threes: acc.threes + stats.threes,
                      tov: acc.tov + stats.tov,
                      fgAttempts: acc.fgAttempts + fgAttempts,
                      fgMakes: acc.fgMakes + (fgAttempts * stats.fgPct),
                      ftAttempts: acc.ftAttempts + ftAttempts,
                      ftMakes: acc.ftMakes + (ftAttempts * stats.ftPct),
                    };
                  }, { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, tov: 0, fgAttempts: 0, fgMakes: 0, ftAttempts: 0, ftMakes: 0 });
                  const fgPct = combined.fgAttempts > 0 ? combined.fgMakes / combined.fgAttempts : 0;
                  const ftPct = combined.ftAttempts > 0 ? combined.ftMakes / combined.ftAttempts : 0;
                  return (
                    <div className="player-stat-card combined-card">
                      <div className="player-stat-row">
                        <div className="player-stat-headshot-placeholder"></div>
                        <div className="player-stat-name-compact">Combined Total</div>
                        <div className="player-stat-grid">
                        <div className="stat-column">
                          <div className="stat-label">PTS</div>
                          <div className="stat-value">{combined.pts.toFixed(1)}</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">REB</div>
                          <div className="stat-value">{combined.reb.toFixed(1)}</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">AST</div>
                          <div className="stat-value">{combined.ast.toFixed(1)}</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">STL</div>
                          <div className="stat-value">{combined.stl.toFixed(1)}</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">BLK</div>
                          <div className="stat-value">{combined.blk.toFixed(1)}</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">3PM</div>
                          <div className="stat-value">{combined.threes.toFixed(1)}</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">FG%</div>
                          <div className="stat-value">{(fgPct * 100).toFixed(1)}%</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">FT%</div>
                          <div className="stat-value">{(ftPct * 100).toFixed(1)}%</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">TO</div>
                          <div className="stat-value">{combined.tov.toFixed(1)}</div>
                        </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              
              <div className="comparison-section">
                <h4>You Receive</h4>
                {suggestion.trade.receive.map((player) => (
                  <div key={player.playerId} className="player-stat-card">
                    <div className="player-stat-row">
                      {player.headshotUrl && (
                        <img src={player.headshotUrl} alt={player.name} className="player-stat-headshot" />
                      )}
                      <div className="player-stat-name-compact">{player.name}</div>
                      {player.perGameStats && (
                        <div className="player-stat-grid">
                          <div className="stat-column">
                            <div className="stat-label">PTS</div>
                            <div className="stat-value">{player.perGameStats.pts.toFixed(1)}</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">REB</div>
                            <div className="stat-value">{player.perGameStats.reb.toFixed(1)}</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">AST</div>
                            <div className="stat-value">{player.perGameStats.ast.toFixed(1)}</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">STL</div>
                            <div className="stat-value">{player.perGameStats.stl.toFixed(1)}</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">BLK</div>
                            <div className="stat-value">{player.perGameStats.blk.toFixed(1)}</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">3PM</div>
                            <div className="stat-value">{player.perGameStats.threes.toFixed(1)}</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">FG%</div>
                            <div className="stat-value">{(player.perGameStats.fgPct * 100).toFixed(1)}%</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">FT%</div>
                            <div className="stat-value">{(player.perGameStats.ftPct * 100).toFixed(1)}%</div>
                          </div>
                          <div className="stat-column">
                            <div className="stat-label">TO</div>
                            <div className="stat-value">{player.perGameStats.tov.toFixed(1)}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {suggestion.trade.receive.length > 1 && (() => {
                  const combined = suggestion.trade.receive.reduce((acc, p) => {
                    const stats = p.weeklyProjectedStats || p.perGameStats;
                    if (!stats) return acc;
                    
                    // Use attempts from weeklyProjectedStats if available and > 0
                    // Otherwise estimate: typical NBA player takes ~1.8-2.2 FGA per point, ~0.25-0.35 FTA per point
                    let fgAttempts = p.weeklyProjectedStats?.fgAttempts;
                    if (!fgAttempts || fgAttempts === 0) {
                      // Estimate FGA: points / (FG% * typical points per FGA)
                      // Average NBA player scores ~1.2 points per FGA, so FGA ≈ points / 1.2
                      fgAttempts = stats.pts / 1.2;
                    }
                    
                    let ftAttempts = p.weeklyProjectedStats?.ftAttempts;
                    if (!ftAttempts || ftAttempts === 0) {
                      // Estimate FTA: typically 0.3-0.4x points for most players
                      ftAttempts = stats.pts * 0.35;
                    }
                    
                    return {
                      pts: acc.pts + stats.pts,
                      reb: acc.reb + stats.reb,
                      ast: acc.ast + stats.ast,
                      stl: acc.stl + stats.stl,
                      blk: acc.blk + stats.blk,
                      threes: acc.threes + stats.threes,
                      tov: acc.tov + stats.tov,
                      fgAttempts: acc.fgAttempts + fgAttempts,
                      fgMakes: acc.fgMakes + (fgAttempts * stats.fgPct),
                      ftAttempts: acc.ftAttempts + ftAttempts,
                      ftMakes: acc.ftMakes + (ftAttempts * stats.ftPct),
                    };
                  }, { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, tov: 0, fgAttempts: 0, fgMakes: 0, ftAttempts: 0, ftMakes: 0 });
                  const fgPct = combined.fgAttempts > 0 ? combined.fgMakes / combined.fgAttempts : 0;
                  const ftPct = combined.ftAttempts > 0 ? combined.ftMakes / combined.ftAttempts : 0;
                  return (
                    <div className="player-stat-card combined-card">
                      <div className="player-stat-row">
                        <div className="player-stat-headshot-placeholder"></div>
                        <div className="player-stat-name-compact">Combined Total</div>
                        <div className="player-stat-grid">
                        <div className="stat-column">
                          <div className="stat-label">PTS</div>
                          <div className="stat-value">{combined.pts.toFixed(1)}</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">REB</div>
                          <div className="stat-value">{combined.reb.toFixed(1)}</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">AST</div>
                          <div className="stat-value">{combined.ast.toFixed(1)}</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">STL</div>
                          <div className="stat-value">{combined.stl.toFixed(1)}</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">BLK</div>
                          <div className="stat-value">{combined.blk.toFixed(1)}</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">3PM</div>
                          <div className="stat-value">{combined.threes.toFixed(1)}</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">FG%</div>
                          <div className="stat-value">{(fgPct * 100).toFixed(1)}%</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">FT%</div>
                          <div className="stat-value">{(ftPct * 100).toFixed(1)}%</div>
                        </div>
                        <div className="stat-column">
                          <div className="stat-label">TO</div>
                          <div className="stat-value">{combined.tov.toFixed(1)}</div>
                        </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
            
            {(() => {
              const sendCombined = suggestion.trade.send.reduce((acc, p) => {
                const stats = p.weeklyProjectedStats || p.perGameStats;
                if (!stats) return acc;
                
                let fgAttempts = p.weeklyProjectedStats?.fgAttempts;
                if (!fgAttempts || fgAttempts === 0) {
                  fgAttempts = stats.pts / 1.2;
                }
                
                let ftAttempts = p.weeklyProjectedStats?.ftAttempts;
                if (!ftAttempts || ftAttempts === 0) {
                  ftAttempts = stats.pts * 0.35;
                }
                
                return {
                  pts: acc.pts + stats.pts,
                  reb: acc.reb + stats.reb,
                  ast: acc.ast + stats.ast,
                  stl: acc.stl + stats.stl,
                  blk: acc.blk + stats.blk,
                  threes: acc.threes + stats.threes,
                  tov: acc.tov + stats.tov,
                  fgAttempts: acc.fgAttempts + fgAttempts,
                  fgMakes: acc.fgMakes + (fgAttempts * stats.fgPct),
                  ftAttempts: acc.ftAttempts + ftAttempts,
                  ftMakes: acc.ftMakes + (ftAttempts * stats.ftPct),
                };
              }, { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, tov: 0, fgAttempts: 0, fgMakes: 0, ftAttempts: 0, ftMakes: 0 });
              
              const recvCombined = suggestion.trade.receive.reduce((acc, p) => {
                const stats = p.weeklyProjectedStats || p.perGameStats;
                if (!stats) return acc;
                
                let fgAttempts = p.weeklyProjectedStats?.fgAttempts;
                if (!fgAttempts || fgAttempts === 0) {
                  fgAttempts = stats.pts / 1.2;
                }
                
                let ftAttempts = p.weeklyProjectedStats?.ftAttempts;
                if (!ftAttempts || ftAttempts === 0) {
                  ftAttempts = stats.pts * 0.35;
                }
                
                return {
                  pts: acc.pts + stats.pts,
                  reb: acc.reb + stats.reb,
                  ast: acc.ast + stats.ast,
                  stl: acc.stl + stats.stl,
                  blk: acc.blk + stats.blk,
                  threes: acc.threes + stats.threes,
                  tov: acc.tov + stats.tov,
                  fgAttempts: acc.fgAttempts + fgAttempts,
                  fgMakes: acc.fgMakes + (fgAttempts * stats.fgPct),
                  ftAttempts: acc.ftAttempts + ftAttempts,
                  ftMakes: acc.ftMakes + (ftAttempts * stats.ftPct),
                };
              }, { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, tov: 0, fgAttempts: 0, fgMakes: 0, ftAttempts: 0, ftMakes: 0 });
              
              const sendFgPct = sendCombined.fgAttempts > 0 ? sendCombined.fgMakes / sendCombined.fgAttempts : 0;
              const sendFtPct = sendCombined.ftAttempts > 0 ? sendCombined.ftMakes / sendCombined.ftAttempts : 0;
              const recvFgPct = recvCombined.fgAttempts > 0 ? recvCombined.fgMakes / recvCombined.fgAttempts : 0;
              const recvFtPct = recvCombined.ftAttempts > 0 ? recvCombined.ftMakes / recvCombined.ftAttempts : 0;
              
              return (
                <div className="net-delta-card">
                  <h5>Net Gain / Loss</h5>
                  <div className="net-delta-grid">
                    <div className="net-stat-column">
                      <div className="net-stat-label">PTS</div>
                      <div className={`net-stat-value ${recvCombined.pts - sendCombined.pts >= 0 ? "positive" : "negative"}`}>
                        {recvCombined.pts - sendCombined.pts >= 0 ? "+" : ""}{(recvCombined.pts - sendCombined.pts).toFixed(1)}
                      </div>
                    </div>
                    <div className="net-stat-column">
                      <div className="net-stat-label">REB</div>
                      <div className={`net-stat-value ${recvCombined.reb - sendCombined.reb >= 0 ? "positive" : "negative"}`}>
                        {recvCombined.reb - sendCombined.reb >= 0 ? "+" : ""}{(recvCombined.reb - sendCombined.reb).toFixed(1)}
                      </div>
                    </div>
                    <div className="net-stat-column">
                      <div className="net-stat-label">AST</div>
                      <div className={`net-stat-value ${recvCombined.ast - sendCombined.ast >= 0 ? "positive" : "negative"}`}>
                        {recvCombined.ast - sendCombined.ast >= 0 ? "+" : ""}{(recvCombined.ast - sendCombined.ast).toFixed(1)}
                      </div>
                    </div>
                    <div className="net-stat-column">
                      <div className="net-stat-label">STL</div>
                      <div className={`net-stat-value ${recvCombined.stl - sendCombined.stl >= 0 ? "positive" : "negative"}`}>
                        {recvCombined.stl - sendCombined.stl >= 0 ? "+" : ""}{(recvCombined.stl - sendCombined.stl).toFixed(1)}
                      </div>
                    </div>
                    <div className="net-stat-column">
                      <div className="net-stat-label">BLK</div>
                      <div className={`net-stat-value ${recvCombined.blk - sendCombined.blk >= 0 ? "positive" : "negative"}`}>
                        {recvCombined.blk - sendCombined.blk >= 0 ? "+" : ""}{(recvCombined.blk - sendCombined.blk).toFixed(1)}
                      </div>
                    </div>
                    <div className="net-stat-column">
                      <div className="net-stat-label">3PM</div>
                      <div className={`net-stat-value ${recvCombined.threes - sendCombined.threes >= 0 ? "positive" : "negative"}`}>
                        {recvCombined.threes - sendCombined.threes >= 0 ? "+" : ""}{(recvCombined.threes - sendCombined.threes).toFixed(1)}
                      </div>
                    </div>
                    <div className="net-stat-column">
                      <div className="net-stat-label">FG%</div>
                      <div className={`net-stat-value ${(recvFgPct - sendFgPct) >= 0 ? "positive" : "negative"}`}>
                        {(recvFgPct - sendFgPct) >= 0 ? "+" : ""}{((recvFgPct - sendFgPct) * 100).toFixed(1)}pp
                      </div>
                    </div>
                    <div className="net-stat-column">
                      <div className="net-stat-label">FT%</div>
                      <div className={`net-stat-value ${(recvFtPct - sendFtPct) >= 0 ? "positive" : "negative"}`}>
                        {(recvFtPct - sendFtPct) >= 0 ? "+" : ""}{((recvFtPct - sendFtPct) * 100).toFixed(1)}pp
                      </div>
                    </div>
                    <div className="net-stat-column">
                      <div className="net-stat-label">TO</div>
                      <div className={`net-stat-value ${sendCombined.tov - recvCombined.tov >= 0 ? "positive" : "negative"}`}>
                        {sendCombined.tov - recvCombined.tov >= 0 ? "+" : ""}{(sendCombined.tov - recvCombined.tov).toFixed(1)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="details-section">
            <h3>Category Totals & Rank Changes</h3>
            <div className="category-details-grid">
              <div className="category-details-column">
                <h4>You</h4>
                <div className="category-details-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>New Total</th>
                        <th>Δ Total</th>
                        <th>% Δ Total</th>
                        <th>New Rank</th>
                        <th>Rank Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myImpact.categoryDetails.map((detail) => {
                        const isPct = detail.category === "fgPct" || detail.category === "ftPct";
                        const deltaTotal = detail.deltaTotal ?? (detail.totalAfter - detail.totalBefore);
                        const deltaTotalPct = detail.deltaTotalPct ?? (isPct ? deltaTotal * 100 : (detail.totalBefore !== 0 ? (deltaTotal / detail.totalBefore) * 100 : 0));
                        const isTO = detail.category === "tov";
                        const adjustedDeltaPct = isTO ? -deltaTotalPct : deltaTotalPct;
                        const isGain = adjustedDeltaPct > 0;
                        
                        return (
                          <tr key={detail.category}>
                            <td>{CATEGORY_NAMES[detail.category] || detail.category}</td>
                            <td>
                              {isPct
                                ? (detail.totalAfter * 100).toFixed(1) + "%"
                                : detail.totalAfter.toFixed(1)}
                            </td>
                            <td className={deltaTotal >= 0 ? "positive" : "negative"}>
                              {deltaTotal >= 0 ? "+" : ""}
                              {isPct
                                ? (deltaTotal * 100).toFixed(1) + "pp"
                                : deltaTotal.toFixed(1)}
                            </td>
                            <td className={isGain ? "positive" : adjustedDeltaPct < 0 ? "negative" : ""}>
                              {isPct ? "—" : (
                                <>
                                  {adjustedDeltaPct > 0 ? "+" : ""}
                                  {adjustedDeltaPct.toFixed(1)}%
                                </>
                              )}
                            </td>
                            <td>{detail.rankAfter}</td>
                            <td className={detail.rankDelta <= 0 ? "positive" : "negative"}>
                              {detail.rankDelta <= 0 ? "" : "+"}
                              {detail.rankDelta}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="category-details-column">
                <h4>Them</h4>
                <div className="category-details-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>New Total</th>
                        <th>Δ Total</th>
                        <th>% Δ Total</th>
                        <th>New Rank</th>
                        <th>Rank Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {oppImpact.categoryDetails.map((detail) => {
                        const isPct = detail.category === "fgPct" || detail.category === "ftPct";
                        const deltaTotal = detail.deltaTotal ?? (detail.totalAfter - detail.totalBefore);
                        const deltaTotalPct = detail.deltaTotalPct ?? (isPct ? deltaTotal * 100 : (detail.totalBefore !== 0 ? (deltaTotal / detail.totalBefore) * 100 : 0));
                        const isTO = detail.category === "tov";
                        const adjustedDeltaPct = isTO ? -deltaTotalPct : deltaTotalPct;
                        const isGain = adjustedDeltaPct > 0;
                        
                        return (
                          <tr key={detail.category}>
                            <td>{CATEGORY_NAMES[detail.category] || detail.category}</td>
                            <td>
                              {isPct
                                ? (detail.totalAfter * 100).toFixed(1) + "%"
                                : detail.totalAfter.toFixed(1)}
                            </td>
                            <td className={deltaTotal >= 0 ? "positive" : "negative"}>
                              {deltaTotal >= 0 ? "+" : ""}
                              {isPct
                                ? (deltaTotal * 100).toFixed(1) + "pp"
                                : deltaTotal.toFixed(1)}
                            </td>
                            <td className={isGain ? "positive" : adjustedDeltaPct < 0 ? "negative" : ""}>
                              {isPct ? "—" : (
                                <>
                                  {adjustedDeltaPct > 0 ? "+" : ""}
                                  {adjustedDeltaPct.toFixed(1)}%
                                </>
                              )}
                            </td>
                            <td>{detail.rankAfter}</td>
                            <td className={detail.rankDelta <= 0 ? "positive" : "negative"}>
                              {detail.rankDelta <= 0 ? "" : "+"}
                              {detail.rankDelta}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="details-section">
            <h3>Average Placement Impact</h3>
            <div className="avg-placement-details">
              <div className="avg-placement-team">
                <h4>You</h4>
                <div className="avg-placement-stats">
                  <div className="avg-placement-item">
                    <span className="avg-placement-label">Before:</span>
                    <span className="avg-placement-value">{myImpact.avgPlacementBefore.toFixed(1)}</span>
                  </div>
                  <div className="avg-placement-arrow">→</div>
                  <div className="avg-placement-item">
                    <span className="avg-placement-label">After:</span>
                    <span className="avg-placement-value">{myImpact.avgPlacementAfter.toFixed(1)}</span>
                  </div>
                  <div className="avg-placement-item delta">
                    <span className="avg-placement-label">Change:</span>
                    <span className={`avg-placement-delta ${myImpact.avgPlacementDelta <= 0 ? "positive" : "negative"}`}>
                      {myImpact.avgPlacementDelta <= 0 ? "" : "+"}
                      {myImpact.avgPlacementDelta.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="avg-placement-team">
                <h4>Them</h4>
                <div className="avg-placement-stats">
                  <div className="avg-placement-item">
                    <span className="avg-placement-label">Before:</span>
                    <span className="avg-placement-value">{oppImpact.avgPlacementBefore.toFixed(1)}</span>
                  </div>
                  <div className="avg-placement-arrow">→</div>
                  <div className="avg-placement-item">
                    <span className="avg-placement-label">After:</span>
                    <span className="avg-placement-value">{oppImpact.avgPlacementAfter.toFixed(1)}</span>
                  </div>
                  <div className="avg-placement-item delta">
                    <span className="avg-placement-label">Change:</span>
                    <span className={`avg-placement-delta ${oppImpact.avgPlacementDelta <= 0 ? "positive" : "negative"}`}>
                      {oppImpact.avgPlacementDelta <= 0 ? "" : "+"}
                      {oppImpact.avgPlacementDelta.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="details-section">
            <h3>Why This Trade Helps</h3>
            <ul className="rationale-list">
              {suggestion.rationaleBullets.map((bullet, idx) => (
                <li key={idx}>{bullet}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
