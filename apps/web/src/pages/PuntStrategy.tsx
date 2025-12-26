import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopNav from "../components/TopNav";
import { getResolvedLeagueId, getResolvedTeamId, hasSettings } from "../lib/settings";
import { api, TeamProfileResponse, ApiError } from "../lib/api";
import Card from "../components/Card";
import PuntImpactChart from "../components/PuntImpactChart";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import "./PuntStrategy.css";

export default function PuntStrategy() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);
  const leagueId = getResolvedLeagueId();
  const teamId = getResolvedTeamId();

  useEffect(() => {
    if (!hasSettings() || !leagueId || !teamId) {
      navigate("/settings");
      return;
    }

    loadData();
  }, [leagueId, teamId, navigate]);

  const loadData = async () => {
    if (!leagueId || !teamId) return;

    setLoading(true);
    setError(null);

    try {
      const profileData = await api.getTeamProfile(leagueId, teamId);
      setProfile(profileData);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load punt strategy");
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <TopNav>
        <div className="punt-strategy-page">
          <Skeleton height="400px" width="100%" />
        </div>
      </TopNav>
    );
  }

  if (error) {
    return (
      <TopNav>
        <div className="punt-strategy-page">
          <ErrorState message={error} onRetry={loadData} />
        </div>
      </TopNav>
    );
  }

  if (!profile) {
    return (
      <TopNav>
        <div className="punt-strategy-page">
          <ErrorState message="No team profile found" onRetry={loadData} />
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

  // Get worst 2 categories (punt candidates)
  const puntCandidates = categoryKeys
    .map((key) => ({
      key,
      zScore: profile.profile.zScores[key],
      isLowerBetter: key === "tov",
    }))
    .sort((a, b) => {
      if (a.isLowerBetter) return a.zScore - b.zScore;
      return b.zScore - a.zScore;
    })
    .slice(0, 2);

  // Get best 4 categories (keep focus)
  const keepFocus = categoryKeys
    .map((key) => ({
      key,
      rank: profile.profile.categoryRank[key],
      isLowerBetter: key === "tov",
    }))
    .filter((cat) => !cat.isLowerBetter)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 4);

  // Impact chart data
  const impactData = categoryKeys.slice(0, 4).map((key) => ({
    category: categoryLabels[key],
    gain: Math.max(0, profile.profile.zScores[key] * 10),
    loss: Math.max(0, -profile.profile.zScores[key] * 10),
  }));

  return (
    <TopNav>
      <div className="punt-strategy-page">
        <h1 className="punt-strategy-title">Punt Strategy</h1>

        <Card className="punt-strategy-card-full">
          <div className="punt-strategy-content-full">
            <div className="punt-strategy-recommendation-full">
              <div className="punt-strategy-label-full">Recommended Punt:</div>
              <div className="punt-strategy-categories-full">
                {puntCandidates.map((cat) => (
                  <span key={cat.key} className="punt-category-badge-full">
                    {categoryLabels[cat.key]}
                  </span>
                ))}
              </div>
            </div>

            <div className="punt-strategy-focus-full">
              <div className="punt-strategy-label-full">Keep Focus:</div>
              <div className="punt-strategy-focus-cats-full">
                {keepFocus.map((cat) => categoryLabels[cat.key]).join(", ")}
              </div>
            </div>

            <div className="punt-impact-chart-container-full">
              <h3 className="punt-impact-title">Category Impact</h3>
              <PuntImpactChart data={impactData} />
            </div>
          </div>
        </Card>
      </div>
    </TopNav>
  );
}

