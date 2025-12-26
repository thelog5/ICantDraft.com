import { useState } from "react";
import { api, ApiError } from "../lib/api";
import "./RefreshButton.css";

type RefreshButtonProps = {
  onSuccess?: () => void;
};

export default function RefreshButton({ onSuccess }: RefreshButtonProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleRefresh = async () => {
    setLoading(true);
    setMessage(null);

    try {
      await api.refreshEspnData();
      setMessage("Data refreshed successfully!");
      setTimeout(() => setMessage(null), 3000);
      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setMessage(`Error: ${err.message}`);
      } else {
        setMessage("Failed to refresh data");
      }
      setTimeout(() => setMessage(null), 5000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="refresh-button-container">
      <button
        onClick={handleRefresh}
        disabled={loading}
        className="refresh-button"
      >
        {loading ? "Refreshing..." : "🔄 Refresh ESPN Data"}
      </button>
      {message && (
        <div
          className={`refresh-message ${
            message.startsWith("Error") ? "error" : "success"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}

