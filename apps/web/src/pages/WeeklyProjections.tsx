import { useEffect, useState } from "react";
import TopNav from "../components/TopNav";
import { useActiveContext } from "../hooks/useActiveContext";
import { api, TeamProfileResponse, ApiError } from "../lib/api";
import Card from "../components/Card";
import WeeklyBarChart from "../components/WeeklyBarChart";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import "./WeeklyProjections.css";

export default function WeeklyProjections() {
  const { loading: contextLoading, ctx } = useActiveContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(1);

  useEffect(() => {
    if (contextLoading || !ctx) return;
    loadData();
  }, [ctx, contextLoading]);

  const loadData = async () => {
    if (!ctx) return;

    setLoading(true);
    setError(null);

    try {
      const profileData = await api.getTeamProfile(ctx.leagueId, ctx.teamId);
      setProfile(profileData);
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

  if (!profile) {
    return (
      <TopNav>
        <div className="weekly-projections-page">
          <ErrorState message="No team profile found" onRetry={loadData} />
        </div>
      </TopNav>
    );
  }

  const categoryKeys = ["pts", "reb", "ast", "stl", "blk", "tov"];
  const categoryLabels: Record<string, string> = {
    pts: "PTS",
    reb: "REB",
    ast: "AST",
    stl: "STL",
    blk: "BLK",
    tov: "TO",
  };

  const weeklyData = categoryKeys.map((key) => {
    const myValue = profile.profile.rawTotals[key as keyof typeof profile.profile.rawTotals];
    const leagueAvg = profile.leagueAverage[key as keyof typeof profile.leagueAverage];
    const opponentValue = leagueAvg * 0.95;
    return {
      category: categoryLabels[key],
      myTeam: myValue,
      opponent: opponentValue,
      leagueAvg: leagueAvg,
    };
  });

  return (
    <TopNav>
      <div className="weekly-projections-page">
        <div className="weekly-projections-header">
          <h1 className="weekly-projections-title">Weekly Projections</h1>
          <div className="weekly-projections-controls">
            <label className="week-selector-label">
              Week:
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(Number(e.target.value))}
                className="week-selector"
              >
                {Array.from({ length: 20 }, (_, i) => i + 1).map((week) => (
                  <option key={week} value={week}>
                    Week {week}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <Card className="weekly-projections-card-full">
          <div className="weekly-projections-content-full">
            <div className="weekly-chart-container-full">
              <WeeklyBarChart data={weeklyData} />
              <div className="weekly-chart-note">
                Estimated (season totals proxy) – real weekly projections coming soon
              </div>
            </div>
          </div>
        </Card>
      </div>
    </TopNav>
  );
}

