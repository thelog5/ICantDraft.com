import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { authenticated, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100vh',
        fontSize: '1.25rem',
        color: '#6b7280'
      }}>
        Loading...
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}

