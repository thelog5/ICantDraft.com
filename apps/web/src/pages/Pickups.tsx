import TopNav from "../components/TopNav";
import { useActiveContext } from "../hooks/useActiveContext";
import Card from "../components/Card";
import "./Pickups.css";

export default function Pickups() {
  useActiveContext(); // Redirects to settings if no context

  return (
    <TopNav>
      <div className="pickups-page">
        <div className="pickups-header">
          <h1 className="pickups-title">Pickups</h1>
          <div className="pickups-filters">
            <select className="pickups-filter">
              <option>All Positions</option>
              <option>PG</option>
              <option>SG</option>
              <option>SF</option>
              <option>PF</option>
              <option>C</option>
            </select>
            <select className="pickups-filter">
              <option>All Teams</option>
            </select>
          </div>
        </div>

        <Card className="pickups-card">
          <div className="pickups-placeholder">
            <p className="empty-state-text">
              Pickups endpoint not yet available. This will show available free agents with
              recommendations based on your team's needs.
            </p>
          </div>
        </Card>
      </div>
    </TopNav>
  );
}
