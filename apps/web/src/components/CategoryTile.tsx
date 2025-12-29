import "./CategoryTile.css";

type CategoryTileProps = {
  category: string;
  rank: number;
  totalTeams: number;
};

export default function CategoryTile({ category, rank, totalTeams }: CategoryTileProps) {
  const getRankText = () => {
    if (rank === 1) return "1st";
    if (rank === 2) return "2nd";
    if (rank === 3) return "3rd";
    return `${rank}th`;
  };

  const percentile = ((totalTeams - rank + 1) / totalTeams) * 100;

  const getColor = () => {
    if (percentile >= 70) return "#00a651"; // green
    if (percentile >= 40) return "#0066cc"; // blue
    return "#e31837"; // red
  };

  const hoverText = `${rank}/${totalTeams}`;

  return (
    <div className="category-tile" title={hoverText}>
      <div className="category-tile-label">{category}</div>
      <div className="category-tile-rank" style={{ color: getColor() }} title={hoverText}>
        {getRankText()}
      </div>
    </div>
  );
}

