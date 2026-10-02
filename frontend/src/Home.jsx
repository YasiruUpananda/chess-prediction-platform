import { Link } from 'react-router-dom';
import { useAuthContext } from '@asgardeo/auth-react';

export default function Home() {
  const { state, signIn, signOut } = useAuthContext();
  const isAuthenticated = state.isAuthenticated;

  return (
    <main className="home-shell">
      <header className="home-header">
        <Link className="brand" to="/" aria-label="Neuro Chess home">
          <span className="brand-mark">♞</span>
          <span><strong>Neuro Chess</strong><small>Opponent intelligence</small></span>
        </Link>
        <nav className="home-nav" aria-label="Main navigation">
          <Link to="/predict">Prediction engine</Link>
          <Link to="/reader">Book reader</Link>
          {isAuthenticated ? (
            <button className="home-auth-button" onClick={() => signOut()} type="button">Sign out</button>
          ) : (
            <button className="home-auth-button" onClick={() => signIn()} type="button">Sign in</button>
          )}
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-copy">
          <span className="eyebrow">Your next move starts here</span>
          <h1>See the game<br /><em>from every angle.</em></h1>
          <p>Study your opponent’s patterns, explore chess books, and turn every position into a plan.</p>
          <div className="home-actions">
            <Link className="home-primary-link" to="/predict">Open prediction engine <span aria-hidden="true">→</span></Link>
            <Link className="home-secondary-link" to="/reader">Read a chess book</Link>
          </div>
          <div className="home-auth-note" aria-live="polite">
            {isAuthenticated ? `Signed in${state.username ? ` as ${state.username}` : ''} with Asgardeo.` : 'Sign in with Asgardeo to unlock personalized opponent analysis.'}
          </div>
        </div>
        <div className="home-board-art" aria-label="Chess board illustration" role="img">
          <div className="home-board-art__glow" />
          <div className="home-board-art__grid" aria-hidden="true">
            {['♜','♞','♝','♛','♚','♝','♞','♜','♟','♟','♟','♟','♟','♟','♟','♟','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','♙','♙','♙','♙','♙','♙','♙','♙','♖','♘','♗','♕','♔','♗','♘','♖'].map((piece, index) => (
              <span className={(Math.floor(index / 8) + index % 8) % 2 ? 'is-light' : 'is-dark'} key={index}>{piece}</span>
            ))}
          </div>
          <div className="home-board-caption"><span>01 / 03</span><b>A clearer view of the board</b><span>♞</span></div>
        </div>
      </section>

      <section className="home-features" aria-label="Neuro Chess features">
        <article><span>01</span><div><h2>Predict</h2><p>Explore likely responses to a position and prepare your next plan.</p></div><Link to="/predict" aria-label="Open prediction engine">↗</Link></article>
        <article><span>02</span><div><h2>Study</h2><p>Read chess books alongside an interactive board and move finder.</p></div><Link to="/reader" aria-label="Open chess book reader">↗</Link></article>
        <article><span>03</span><div><h2>Prepare</h2><p>Build a focused opponent report from game history and context.</p></div><Link to="/predict" aria-label="Prepare an opponent report">↗</Link></article>
      </section>
    </main>
  );
}
