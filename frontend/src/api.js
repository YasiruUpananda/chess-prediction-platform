export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

export async function getBearerHeaders(getAccessToken) {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('No Asgardeo access token is available. Please sign in again.');
  return { Authorization: `Bearer ${accessToken}` };
}
