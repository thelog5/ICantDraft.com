import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type PowerRanking } from "../api/client";

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [powerRankings, setPowerRankings] = useState<PowerRanking[]>([]);
  const [leagueName, setLeagueName] = useState<string>("");
  const [leagueId, setLeagueId] = useState<string>("");

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        // Get latest league
        const { leagues } = await api.getLeagues();
        if (leagues.length === 0) {
          setError("No leagues found");
          setLoading(false);
          return;
        }

        const latestLeague = leagues[0];
        setLeagueId(latestLeague.id);
        setLeagueName(latestLeague.name);

        // Get power rankings
        const data = await api.getPowerRankings(latestLeague.id);
        setPowerRankings(data.powerRankings);
        setLeagueName(data.league.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">{error}</div>
      </div>
    );
  }

  const handleRowClick = (teamId: string) => {
    navigate(`/league/${leagueId}/team/${teamId}`);
  };

  return (
    <div className="container">
      <h1>League Dashboard</h1>
      <h2>{leagueName}</h2>

      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Team Name</th>
            <th>Score</th>
            <th>PTS</th>
            <th>REB</th>
            <th>AST</th>
            <th>STL</th>
            <th>BLK</th>
            <th>3PM</th>
            <th>FG%</th>
            <th>FT%</th>
            <th>TOV</th>
          </tr>
        </thead>
        <tbody>
          {powerRankings.map((ranking, index) => (
            <tr
              key={ranking.teamId}
              onClick={() => handleRowClick(ranking.teamId)}
            >
              <td className="rank">{index + 1}</td>
              <td className="team-name">{ranking.teamName}</td>
              <td className="score">
                {ranking.score0to9.toFixed(2)}
              </td>
              <td>{ranking.ranks.pts}</td>
              <td>{ranking.ranks.reb}</td>
              <td>{ranking.ranks.ast}</td>
              <td>{ranking.ranks.stl}</td>
              <td>{ranking.ranks.blk}</td>
              <td>{ranking.ranks.threes}</td>
              <td>{ranking.ranks.fgPct}</td>
              <td>{ranking.ranks.ftPct}</td>
              <td>{ranking.ranks.tov}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

