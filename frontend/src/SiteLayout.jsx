import { useRef, useState, useEffect, Suspense } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from './sessionContext';
import PageBoundary from './PageBoundary';

const links = [{to:'/',label:'Home'}, {to:'/predict',label:'Prediction engine'}, {to:'/reader',label:'Book reader'}];

export default function SiteLayout() {
  const { state, signIn, signOut, requestSession } = useSession();
  const location = useLocation();
  const [open,setOpen] = useState(false);
  const [authError,setAuthError] = useState('');
  const [authPending,setAuthPending] = useState(false);
  const menuButton = useRef(null);
  const main = useRef(null);
  const previousPath = useRef(location.pathname);
  useEffect(() => {
    const title = location.pathname === '/predict' ? 'Prediction engine' : location.pathname === '/reader' ? 'Book reader' : location.pathname === '/' ? 'Opponent intelligence' : 'Page not found';
    document.title = `${title} | NeuroChess`;
    window.scrollTo(0,0);
    if(previousPath.current!==location.pathname) main.current?.focus({preventScroll:true});
    previousPath.current=location.pathname;
  },[location.pathname]);
  async function authenticate() {
    setAuthPending(true); setAuthError('');
    try { await (state.isAuthenticated ? signOut() : signIn()); }
    catch { setAuthError('Could not connect to your account. Please try again.'); }
    finally { setAuthPending(false); }
  }
  function close() { setOpen(false); }
  return <div className="site-layout">
    <a className="skip-link" href="#main-content" onClick={()=>main.current?.focus()}>Skip to content</a>
    <header className="global-header">
      <div className="global-header-inner">
        <Link className="brand" to="/" aria-label="Neuro Chess home" onClick={close}>
          <img src="/brand/neurochess-128.webp" width="52" height="52" alt="" />
          <span><strong>NEURO<span>CHESS</span></strong><small>Intelligence meets instinct</small></span>
        </Link>
        <button className="menu-toggle" ref={menuButton} type="button" aria-expanded={open} aria-controls="primary-navigation" onClick={()=>setOpen(!open)}>{open ? 'Close' : 'Menu'} <span aria-hidden="true">{open ? '×' : '☰'}</span></button>
        <nav id="primary-navigation" className={`primary-navigation${open?' is-open':''}`} aria-label="Main navigation" onKeyDown={(event)=>{
          if (event.key==='Escape') { close(); menuButton.current?.focus(); }
        }}>
          {links.map(({to,label})=><NavLink key={to} to={to} end={to==='/'} onClick={()=>{ if(to!=='/') requestSession(); close(); }} className={({isActive})=>isActive?'is-current':''}>{label}</NavLink>)}
          <button className="nav-account" type="button" disabled={state.isLoading || authPending} onClick={authenticate}>{authPending?'Connecting…':state.isAuthenticated?'Sign out':'Sign in'} <span aria-hidden="true">↗</span></button>
        </nav>
      </div>
    </header>
    {authError && <p className="shell-notice" role="alert">{authError}</p>}
    <div id="main-content" ref={main} tabIndex={-1} className="site-content"><PageBoundary key={location.pathname}>
      <Suspense fallback={<main className="app-shell page-loading" role="status">Opening your preparation room…</main>}><Outlet /></Suspense>
    </PageBoundary></div>
    <footer className="site-footer">
      <div><strong>NEURO<span>CHESS</span></strong><p>Study with evidence. Play with intention.</p></div>
      <nav aria-label="Footer navigation">{links.map(({to,label})=><Link key={to} to={to} onClick={()=>{if(to!=='/')requestSession();close();}}>{label}</Link>)}</nav>
      <small>Engine evaluations and historical patterns support your own chess judgment.</small>
    </footer>
  </div>;
}
