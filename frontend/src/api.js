export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

export async function getBearerHeaders(getAccessToken) {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('No Asgardeo access token is available. Please sign in again.');
  return { Authorization: `Bearer ${accessToken}` };
}

export function waitForPoll(signal, milliseconds = 1000) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const cancel = () => {
      clearTimeout(timer);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
