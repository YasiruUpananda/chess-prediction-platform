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
  if (requested) return <Suspense fallback={<SessionContext.Provider value={{state:{isAuthenticated:false,isLoading:true},requestSession:()=>{},signIn:()=>{}}}>{children}</SessionContext.Provider>}>
    <SdkSession signInRequested={requested === 'signin'}>{children}</SdkSession>
  </Suspense>;
  return <SessionContext.Provider value={{ state: { isAuthenticated: false, isLoading: false },
    signIn: () => setRequested('signin'), requestSession: () => setRequested('session') }}>
    {children}
  </SessionContext.Provider>;
}
