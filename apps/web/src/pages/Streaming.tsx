import TopNav from "../components/TopNav";
import { useActiveContext } from "../hooks/useActiveContext";
import Card from "../components/Card";
import "./Streaming.css";

export default function Streaming() {
  useActiveContext(); // Redirects to settings if no context

  return (
    <TopNav>
      <div className="streaming-page">
        <h1 className="streaming-title">Streaming</h1>

        <div className="streaming-grid">
          <Card className="streaming-card">
            <h2 className="card-title">Top Streamers Today</h2>
            <div className="streaming-placeholder">
              <p className="empty-state-text">Top streamers endpoint not yet available.</p>
            </div>
          </Card>

          <Card className="streaming-card">
            <h2 className="card-title">Schedule Advantage</h2>
            <div className="streaming-placeholder">
              <p className="empty-state-text">Schedule advantage endpoint not yet available.</p>
            </div>
          </Card>

          <Card className="streaming-card">
            <h2 className="card-title">Suggested Adds</h2>
            <div className="streaming-placeholder">
              <p className="empty-state-text">Suggested adds endpoint not yet available.</p>
            </div>
          </Card>
        </div>
      </div>
    </TopNav>
  );
}
