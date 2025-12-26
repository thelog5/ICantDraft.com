import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import SidebarLayout, { getStoredLeagueId, getStoredMyTeamId } from "../components/SidebarLayout";
import { api, PowerRanking, ApiError } from "../lib/api";
import Card from "../components/Card";
import Table from "../components/Table";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import "./Rankings.css";

export default function Rankings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [powerRankings, setPowerRankings] = useState<PowerRanking[]>([]);
  const [leagueName, setLeagueName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCategoryRanks, setShowCategoryRanks] = useState(false);
  const leagueId = getStoredLeagueId();
  const myTeamId = getStoredMyTeamId();

  useEffect(() => {
    if (!leagueId || !myTeamId) {
      navigate("/");
      return;
    }

    loadData();
  }, [leagueId, myTeamId, navigate]);

  const loadData = async () => {
    if (!leagueId) return;

    setLoading(true);
    setError(null);

    try {
      const data = await api.getPowerRankings(leagueId);
      setPowerRankings(data.powerRankings);
      setLeagueName(data.league.name);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load rankings");
      }
    } finally {
      setLoading(false);
    }
  };

  const filteredRankings = powerRankings.filter((r) =>
    r.teamName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <SidebarLayout leagueId={leagueId || undefined} leagueName={leagueName}>
        <div className="rankings">
          <Skeleton height="400px" width="100%" />
        </div>
      </SidebarLayout>
    );
  }

  if (error) {
    return (
      <SidebarLayout leagueId={leagueId || undefined} leagueName={leagueName} onRefresh={loadData}>
        <div className="rankings">
          <ErrorState message={error} onRetry={loadData} />
        </div>
      </SidebarLayout>
    );
  }

  return (
    <SidebarLayout leagueId={leagueId || undefined} leagueName={leagueName} onRefresh={loadData}>
      <div className="rankings">
        <div className="rankings-header">
          <h1 className="rankings-title">League Rankings</h1>
          <div className="rankings-controls">
            <input
              type="text"
              placeholder="Search teams..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rankings-search"
            />
            <label className="rankings-toggle">
              <input
                type="checkbox"
                checked={showCategoryRanks}
                onChange={(e) => setShowCategoryRanks(e.target.checked)}
              />
              Show category ranks
            </label>
          </div>
        </div>

        <Card className="rankings-card">
          <Table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Team</th>
                <th>Score</th>
                {showCategoryRanks && (
                  <>
                    <th>PTS</th>
                    <th>REB</th>
                    <th>AST</th>
                    <th>STL</th>
                    <th>BLK</th>
                    <th>3PM</th>
                    <th>FG%</th>
                    <th>FT%</th>
                    <th>TOV</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredRankings.map((ranking, index) => {
                const isMyTeam = ranking.teamId === myTeamId;
                return (
                  <tr key={ranking.teamId} className={isMyTeam ? "my-team-row" : ""}>
                    <td className="font-bold">{index + 1}</td>
                    <td className="font-bold">{ranking.teamName}</td>
                    <td className="font-mono font-bold">{ranking.score0to9.toFixed(2)}</td>
                    {showCategoryRanks && (
                      <>
                        <td>{ranking.ranks.pts}</td>
                        <td>{ranking.ranks.reb}</td>
                        <td>{ranking.ranks.ast}</td>
                        <td>{ranking.ranks.stl}</td>
                        <td>{ranking.ranks.blk}</td>
                        <td>{ranking.ranks.threes}</td>
                        <td>{ranking.ranks.fgPct}</td>
                    <td>{ranking.ranks.ftPct}</td>
                    <td>{ranking.ranks.tov}</td>
                  </>
                )}
              </tr>
            );
          })}
            </tbody>
          </Table>
        </Card>
      </div>
    </SidebarLayout>
  );
}

