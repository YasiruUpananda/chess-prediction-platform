export const API_BASE_URL = (import.meta.env?.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
export const AUTH_RECOVERY_EVENT = 'neuro-chess:authentication-required';
export const AUTH_RECOVERY_KEY = 'neuro-chess:reconnect';
let tokenProvider;
export function configureAuthentication(provider) {
  tokenProvider = provider;
  return () => { if (tokenProvider === provider) tokenProvider = undefined; };
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export function friendlyError(error) {
  const status = error.status || error.response?.status;
  if (status === 401) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_RECOVERY_EVENT));
    return 'Your session could not be verified. Use Sign in again to reconnect.';
  }
  return error.response?.data?.detail || error.message || error.error || 'The request failed. Please retry.';
}

function abortable(promise, signal) {
  if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal?.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', cancel));
  });
}

export async function getBearerHeaders(getAccessToken = tokenProvider, signal) {
  try {
    if (!getAccessToken) throw new ApiError('Sign in to use this tool.', 401);
    const token = await abortable(Promise.resolve().then(() => getAccessToken()), signal);
    if (!token) throw new ApiError('Sign in to use this tool.', 401);
    return { Authorization: `Bearer ${token}` };
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(friendlyError(new ApiError('Sign in to use this tool.',401)),401);
  }
}

export async function authenticatedRequest(path, options = {}, consume = (response) => response.status === 204 ? null : response.json()) {
  const { getAccessToken, timeout = 15000, signal, body, ...rest } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const headers = await getBearerHeaders(getAccessToken, controller.signal);
    const form = body instanceof FormData;
    const response = await fetch(`${API_BASE_URL}${path}`, { ...rest, signal: controller.signal,
      headers: { ...headers, ...(!form && body ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
      body: body ? form ? body : JSON.stringify(body) : undefined });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))).detail;
      throw new ApiError(friendlyError(new ApiError(detail || `Request failed (${response.status}).`,response.status)),response.status);
    }
    return await consume(response);
  } catch (error) {
    if (timedOut) throw new ApiError('Request deadline exceeded. Please retry.',408);
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel); }
}
export const requestJson = (path, options) => authenticatedRequest(path,options);

export function waitForPoll(signal, milliseconds = 1000) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
