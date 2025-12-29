import TopNav from "../components/TopNav";
import { useActiveContext } from "../hooks/useActiveContext";
import Card from "../components/Card";
import "./TradeSuggestions.css";

export default function TradeSuggestions() {
  useActiveContext(); // Redirects to settings if no context

  return (
    <TopNav>
      <div className="trade-suggestions-page">
        <h1 className="trade-suggestions-title">Trade Suggestions</h1>

        <Card className="trade-suggestions-card-full">
          <div className="trade-suggestions-empty">
            <p className="empty-state-text">
              Trade suggestions require player-level valuation endpoint (coming soon).
            </p>
          </div>
        </Card>
      </div>
    </TopNav>
  );
}
