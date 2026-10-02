import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Outlet } from 'react-router-dom';
import { useAuthContext } from '@asgardeo/auth-react';

const Home = lazy(() => import('./Home'));
const Dashboard = lazy(() => import('./Dashboard'));
const PdfReader = lazy(() => import('./PdfReader'));

function ProtectedArea() {
  const { state, signIn } = useAuthContext();
  if (state.isLoading) return <main className="app-shell" aria-live="polite">Checking your Asgardeo session…</main>;
  if (!state.isAuthenticated) {
    return (
      <main className="app-shell">
        <header className="site-header"><Link className="brand" to="/"><span className="brand-mark">♞</span><span><strong>Neuro Chess</strong><small>Opponent intelligence</small></span></Link></header>
        <section className="sign-in-card panel protected-card">
          <span className="lock-icon">♙</span><span className="eyebrow">Asgardeo account required</span>
          <h3>Sign in to continue</h3><p>Sign in securely with Asgardeo to use the prediction engine and book move analysis.</p>
          <button onClick={() => signIn()} className="primary-button" type="button">Sign in with Asgardeo</button>
          <Link className="protected-home-link" to="/">Return home</Link>
        </section>
      </main>
    );
  }
  return <Outlet />;
}

export default function App() {
  return (
    <Router>
      <Suspense fallback={<main className="app-shell" aria-live="polite">Opening Neuro Chess…</main>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route element={<ProtectedArea />}>
            <Route path="/predict" element={<Dashboard />} />
            <Route path="/reader" element={<PdfReader />} />
          </Route>
        </Routes>
      </Suspense>
    </Router>
  );
}
