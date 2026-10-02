import { lazy, Suspense, useState } from 'react';
import { SessionContext } from './sessionContext';
import { AUTH_RECOVERY_KEY } from './api';

const SdkSession = lazy(() => import('./SdkSession'));

export default function AuthBoundary({ children }) {
  const [requested, setRequested] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    if (sessionStorage.getItem(AUTH_RECOVERY_KEY)) return 'signin';
    return window.location.pathname !== '/' || query.has('code') || query.has('error') ? 'session' : '';
  });
  if (requested) return <Suspense fallback={<main className="app-shell" role="status">Checking your secure session…</main>}>
    <SdkSession signInRequested={requested === 'signin'}>{children}</SdkSession>
  </Suspense>;
  return <SessionContext.Provider value={{ state: { isAuthenticated: false, isLoading: false },
    signIn: () => setRequested('signin'), requestSession: () => setRequested('session') }}>
    {children}
  </SessionContext.Provider>;
}
