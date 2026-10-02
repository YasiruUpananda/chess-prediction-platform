import { useEffect, useState } from 'react';
import { AUTH_RECOVERY_EVENT, AUTH_RECOVERY_KEY } from './api';
import { useSession } from './sessionContext';

export default function AuthenticationRecovery() {
  const [required, setRequired] = useState(false);
  const { state, signIn, signOut } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function reconnect() {
    setPending(true); setError('');
    try {
      // The SDK returns its cached session when signIn is called while authenticated.
      // Clear that session through its supported sign-out flow, then sign in on redirect.
      if (state.isAuthenticated) {
        sessionStorage.setItem(AUTH_RECOVERY_KEY, '1');
        await signOut();
      } else await signIn();
    } catch {
      sessionStorage.removeItem(AUTH_RECOVERY_KEY);
      setError('Could not reconnect. Please retry.'); setPending(false);
    }
  }
  useEffect(() => {
    const expired = () => setRequired(true);
    window.addEventListener(AUTH_RECOVERY_EVENT, expired);
    return () => window.removeEventListener(AUTH_RECOVERY_EVENT, expired);
  }, []);
  if (!required) return null;
  return <aside className="authentication-recovery" role="alert">
    <span>Your session could not be verified. Sign in again to reconnect.</span>
    <button type="button" disabled={pending} onClick={reconnect}>Sign in again</button>
    {error && <span>{error}</span>}
  </aside>;
}
