import { rankDisplay } from "../lib/rankDisplay";
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
}: CategoryRowProps) {
  const display = rankDisplay(rank, totalTeams);

  return (
    <div className="category-row">
      <div className="category-row-label">{category}</div>
      <div className="category-row-content">
        <div className="category-row-bar-container">
          <div
            className="category-row-bar"
            style={{
              width: `${display.percentile}%`,
              backgroundColor: display.color,
            }}
          />
        </div>
        <div className="category-row-rank" title={display.description} style={{ color: display.color }}>
          {display.label}
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

