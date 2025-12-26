import "./TeamHeader.css";

type TeamHeaderProps = {
  teamName: string;
  leagueName: string;
  avatarUrl?: string | null;
  standings?: {
    rank: number;
    wins: number;
    losses: number;
    ties: number;
  } | null;
  matchup?: {
    opponentName: string | null;
    myCatsWon: number;
    myCatsLost: number;
    myCatsTied: number;
    oppCatsWon: number;
    oppCatsLost: number;
    oppCatsTied: number;
  } | null;
  lastUpdated?: Date;
};

export default function TeamHeader({
  teamName,
  leagueName,
  avatarUrl,
  standings,
  matchup,
  lastUpdated,
}: TeamHeaderProps) {
  // Generate initials from team name as fallback
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatDate = (date?: Date) => {
    if (!date) return "—";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  };

  return (
    <div className="team-header">
      <div className="team-header-left">
        <div className="team-avatar">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={teamName}
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.nextElementSibling?.classList.remove("hidden");
              }}
            />
          ) : null}
          <div className={avatarUrl ? "team-avatar-initials hidden" : "team-avatar-initials"}>
            {getInitials(teamName)}
          </div>
        </div>
        <div className="team-header-info">
          <h1 className="team-header-title">
            <span className="team-header-label">My Team:</span> {teamName}
          </h1>
          <div className="team-header-league">{leagueName}</div>
        </div>
      </div>
      <div className="team-header-right">
        {standings && (
          <div className="team-header-stat">
            <div className="team-header-stat-label">Rank</div>
            <div className="team-header-stat-value">#{standings.rank}</div>
          </div>
        )}
        {matchup ? (
          <div className="team-header-matchup">
            <div className="matchup-label">Current Matchup</div>
            <div className="matchup-scores">
              <div className="matchup-my-team">
                <div className="matchup-team-name-short">You</div>
                <div className="matchup-score-display">
                  {matchup.myCatsWon}–{matchup.myCatsLost}
                  {matchup.myCatsTied > 0 && `–${matchup.myCatsTied}`}
                </div>
              </div>
              <div className="matchup-vs">vs</div>
              <div className="matchup-opponent">
                <div className="matchup-team-name-short">
                  {matchup.opponentName || "Opponent"}
                </div>
                <div className="matchup-score-display">
                  {matchup.oppCatsWon}–{matchup.oppCatsLost}
                  {matchup.oppCatsTied > 0 && `–${matchup.oppCatsTied}`}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="team-header-stat">
            <div className="team-header-stat-label">Current Matchup</div>
            <div className="team-header-stat-value unavailable">Sync needed</div>
          </div>
        )}
        {lastUpdated && (
          <div className="team-header-stat">
            <div className="team-header-stat-label">Last Updated</div>
            <div className="team-header-stat-value">{formatDate(lastUpdated)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

