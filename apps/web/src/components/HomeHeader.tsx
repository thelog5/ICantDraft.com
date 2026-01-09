import { useEffect, useState } from "react";
import { api } from "../lib/api";
import Skeleton from "./Skeleton";
import "./HomeHeader.css";

type HomeHeaderProps = {
  leagueId: string;
  myTeamId: string;
  onRefresh?: () => void;
  refreshing?: boolean;
};

type StandingsData = {
  league: { id: string; name: string };
  standings: Array<{
    teamId: string;
    teamName: string;
    rank: number;
    wins: number;
    losses: number;
    ties: number;
  }>;
};

type MatchupData = {
  ok: boolean;
  reason?: string;
  league?: { id: string; name: string };
  team?: { teamId: string; teamName: string; avatarUrl: string | null };
  opponent?: { teamId: string; teamName: string; avatarUrl: string | null };
  score?: { team: string; opponent: string };
  updatedAt?: string;
};

export default function HomeHeader({ leagueId, myTeamId, onRefresh, refreshing }: HomeHeaderProps) {
  const [loading, setLoading] = useState(true);
  const [standings, setStandings] = useState<StandingsData | null>(null);
  const [matchup, setMatchup] = useState<MatchupData | null>(null);

  useEffect(() => {
    loadData();
  }, [leagueId, myTeamId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [standingsData, matchupData] = await Promise.all([
        api.getStandings(leagueId),
        api.getCurrentMatchup(leagueId, myTeamId),
      ]);
      setStandings(standingsData);
      setMatchup(matchupData);
    } catch (err) {
      console.error("Failed to load header data:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="home-header">
        <div className="home-header-left">
          <Skeleton width="80px" height="80px" style={{ borderRadius: "50%" }} />
          <div className="home-header-text">
            <Skeleton width="200px" height="24px" />
            <Skeleton width="150px" height="18px" style={{ marginTop: "0.5rem" }} />
          </div>
        </div>
        <div className="home-header-right">
          <Skeleton width="120px" height="60px" />
          <Skeleton width="200px" height="60px" />
          <Skeleton width="120px" height="60px" />
        </div>
      </div>
    );
  }

  // Find my team in standings
  const myTeamStanding = standings?.standings.find((s) => s.teamId === myTeamId);
  const myTeamName = myTeamStanding?.teamName || "My Team";
  const myRank = myTeamStanding?.rank || null;
  const myRecord = myTeamStanding
    ? `${myTeamStanding.wins}-${myTeamStanding.losses}${
        myTeamStanding.ties > 0 ? `-${myTeamStanding.ties}` : ""
      }`
    : null;

  // Get team avatar (use directly like WeeklyProjections)
  const teamAvatarUrl = matchup?.team?.avatarUrl || null;
  
  const teamInitials = myTeamName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const totalTeams = standings?.standings.length || 14;
  const rankText = myRank !== null
    ? `${myRank}${getRankSuffix(myRank)} of ${totalTeams}`
    : `— of ${totalTeams}`;


  return (
    <div className="home-header">
      <div className="home-header-left">
        <div className="home-header-avatar">
          {teamAvatarUrl ? (
            <>
              <img
                src={teamAvatarUrl}
                alt={myTeamName}
                className="home-header-avatar-img"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                  const placeholder = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                  if (placeholder) placeholder.style.display = "flex";
                }}
              />
              <div className="home-header-avatar-fallback" style={{ display: "none" }}>
                {teamInitials}
              </div>
            </>
          ) : (
            <div className="home-header-avatar-fallback">
              {teamInitials}
            </div>
          )}
        </div>
        
        <div className="home-header-info">
          <div className="home-header-rank-section">
            <h1 className="home-header-title">{myTeamName}</h1>
            <div className="home-header-details">
              <div className="home-header-subtitle">{standings?.league.name || "Fantasy League"}</div>
              <div className="home-header-record">
                {myRecord} {myRank && `(${rankText})`}
              </div>
            </div>
          </div>
          {onRefresh && (
            <button 
              className="home-header-refresh-btn" 
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh ESPN Data"}
            </button>
          )}
        </div>
      </div>

      <div className="home-header-right">
        {/* Current Matchup Block */}
        <div className="home-header-matchup-block">
          <div className="matchup-block-label">CURRENT MATCHUP</div>
          {matchup?.ok && matchup.opponent && matchup.score ? (
            <div className="matchup-content">
              {/* Opponent Row */}
              <div className="matchup-row">
                <div className="matchup-avatar-wrapper">
                  {matchup.opponent.avatarUrl ? (
                    <>
                      <img
                        src={matchup.opponent.avatarUrl}
                        alt={matchup.opponent.teamName}
                        className="matchup-avatar"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = "flex";
                        }}
                      />
                      <div className="matchup-avatar-fallback" style={{ display: "none" }}>
                        {matchup.opponent.teamName.substring(0, 2).toUpperCase()}
                      </div>
                    </>
                  ) : (
                    <div className="matchup-avatar-fallback">
                      {matchup.opponent.teamName.substring(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="matchup-name">{matchup.opponent.teamName}</div>
                <div className="matchup-score-value">{matchup.score.opponent}</div>
              </div>
              {/* My Team Row */}
              <div className="matchup-row my-team-row">
                <div className="matchup-avatar-wrapper">
                  {teamAvatarUrl ? (
                    <>
                      <img
                        src={teamAvatarUrl}
                        alt={myTeamName}
                        className="matchup-avatar"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = "flex";
                        }}
                      />
                      <div className="matchup-avatar-fallback" style={{ display: "none" }}>
                        {teamInitials}
                      </div>
                    </>
                  ) : (
                    <div className="matchup-avatar-fallback">
                      {teamInitials}
                    </div>
                  )}
                </div>
                <div className="matchup-name">{myTeamName}</div>
                <div className="matchup-score-value my-score-value">{matchup.score.team}</div>
              </div>
            </div>
          ) : (
            <div className="matchup-unavailable">
              {matchup?.reason || "Data unavailable"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getRankSuffix(rank: number): string {
  if (rank === 1) return "st";
  if (rank === 2) return "nd";
  if (rank === 3) return "rd";
  return "th";
}

