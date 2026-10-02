import { lazy, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Outlet } from 'react-router-dom';
import { useSession } from './sessionContext';
import AuthBoundary from './AuthBoundary';
import AuthenticationRecovery from './AuthenticationRecovery';
import SiteLayout from './SiteLayout';
import PageBoundary from './PageBoundary';

const Home = lazy(() => import('./Home'));
const Dashboard = lazy(() => import('./Dashboard'));
const PdfReader = lazy(() => import('./PdfReader'));
const WorkspaceProvider = lazy(() => import('./WorkspaceProvider'));

function ProtectedArea() {
  const { state, signIn } = useSession();
  const [signInError,setSignInError] = useState('');
  const [pending,setPending] = useState(false);
  async function connect() {
    setPending(true); setSignInError('');
    try { await signIn(); }
    catch { setSignInError('Could not open sign-in. Please try again.'); }
    finally { setPending(false); }
  }
  if (state.isLoading) return <main className="app-shell" aria-live="polite">Checking your Asgardeo session…</main>;
  if (!state.isAuthenticated) {
    return (
      <main className="app-shell">
        <section className="sign-in-card panel protected-card">
          <span className="lock-icon">♙</span><span className="eyebrow">Asgardeo account required</span>
          <h1>Sign in to continue</h1><p>Sign in securely with Asgardeo to use the prediction engine and book move analysis.</p>
          <button onClick={connect} disabled={pending} className="primary-button" type="button">{pending?'Connecting…':'Sign in with Asgardeo'}</button>
          {signInError && <p role="alert">{signInError}</p>}
          <Link className="protected-home-link" to="/">Return home</Link>
        </section>
      </main>
    );
  }
  const owner = state.sub || state.username || 'session';
  return <WorkspaceProvider key={owner} owner={owner}><Outlet /></WorkspaceProvider>;
}

export default function App() {
  return (
    <Router>
      <PageBoundary><AuthBoundary>
      <AuthenticationRecovery />
        <Routes>
          <Route element={<SiteLayout />}>
          <Route path="/" element={<Home />} />
          <Route element={<ProtectedArea />}>
            <Route path="/predict" element={<Dashboard />} />
            <Route path="/reader" element={<PdfReader />} />
          </Route>
          <Route path="*" element={<main className="app-shell"><section className="panel protected-card sign-in-card"><span className="eyebrow">404 / Off the board</span><h1>Page not found</h1><p>Return to your preparation room to find your next move.</p><Link className="home-primary-link" to="/">Return home</Link></section></main>} />
          </Route>
        </Routes>
      </AuthBoundary></PageBoundary>
    </Router>
  );
}
