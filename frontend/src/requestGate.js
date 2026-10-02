// A synchronous gate prevents double moves before React has re-rendered.
export function createRequestGate() {
  let current = null;
  return {
    begin() {
      current?.abort();
      current = new AbortController();
      return current;
    },
    isCurrent(request) { return current === request && !request.signal.aborted; },
    busy() { return current !== null; },
    finish(request) { if (current === request) current = null; },
    cancel() { current?.abort(); current = null; },
  };
}
