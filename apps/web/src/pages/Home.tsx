import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getActiveContext } from "../lib/activeContext";
import TopNav from "../components/TopNav";
import Card from "../components/Card";
import "./Home.css";

export default function Home() {
  const navigate = useNavigate();
  const [hasContext, setHasContext] = useState<boolean | null>(null);

  useEffect(() => {
    const ctx = getActiveContext();
    setHasContext(!!ctx);
  }, []);

  if (hasContext === null) {
    return (
      <TopNav>
        <div className="home-page">
          <div className="home-loading">Loading...</div>
        </div>
      </TopNav>
    );
  }

  return (
    <TopNav>
      <div className="home-page">
        <div className="home-hero">
          <h1 className="home-title">ICantDraft.com</h1>
          <p className="home-subtitle">Fantasy Basketball Analytics Platform</p>
        </div>

        <Card className="home-action-card">
          {hasContext ? (
            <div className="home-action-content">
              <h2 className="home-action-title">Ready to Analyze</h2>
              <p className="home-action-description">
                Your league and team are configured. Go to your dashboard to see analytics.
              </p>
              <button
                className="home-action-button primary"
                onClick={() => navigate("/dashboard")}
              >
                Go to Dashboard
              </button>
            </div>
          ) : (
            <div className="home-action-content">
              <h2 className="home-action-title">Connect Your League</h2>
              <p className="home-action-description">
                Get started by connecting your ESPN fantasy basketball league.
              </p>
              <button
                className="home-action-button primary"
                onClick={() => navigate("/settings")}
              >
                Connect League
              </button>
            </div>
          )}
        </Card>
      </div>
    </TopNav>
  );
}
