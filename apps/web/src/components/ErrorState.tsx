import Icon from "./Icon";
import "./ErrorState.css";

type ErrorStateProps = {
  message: string;
  onRetry?: () => void;
};

export default function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <div className="error-icon"><Icon name="alert" size={28} /></div>
      <div className="error-message">{message}</div>
      {onRetry && (
        <button className="error-retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

