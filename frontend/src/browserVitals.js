// Opt in at build time. No user IDs, tokens, query strings or page content.
export async function startBrowserVitals() {
  if (import.meta.env.VITE_ENABLE_BROWSER_METRICS !== 'true') return;
  const path=window.location.pathname;
  const { onCLS, onINP, onLCP } = await import('web-vitals');
  const endpoint = `${(import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/,'')}/api/v1/browser-vitals`;
  const report = ({name,value,id}) => {
    const route=path==='/'?'home':path==='/predict'?'predict':path==='/reader'?'reader':'other';
    const body=JSON.stringify({name,value,id,route,device:window.innerWidth<=600?'mobile':'desktop'});
    // A simple request avoids losing a CORS preflight during page unload.
    const blob=new Blob([body],{type:'text/plain'});
    if (!navigator.sendBeacon?.(endpoint,blob)) fetch(endpoint,{method:'POST',body:blob,keepalive:true}).catch(()=>{});
  };
  onCLS(report); onINP(report); onLCP(report);
}
