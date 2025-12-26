import Layout from "../components/Layout";
import Card from "../components/Card";
import SimpleChart from "../components/SimpleChart";
import "./FreeAgents.css";

export default function FreeAgents() {

  return (
    <Layout>
      <div className="free-agents">
        <h1>Free Agents / Streaming</h1>

        <div className="free-agents-filters">
          <select className="free-agents-filter">
            <option>All Positions</option>
            <option>PG</option>
            <option>SG</option>
            <option>SF</option>
            <option>PF</option>
            <option>C</option>
            <option>UTIL</option>
          </select>

          <label className="free-agents-toggle">
            <input type="checkbox" />
            Last 7 days
          </label>

          <select className="free-agents-filter">
            <option>Streaming days: 1</option>
            <option>Streaming days: 2</option>
            <option>Streaming days: 3</option>
            <option>Streaming days: 4</option>
            <option>Streaming days: 5</option>
            <option>Streaming days: 6</option>
            <option>Streaming days: 7</option>
          </select>
        </div>

        <Card>
          <h2 className="card-title">Free Agent Analysis</h2>
          <div className="free-agents-chart-container">
            <SimpleChart data={[]} height={300} />
          </div>
          <div className="todo-note">
            <strong>TODO:</strong> Needs free agents endpoint. Chart component is ready but
            requires player-level data with availability status.
          </div>
        </Card>

        <Card>
          <h2 className="card-title">Streaming Recommendations</h2>
          <div className="todo-note">
            <strong>TODO:</strong> Needs free agents endpoint with streaming analysis
            capabilities.
          </div>
        </Card>
      </div>
    </Layout>
  );
}

