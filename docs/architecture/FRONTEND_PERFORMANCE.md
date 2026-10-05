# Frontend loading and behavior

The initial JavaScript entry decreased from 902,467 to approximately 265,000 bytes
(71% smaller). Using the same Node gzip settings, it decreased from 276,824 to
approximately 83,600 bytes (70% smaller). Vite's displayed gzip estimate is slightly
different: approximately 279 KB before and 84 KB after. These are bundle sizes,
not measured page-load times or Core Web Vitals.

`performance/bundle-before.json` and `bundle-after.json` record the measurements.
Every production build writes an ignored `bundle-current.json`, including chunk
imports, dynamic imports and package contributions. Package `renderedLength`
values are measured before final minification; they are useful for identifying
large dependencies but do not sum to the final chunk sizes.

The authentication SDK dominated the previous initial bundle. It now loads when
opening a protected route, clicking Sign in, or handling an OAuth callback. Redux
loads with the authenticated workspace, and chess code loads with the prediction
or reader routes. PDF rendering code, styles and its worker load only after a
document is selected. The optional authentication and PDF chunks remain large;
the production build continues to report their size warnings. A cold protected
route still needs authentication and chess dependencies.

## Serving

`npm run build` creates gzip and Brotli sidecars. `npm run serve` serves the built
site locally at http://127.0.0.1:4173 with compression negotiation. Vite preview
is useful for previews but does not exercise this production serving configuration.

The frontend Docker image uses Nginx to serve gzip sidecars, immutable one-year
caching for hashed `/assets/` filenames, uncached HTML, and SPA route fallback.
The PDF module worker has an explicit JavaScript MIME type. Brotli sidecars are
available for hosts that support them; this Nginx image serves gzip.

From the repository root:

```sh
docker build -t neuro-chess-frontend frontend
docker run --rm -p 8080:80 neuro-chess-frontend
```

Public Vite configuration is compiled into the application. Set Docker build
arguments `VITE_API_URL`, `VITE_ASGARDEO_CLIENT_ID`, `VITE_ASGARDEO_BASE_URL`,
`VITE_ASGARDEO_SIGN_IN_REDIRECT_URL` and `VITE_ASGARDEO_SIGN_OUT_REDIRECT_URL`
for the deployment. The API URL must be reachable from the user's browser.
Register the frontend origin/redirect URLs in Asgardeo and allow that origin in
the API's CORS configuration. Vite variables must never contain client secrets.

## Requests and state

RTK Query caches and deduplicates the player list, keyed by session identity.
Unused entries remain for 120 seconds; returning after 60 seconds triggers a
refresh, and users can refresh explicitly. Workspace state and query caches reset
when the account identity changes. See the [official cache documentation](https://redux.js.org/tutorials/essentials/part-8-rtk-query-advanced#cache-data-subscription-lifetimes).

Move prediction, strategy generation and PDF extraction retain separate states
and cancellation gates. Predictions only apply to their original position and
opponent. Opponent, report color and context changes clear obsolete reports;
leaving the dashboard clears reports because its context form is local.
Board history remains available when navigating home and back.

The shared authenticated request layer includes token acquisition in its deadline:
players 12 seconds, moves 15 seconds, streamed reports 85 seconds, OCR submission
30 seconds and each OCR poll 10 seconds. External cancellation is supported.
Mutations are never automatically replayed after a timeout or authentication error.
All API 401s show one recovery banner. Because calling SDK `signIn()` on an
authenticated session can return cached credentials, recovery signs out through
the SDK and records a tab-local marker to initiate sign-in after redirect.

Boards use their container width via ResizeObserver. Both boards accept SAN/UCI
keyboard moves; prediction includes promotion selection, flip and undo-turn
controls. Report tabs support arrows, Home and End, with associated tab panels.

## Verification

From `frontend`:

```sh
npm ci
npm run lint
npm test
npm run test:browser
```

Playwright uses installed Edge on Windows, or Chromium elsewhere. Set
`BROWSER_PATH` to another compatible browser executable, or install Playwright
Chromium with `npx playwright install chromium` when needed.

Tests run at desktop 1440x1000 and mobile 390x844 viewports. They verify actual
production-home requests and compression/cache headers; cached navigation;
responsive boards and horizontal overflow; keyboard moves/undo/flip;
superseded predictions/reports; tab keyboard behavior; report invalidation;
one authentication recovery action; deferred PDF loading; real PDF worker rendering
and text extraction; and PGN downloads. Unit tests cover token deadlines,
cancellation and mutation replay prevention alongside existing chess/parser tests.

Protected-route browser tests use an explicitly isolated `browser-test` Vite mode
with a mock auth adapter and intercepted API responses. Production builds use
the real Asgardeo SDK. These tests verify frontend behavior, not successful live
Asgardeo sign-in, Gemini generation, engine evaluation, physical touch-device
behavior or a production Core Web Vitals score. Nginx Docker checks separately
verify gzip, immutable caching, worker MIME type and SPA HTML fallback.
