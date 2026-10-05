import { Link } from 'react-router-dom';
import { useSession } from '../features/auth/sessionContext';

export default function Home() {
  const { state, requestSession } = useSession();
  return <main className="home-shell">
    <section className="home-hero">
      <div className="home-copy">
        <span className="eyebrow"><span className="eyebrow-rule" /> The modern chess preparation room</span>
        <h1>See the game.<br /><em>Own your next move.</em></h1>
        <p>Understand the player across the board. Explore the positions that matter. Turn your study into a sharper plan.</p>
        <div className="home-actions">
          <Link onClick={requestSession} className="home-primary-link" to="/predict">Open prediction engine <span aria-hidden="true">↗</span></Link>
          <Link onClick={requestSession} className="home-secondary-link" to="/reader">Explore the book reader <span aria-hidden="true">→</span></Link>
        </div>
        <div className="home-auth-note">{state.isAuthenticated ? 'Your preparation room is ready.' : 'Your studies stay private to your account.'}</div>
        <div className="hero-capabilities" aria-label="Analysis tools"><span>Stockfish evaluation</span><span>Player game history</span><span>Evidence-led reports</span></div>
      </div>
      <div className="hero-brand-art">
        <div className="art-topline"><span>NEURAL INTELLIGENCE</span><span>01 / THE NEXT MOVE</span></div>
        <img src="/brand/neurochess-640.webp" width="640" height="640" alt="NeuroChess logo: a silver knight with gold neural connections" fetchPriority="high" />
        <div className="art-caption"><span className="art-dot" /><span>A deeper understanding of the game.</span><span aria-hidden="true">↗</span></div>
      </div>
    </section>
    <section className="home-features" aria-label="Neuro Chess features">
      <article><span>01 / PREDICT</span><div className="feature-glyph" aria-hidden="true">♞</div><h2>Know the opponent.</h2><p>Compare historical choices with engine recommendations, with the sample behind each prediction.</p><Link onClick={requestSession} to="/predict" aria-label="Open prediction engine">Explore predictions <span aria-hidden="true">↗</span></Link></article>
      <article><span>02 / STUDY</span><div className="feature-glyph" aria-hidden="true">▤</div><h2>Bring the book to life.</h2><p>Read a chess PDF, extract its lines and explore every move on an interactive board.</p><Link onClick={requestSession} to="/reader" aria-label="Open chess book reader">Open your library <span aria-hidden="true">↗</span></Link></article>
      <article><span>03 / PREPARE</span><div className="feature-glyph" aria-hidden="true">◎</div><h2>A plan with evidence.</h2><p>Build cited opponent reports, save private studies and carry your preparation into the next game.</p><Link onClick={requestSession} to="/predict" aria-label="Prepare an opponent report">Build a game plan <span aria-hidden="true">↗</span></Link></article>
    </section>
    <section className="home-closing" aria-label="Start preparing"><div><span className="eyebrow">From study to strategy</span><h2>Make preparation<br /><em>your advantage.</em></h2></div><Link className="home-primary-link" to="/predict" onClick={requestSession}>Start your next session <span aria-hidden="true">→</span></Link></section>
  </main>;
}
