import { rankDisplay } from "../lib/rankDisplay";
import "./CategoryTile.css";

type CategoryTileProps = {
  category: string;
  rank: number;
  totalTeams: number;
};

export default function CategoryTile({ category, rank, totalTeams }: CategoryTileProps) {
  const display = rankDisplay(rank, totalTeams);

  return (
    <div className="category-tile" title={display.description}>
      <div className="category-tile-label">{category}</div>
      <div className="category-tile-rank" style={{ color: display.color, fontSize: Number.isInteger(rank) ? undefined : "1.25rem" }} title={display.description}>
        {display.label}
      </div>
    </div>
  );
}

