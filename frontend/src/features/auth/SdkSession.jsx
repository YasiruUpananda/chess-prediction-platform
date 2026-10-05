import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AuthProvider, useAuthContext } from '@asgardeo/auth-react';
import { SessionContext } from './sessionContext';
import { configureAuthentication, AUTH_RECOVERY_KEY } from '../../lib/api';

const config = {
  signInRedirectURL: import.meta.env.VITE_ASGARDEO_SIGN_IN_REDIRECT_URL || window.location.origin,
  signOutRedirectURL: import.meta.env.VITE_ASGARDEO_SIGN_OUT_REDIRECT_URL || window.location.origin,
  clientID: import.meta.env.VITE_ASGARDEO_CLIENT_ID || 'oRNCmE0Hn5GH7tPZ0VOSY8p1ZLoa',
  baseUrl: import.meta.env.VITE_ASGARDEO_BASE_URL || 'https://api.asgardeo.io/t/yasiru2002projects',
  scope: ['openid', 'profile'],
};

function Bridge({ children, signInRequested }) {
  const auth = useAuthContext();
  const started = useRef(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => configureAuthentication(auth.getAccessToken), [auth.getAccessToken]);
  useEffect(() => {
    if (signInRequested && !auth.state.isLoading && !started.current) {
      started.current = true;
      sessionStorage.removeItem(AUTH_RECOVERY_KEY);
      auth.signIn().catch(() => setError('Could not open sign-in. Please retry.'));
    }
  }, [signInRequested, auth]);
  return <SessionContext.Provider value={{ ...auth, requestSession: () => {} }}>
    {error && <aside className="authentication-recovery" role="alert">{error}
      <button type="button" onClick={() => auth.signIn().catch(() => setError('Could not open sign-in. Please retry.'))}>Retry sign-in</button>
    </aside>}{children}
  </SessionContext.Provider>;
}

export default function SdkSession({ children, signInRequested }) {
  return <AuthProvider config={config}><Bridge signInRequested={signInRequested}>{children}</Bridge></AuthProvider>;
}
