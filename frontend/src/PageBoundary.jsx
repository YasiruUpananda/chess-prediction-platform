import { Component } from 'react';

export default class PageBoundary extends Component {
  state = { failed:false };
  static getDerivedStateFromError() { return {failed:true}; }
  render() {
    if(this.state.failed) return <main className="app-shell"><section className="panel protected-card sign-in-card" role="alert">
      <span className="eyebrow">A pause in play</span><h1>This page could not open</h1>
      <p>Reload to fetch the latest version, or use the navigation to open another tool.</p>
      <button className="primary-button" type="button" onClick={()=>window.location.reload()}>Reload page</button>
      <a className="protected-home-link" href="/">Return home</a>
    </section></main>;
    return this.props.children;
  }
}
