import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import TopNav from "../components/TopNav";
import { hasSettings } from "../lib/settings";
import Card from "../components/Card";
import "./TradeSuggestions.css";

export default function TradeSuggestions() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!hasSettings()) {
      navigate("/settings");
    }
  }, [navigate]);

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
