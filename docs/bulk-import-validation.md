# Bulk import validation

Validated locally on 2026-10-01 with Node 24.11.1 in `espia-domestico` and the
separate `afiliados-extension` repository. Backend and frontend share the
`espia-domestico` Git repository. No deployment or WhatsApp broadcast was performed.

## Automated checks

| Area | Result | Evidence |
| --- | --- | --- |
| Backend build and lint | Passed | `npm run build`, `npm run lint` |
| Backend unit/API tests | 63 passed | `npm test` |
| PostgreSQL integrations | 4 passed | Catalog, classification profiles, delivery ledger, resend rules |
| Frontend build and lint | Passed, one existing Fast Refresh warning | `npm run build`, `npm run lint`; warning in `WhatsAppBubble.tsx` |
| Frontend bulk import tests | 13 passed | `npm run test:imports` |
| Frontend ad preview tests | 7 passed | `npm run test:preview` |
| Extension regression/DOM integration | 46 passed | `npm test`, actual popup/content/background/collector code with fixture DOM |
| Extension syntax and Firefox lint | Passed, no lint findings | `npm run check`, `npx web-ext lint` |
| Native Firefox/Zen fixture smoke | 7 lanes passed, 6 actual JSON downloads | `npm run test:firefox` in the extension repository |

The backend integration database was separate from the existing local catalog.
The catalog test covers 500 products accepted in one save and 501 rejected
without mutation. Existing test assumptions about automatic group assignment
were updated to match the current explicit-group workflow. The ad music test's
CPU-sensitive polling was changed to a two-second deadline; its concurrency
assertions remain unchanged.

## API and database validation

Run `npm --prefix achadinhos-backend run build` first: the validator loads the
compiled backend from `dist`, so rebuild after changing backend source.
`node scripts/validate-bulk-import.cjs` creates a temporary local PostgreSQL
database, runs all migrations, uses the real authenticated Express routes and
queries the real catalog. Its large classification lane replaces only the Jev
evaluator. It proves:

- 5,000 normalized items accepted with no provider evaluations in parse-only mode.
- 123 evaluations attempted; two controlled provider failures preserve 121 successes.
- Exactly the two failed items retried. Total evaluator calls: 125. Peak concurrency: four.
- All 123 products persisted; offset 100 returns the remaining 23.
- Preview and delivery-history checks retain all 123 items.
- When the extension repository is available, its real manual-card generator and
  full/compact exporter outputs import through the Mercado Livre route. The
  supplied price and `manual_unverified` status survive, with an explicit warning.

Use `--extension-path=/path/to/afiliados-extension` to choose that repository.
Use `--serve` to keep the mock-provider API on port 3100 for browser QA.
Ctrl+C stops after setup or the current request, then removes the server and
database. The script requires local
PostgreSQL credentials with permission to create temporary databases.

## Paid provider smoke

`node scripts/validate-bulk-import.cjs --live --serve` made two real OpenRouter
evaluations using `typesafe/jev-1.13`. Both returned classified offers without
provider errors:

| Product | Relevance | Category |
| --- | --- | --- |
| Live Panela 1 | 59/100 | B |
| Batom vermelho para maquiagem | 0/100 | D |

These two requests prove provider/configuration compatibility. They do not
measure classification accuracy or throughput for a 5,000-product paid run.
The larger lanes use the controlled evaluator and do not incur model charges.

## Collaborative browser validation

The T3 Code browser used the real local frontend and authenticated API, backed
by the isolated PostgreSQL database. Only the classification evaluator was mocked.

- Classified 125 products. Two simulated failures appeared individually.
  Retry produced 125 successes using 127 total calls, with only those two titles
  evaluated twice. Saving all 125 completed in chunks and persisted all 125.
- Classified a further 201 products without failures.
- Started a 401-product file, stopped after 40, selected its first product, then
  continued. The selected original row remained selected. All 401 completed
  using exactly 401 calls, with no duplicate evaluation. Saving all 401 completed.
- Loaded every catalog page: all 649 saved products appeared in the loaded count.
  Review and catalog each rendered 40 rows, with working page controls.
- Created a product group and assigned all 649 products. The UI reported 649
  updates and zero failures. Campaign composition loaded all 649 and showed the
  group count of 649, with 50 products per existing composition page.

The 649 saved products comprise 123 API-fixture products, 125 browser-fixture
products and 401 resumed browser-fixture products. The separate 201-product
classification was not saved. No WhatsApp connection or sender was exercised.

## Multiple keyword and file follow-up

These checks used a new isolated database. The earlier 649-product browser lane
above is a separate population.

- The real API accepted three mixed generic/Mercado Livre payloads containing
  66 raw items. It returned 62 unique valid offers, three duplicates and one
  invalid item, with global indexes and original filename/item positions.
- One controlled provider failure was retried once. The 62 unique products
  required 63 evaluator calls and all 62 persisted. A malformed `broken.json`
  failed preflight with its filename and zero evaluator calls.
- The browser selected files across two picker changes, displayed a malformed
  file and disabled classification without an API request. Removing that file
  restored classification. Three files plus one pasted JSON payload contained
  131 raw items: 126 unique valid products, four duplicates and one invalid item.
- The first browser pass returned 124 successes and two controlled failures.
  The UI displayed per-file outcomes and original failure positions. Retrying
  made exactly two extra calls, preserved the selected original product, and
  finished with 126 successes. Total calls were 128 for 126 unique titles.
- Saving all 126 succeeded. The authenticated catalog API returned 311 products,
  comprising 123 original API fixtures, 62 multi-file API fixtures, and 126
  browser fixtures. Loading the remaining catalog pages displayed all 311.
  Direct PostgreSQL read-back confirmed 311 rows and exactly 126 distinct
  browser-fixture product IDs, with no duplicate browser-fixture rows.

The collaborative browser verified accumulating files, syntax errors and removal
before its desktop automation host disconnected. The remaining classification,
retry, saving and catalog lane ran in local headless Chromium against the same
frontend and isolated API. Only the classification evaluator was mocked.

For a fresh run, build the backend and start
`node scripts/validate-bulk-import.cjs --serve`, then start Vite on port 5273 with
its API proxy pointing at port 3100. Run
`node scripts/validate-multi-file-browser.cjs` with Playwright installed.
`PLAYWRIGHT_MODULE` may point at an existing Playwright installation;
`BULK_QA_CHROMIUM` may select an existing Chromium executable and
`BULK_QA_FRONTEND` may override the frontend URL. Run this browser lane once per
fresh fixture database so controlled first-attempt failures remain predictable.

The extension's seven native lanes used version 0.3.0. Actual popup submissions
tested ANY mode with normalized duplicate phrases and overlapping matches, and
ALL mode with a target shortfall. The target counts combined unique products.
Per-phrase exported-card counts, popup reopening, manual selections and full/
compact output passed. Six actual JSON downloads each held two cards. The
independent review verified chained ID/URL duplicate components across files
retain the earliest occurrence and keep different product sources separate.
The paid provider code was unchanged in this follow-up, so no additional paid
requests were needed beyond the two successful calls recorded above.

## Remaining limits

The native smoke ran in headless Zen 1.22.3b with a fresh profile and an ephemeral
extension copy. It used real browser storage and messaging, content scripts, card
selection, keyword shortfall, partial cancellation, manual entry and full/compact
downloads. Closing and reopening the popup document and reloading the fixture
preserved the basket and last collection. Six native JSON downloads each held
two cards. The report is `afiliados-extension/web-ext-artifacts/firefox-smoke-report.json`.
Only the temporary copy permits localhost fixture origins; production origins
remain restricted to Mercado Livre. The popup document runs in inactive extension
tabs for this smoke, so the native browser action-panel UI is not covered.

Classification progress and completed results remain in page memory until saved.
Keep that page open. A lost network response has unknown evaluation outcome;
the interface preserves earlier successes and excludes unknown items from
automatic paid retries. The global concurrency limit is four per API process,
so multiple replicas can together make more than four requests.

The extension collects up to 500 matched products and holds up to 500 manually
selected products. It searches the currently open hub's visible product stream
with an accent/case-insensitive phrase filter, within scroll and ten-minute
bounds. It does not search the entire Mercado Livre catalog. Storage capacity
can impose a lower practical limit on full HTML evidence exports.

Fresh signed-in Mercado Livre share generation has not been verified in this
run. The collaborative browser reached the Mercado Livre login screen, so it
does not have the signed-in affiliate session. Fixture tests exercise selection, keyword filtering, cancellation,
persistence and export, and existing attribution regressions cover MLB/MLBU
share evidence. A real signed-in hub check remains the external acceptance gap.
