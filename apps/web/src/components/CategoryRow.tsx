import "./CategoryRow.css";

type CategoryRowProps = {
  category: string;
  rank: number;
  totalTeams: number;
  value?: number;
  leagueAverage?: number;
  isLowerBetter?: boolean;
};

export default function CategoryRow({
  category,
  rank,
  totalTeams,
  value,
  leagueAverage,
  isLowerBetter = false,
}: CategoryRowProps) {
  const percentile = isLowerBetter
    ? ((totalTeams - rank + 1) / totalTeams) * 100
    : ((totalTeams - rank + 1) / totalTeams) * 100;

  const getRankText = () => {
    if (rank === 1) return "1st";
    if (rank === 2) return "2nd";
    if (rank === 3) return "3rd";
    return `${rank}th`;
  };

  const getBarColor = () => {
    if (percentile >= 70) return "#00a651"; // green
    if (percentile >= 40) return "#ffb81c"; // yellow
    return "#e31837"; // red
  };

  const getTextColor = () => {
    if (percentile >= 70) return "#00a651";
    if (percentile >= 40) return "#ffb81c";
    return "#e31837";
  };

  return (
    <div className="category-row">
      <div className="category-row-label">{category}</div>
      <div className="category-row-content">
        <div className="category-row-bar-container">
          <div
            className="category-row-bar"
            style={{
              width: `${percentile}%`,
              backgroundColor: getBarColor(),
            }}
          />
        </div>
        <div className="category-row-rank" style={{ color: getTextColor() }}>
          {getRankText()}
        </div>
      </div>
      {value !== undefined && leagueAverage !== undefined && (
        <div className="category-row-value">
          {value.toFixed(1)} vs {leagueAverage.toFixed(1)} avg
        </div>
      )}
    </div>
  );
}

