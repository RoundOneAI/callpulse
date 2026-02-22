import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity } from 'lucide-react';

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase JS client automatically exchanges the token from the URL hash.
    // The onAuthStateChange listener in the auth store will pick up the session
    // and set the user. We just need to redirect to the dashboard.
    const timer = setTimeout(() => navigate('/', { replace: true }), 1000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <Activity className="h-8 w-8 text-indigo-600 mx-auto mb-4 animate-pulse" />
        <p className="text-sm text-gray-500">Signing you in...</p>
      </div>
    </div>
  );
}
