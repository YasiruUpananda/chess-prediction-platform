# NeuroChess branding and source review

The supplied logo is the visual source: charcoal and black surfaces, silver text,
and warm gold accents. The artwork is unchanged; resized WebP delivery files live
in `frontend/public/brand`. The 640-pixel hero is 31,844 bytes, the navigation image
4,258 bytes and favicon 1,940 bytes, compared with the 1,404,123-byte source PNG.
`frontend/scripts/prepare-brand.mjs` can reproduce them from the original file.

## Product changes

- One shared header and footer cover home, prediction, reader, protected access
  and unknown routes. Active links expose `aria-current`. The mobile menu supports
  keyboard access, Escape dismissal and focus return to its button.
- A focusable content target and skip link let keyboard users bypass navigation.
  Reduced-motion preferences disable decorative transitions. Controls use visible
  focus indicators and generally provide a 44-pixel interaction height.
- Home introduces the tools with an editorial type hierarchy and the supplied
  logo. The prediction workspace, reports, saved studies, PDF reader, errors and
  sign-in state share the same palette, spacing, surfaces and control styles.
- Saved studies follow the primary tools in both visible and keyboard order.
  Chessboards reserve square space before initialization and use warm neutral
  squares with distinct light/dark values.
- Page downloads have a recovery boundary. Navigation remains available when a
  tool module fails. Authentication loading also retains the shared shell.
- Titles, description, theme color and favicon now carry NeuroChess branding.

The navigation structure follows [W3C landmark guidance](https://www.w3.org/WAI/WCAG22/Techniques/html/H101).
Motion handling follows [W3C reduced-motion guidance](https://www.w3.org/WAI/WCAG22/Techniques/css/C39).

## Source review and corrections

Reviewed the active routing/session and API transport paths; request coordination
and chess history; PDF text parsing/rendering/OCR and extraction caches; studies
ownership; JWT validation and ingestion permissions; database schema/pooling;
ingestion confirmation/retry paths; engine evaluation; player-filtered reports,
citations and caches; and operational measurements.

| Finding | Correction |
| --- | --- |
| Each page duplicated its header; tool navigation was missing from working pages. | Shared routed layout with header/footer and a mobile menu. |
| Failed lazy tool downloads could leave a blank screen. | Route recovery boundary with reload and usable navigation; outer boundary also catches SDK loading failures. |
| Authentication loading replaced the site shell. | A loading session context keeps navigation rendered during SDK loading. |
| Header sign-in actions could reject without user feedback. | Awaited account actions with pending state and an actionable error message. |
| The PDF preview used window width despite a narrower desktop document column. | A ResizeObserver measures the document panel and bounds the page width. |
| The upload field had no explicit accessible name or visible focus treatment. | Named input and focus indication on its upload region. |
| Unknown URLs had no recovery page. | Branded 404 with shared navigation and a home action. |
| Source game metadata displayed literal question marks as separators. | Consistent typographic separators. |

Backend behavior was retained and verified with all 47 existing backend tests,
including live local PostgreSQL/RabbitMQ/OCR integration checks. Frontend unit
checks, lint, generated API type consistency and the production build validate the
transport and UI changes. Browser checks cover desktop/mobile navigation, layout
overflow, keyboard controls, delayed-response protection, PDF fixtures, saved
studies, report export, Web Vitals and signed JWT ownership. There are 28 browser
checks across the desktop and mobile projects and 14 frontend unit tests. The provider fixture
uses ephemeral test keys and stubbed Gemini; live Asgardeo login and live Gemini
generation are separate manual checks, as documented in IMPLEMENTATION_STATUS.md.

The initial JavaScript remains about 86 KB gzip. The auth SDK, chess tools and PDF
viewer/worker stay deferred; this redesign adds no animation framework, remote
font service or third-party image dependency.
