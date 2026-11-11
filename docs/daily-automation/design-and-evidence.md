# Daily product selection and delivery

Implementation and deployed preview, 2026-11-09. API and worker are deployed, the migration and private session are provisioned, and Railway Chromium access/collection smoke tests pass. Automatic approval remains off; full inventory yield and unattended delivery are unproven.

Local verification during review iteration: backend 196 passed/1 skipped; daily PostgreSQL integration 24 passed; existing Smart PostgreSQL integration 15 passed; focused checks cover classification, description ingestion, political rejection and browser checkpoints. Existing delivery-ledger, catalog, classification-profile and AI-budget integration suites also passed (six tests across four suites). Chromium fixture passed both on the host and inside the rebuilt worker image with networking disabled. Build, type check, lint and diff whitespace checks passed; extension 83 passed plus syntax checks. A separate image check confirmed `/app/.env` and the private session directory were absent. Those were local receipts. The deployed acceptance below separately proves Railway runtime and worker login access.

## User requirements

- Collect new Mercado Livre affiliate offers daily for `domestica` and `masculino`.
- Deliver every day, 08:00–19:00 America/Sao_Paulo, with 20–25 minutes between products **per audience**.
- Prioritize products that fit the audience and have observed demand; exclude politics. Investigate sales history and current-day evidence.
- Reuse the current architecture, minimize cost, and review implementation and strategy independently.

## Implemented approach

Keep the existing Railway worker, PostgreSQL scheduler, Smart classifier, guarded AI budgets, catalog, and durable WhatsApp delivery ledger. Launch Chromium only while collecting, using the extension's existing DOM/share controls. No new queue, Redis, undocumented Mercado Livre affiliate API, or always-on browser service is required.

Daily automation is disabled by default. A JSON configuration identifies the exact account; only already-enabled and group-bound `domestica` and `masculino` audiences are eligible. Authentication is loaded from a private Playwright storage-state file; successful collection atomically persists rotated cookies and IndexedDB with mode 0600. An optional CDP endpoint permits a separately provisioned hosted browser. Creating provider sessions and exporting the T3 browser's session are not implemented by the CDP option.

Prepare at 19:00 for D+1; collect in feedback-driven batches with a ceiling of 250 candidates per audience. Exclude previously delivered, pending, and uncertain Mercado Livre product IDs before share generation. Imports retain observation time, prices, commissions, and product identity. Collected observation payloads, excluding unused raw HTML, remain in the daily run as immutable retry inputs and historical observations. File audiences remain weak priors for classification. Daily plans route each candidate only to its highest-fit audience, preventing unisex products from occupying both daily selections; manual plans retain their existing secondary-fit routing.

The current 11-hour window produces a target of 30 selected products per audience. Spread slots over 08:00–18:58; the two-minute end buffer accommodates polling/account spacing. Every adjacent nominal gap is within 20–25 minutes. Send-time safety can defer or skip slots; no scheduler can guarantee an exact cadence through provider outages. Daily offers expire at 19:00 and are not moved into tomorrow's window.

A real-sender/PostgreSQL simulation of the 09:20 late schedule delivered all 58 approved sends under 30-second polling and five-second mocked acceptance latency, before 19:00 with per-audience gaps of 20–25 minutes. This supports the tested polling/latency scenario, not arbitrary delays or live WhatsApp availability.

Daily category limits are soft diversity preferences: if they prevent the minimum despite sufficient qualified inventory, analysis fills from qualified reserves and records a warning. No quality threshold is relaxed. Completed audiences are checkpointed separately, so the 22-minute collector deadline does not discard an earlier audience's observations; retries collect only missing audiences. Collection timing and worker resource use still require live measurement. Retry counters reset at the collection and first-plan checkpoints, preserving a separate bounded budget for post-plan failures.

Each account/local-date has one PostgreSQL run and a stable UUID. Durable payloads, expiring/fenced leases, and lookup by request ID recover restarts and the crash after plan creation. Browsing and analysis do not block send ticks. Collection failures have at most three total attempts (two retries) with a 15-minute backoff; expired authentication is held rather than retried indefinitely. Analysis failures retain the existing Smart retry controls and AI budgets.

With `autoApprove:false`, the normal Smart review remains necessary. With `autoApprove:true`, only plans with enough qualified inventory in both audiences are approved. Approval recalculates the remaining capacity without adding a second lead interval, trims lowest-ranked unpinned picks when necessary, and rechecks cross-plan product history under the account lock. Delivery repeats that novelty check and rechecks date/window/freshness after image preparation immediately before transport. By default, a full window needs at least 28 selected products per audience; otherwise hold in REVIEW instead of filling gaps with weak offers. An explicit `requireFullWindow:false` permits a smaller inventory. Prior unapproved auto-approved-mode plans are canceled on the next date; uncertain sends and operator pauses are not automatically resolved.

Automatic approval always approves the qualified selection, including a partial or late day (policy change 2026-11-11, after a 30/30 plan stalled on `DAILY_NOVELTY_CONFLICT`). Both approval modes retain the daily time envelope, freshness, quality and novelty checks. Newly conflicting products are removed before scheduling; automatic approval replaces them with qualified, non-conflicting reserves. Manual early-start controls cannot bypass the daily start. Sparse nonempty collections still use bounded classification to permit this human recovery path; empty initial collections advance their finite keyword inventory without paid analysis; network failures retain bounded retries.

## Quality selection

Daily plans force political exclusion at collection, classification eligibility, and send-time checks. Browser and backend use the same vendored text detector, including conservative handling of ambiguous names and culinary terms. The existing classification request also requires a structured `political` assessment; a positive flag is retained on the plan item and blocks selection and approval when exclusion is enabled. Older persisted analyses can lack this flag and remain unknown; new provider responses must supply it. Neither layer establishes a seller's political views or guarantees detection of imagery/slogans; no image inspection or measured classifier accuracy is claimed. Default minimums: observed rating 4.5/5, observed accumulated sales 100, AI audience fit75/100, commercial score 60/100. Missing ratings/sales remain unknown and do not pass these daily gates. Rating/sales and explicit time-limited-deal failures are removed before share-link generation. Attribution, commission, freshness, political and quality failures are removed before paid classification and retained as rejected evidence.

The daily score is:40% audience fit,20% observed demand,10% observed discount,20% sellability-adjusted commission in reais,5% freshness,3% seasonal fit and2% assortment evidence. Demand uses logarithmic accumulated-sales evidence, customer rating, and an observed best-seller badge. Hard audience/evidence gates remain independent of payout. Price-band quotas prevent ranking from excluding either affordable or premium qualified stock. These are initial heuristics, **not measured conversion probabilities or an optimized sales model**. Existing manual plans keep their original weighting.

Evidence limitations:

- A `+50mil vendidos` card is an accumulated lower bound, not 50,000 sales today. The live label exposed a parser gap; support for `mil`, `k`, and `milhões` was added with tests.
- Rating count, seller quality, returns, and review recency are not currently captured. A high aggregate rating can have limited confidence.
- Existing calendar-aware classification supplies current-date relevance. No unsupported claim of real-time trending or exact daily sales is added.
- Daily payload history is available for future comparisons, but changes between two rounded lower bounds do not establish an exact daily sales velocity. No such velocity is fabricated or currently scored.
- Own affiliate performance should eventually calibrate audience-specific conversion/ranking, using actual product/audience tracking tags and the actual reporting interval. That feedback integration is still a design question, not implemented proof.

## Live checks

Both clean repositories pulled with `git pull --ff-only`:

- app baseline `668ba83c9dda9b2dfcac58cf88d12796a609591e`
- extension baseline `cf973960f0172251632f2817510367252471b1b9`

Railway project `espia` has successful latest deployments for frontend, backend, dedicated worker, and PostgreSQL. No browser/proxy service exists in this project. Worker static outbound IP and IPv6 were disabled when checked. Marketplace Browserless templates exist, but are not deployed services or residential proxy entitlements. A Railway reverse/TCP proxy does not itself provide residential browser egress.

Mercado Livre email verification completed in the shared T3 browser. A real signed-in hub collection exported three cards with current prices, displayed commissions, and three commissioned links with `generated_from_page_state`. This proves the current share/extractor flow in that session. It does not prove Railway egress, transferable cookie state, cross-day unattended operation, paid classifier accuracy, or message delivery.

A later read-only check observed 18 hub cards and sampled eight. All eight exposed rating and accumulated-sales text that the actual backend parser successfully read: ratings 4.8–5.0 and cumulative lower bounds from 10,000 to 750,000. This confirms those signal formats on the sampled live cards, not fresh qualified inventory for both audiences over multiple days.

The account's affiliate Metrics page is accessible and exposes tracking-label controls and product/sale/commission/status table columns. Its initial URL covered the previous week ending at the current day's midnight; this is not current-day evidence. No private sales rows or account credentials are included here.

## Lowest-cost browser options

Sources checked 2026-11-09; actual Mercado Livre success and traffic must be measured before buying a plan.

| Option | Current advertised price | Fit and limits |
| --- | --- | --- |
| Chromium inside existing Railway worker | Actual RAM/CPU/egress only | Recommended first test. No extra browser subscription; launch only for bounded collection. Datacenter egress may prompt login/challenges. |
| Browser Use hosted browser | $0.02/browser-hour; own/direct traffic $0.20/GB or home-IP proxy $5/GB | Attractive usage-based fallback, without an LLM browsing agent. Requires a provider account/session lifecycle integration before unattended use. |
| Browserbase Free | $0; 1 browser hour, 15 minutes/session | Prototype allowance. At 10–20 minutes daily this is insufficient for a month. |
| Browserbase Developer | $20/month; 100 browser hours and 1GB proxies | Easier managed persistence/debugging, higher fixed minimum. |
| Browserless Free | $0; 1,000 units/month; free BaaS session limit 2 minutes | Useful for short tests; session length is a poor fit for the current collector's possible 10-minute scan per audience. Proxy traffic also consumes units. |
| Browserless hosted paid | starts at $25/month | Useful CDP alternative; not the cheapest starting point here. |

Railway documents $10/GB-month RAM and $20/vCPU-month CPU. Illustrative **incremental compute**, assuming 1GB RAM and 0.5 vCPU for 20 minutes/day, is about $0.28/month, plus traffic/storage and the existing subscription. This is a workload estimate, not a measured bill. Browser Use under the same 10-hour/month scenario is $0.20 browser time plus traffic/proxy charges. Residential traffic can dominate both.

First test direct Chromium from Railway using a properly provisioned session. Add a paid proxy only after an observed access failure requires it. A proxy may not preserve login or prevent challenges; rotating addresses can also cause reauthentication.

## Primary references

- [Railway resource pricing](https://docs.railway.com/pricing/plans)
- [Railway cron semantics](https://docs.railway.com/cron-jobs): a cron collector is an alternative, but the existing sender must stay available throughout the day.
- [Browser Use pricing](https://browser-use.com/pricing)
- [Browserbase pricing](https://www.browserbase.com/pricing) and [persistent contexts](https://docs.browserbase.com/platform/browser/core-features/contexts)
- [Browserless pricing](https://www.browserless.io/pricing) and [BaaS limits](https://docs.browserless.io/baas/start)
- [Mercado Livre best-seller highlights API](https://developers.mercadolivre.com.br/pt_br/mais-vendidos-no-mercado-livre): official top-20 category/item/product rankings require an API access token; affiliate browser sign-in is not that OAuth credential. A 404 can mean an existing product is outside the available ranking.
- [Affiliate metrics](https://www.mercadolivre.com.br/l/afiliados-entenda-suas-metricas), [audience/performance guidance](https://www.mercadolivre.com.br/l/afiliados-conheca-seu-publico), and [affiliate FAQ](https://www.mercadolivre.com.br/l/primeiros-passos-perguntas-frequentes-para-afiliados). Official pages describe differing refresh intervals (24 hours versus 3 hours); use an observed reporting timestamp rather than promising real-time attribution.

## Remaining deployment gates

The API/worker release, daily table migration, private session, exact existing account/group bindings, Railway Chromium fixture and live collection smoke are now complete. The limited smoke produced one verified masculino affiliate offer and no domestica offers: among 216 discovered domestica snapshots, 97 were excluded by history, and all five remaining keyword-matched snapshots failed the existing commission range. This does not measure the default250-candidate run. Next, inspect ranked inventory from the scheduled preview and measure qualifying yield and total browser/AI cost. Subsequent supervised testing completed live classification and one provider-accepted WAP drill send. A40-product adjusted-filter preview selected18 domestica and16 masculino offers, then was cancelled without sends. Classifier malformed responses and inconsistent fit scores remain observed limitations.

## Reviewed operation refinements

The default D+1 preparation starts at19:00 for the following local date, keeping evidence within24hours through the following sending window. Legacy same-day mode remains explicit. A prepared D+1 plan starts at 08:00. It requires 30 items per audience and blocks automatic approval after that first slot is missed. Explicit legacy same-day mode retains its remaining-capacity checks and 28-item minimum. Approval capacity is also recalculated atomically. Sparse inventory remains an explicit review hold rather than weak filler.

The daily date/time envelope is explicit and separate from the existing manual early-start override. Any cadence, disabled-audience, competing-manual-campaign or daily-cap deferral that would leave the daily window becomes SKIPPED immediately; it does not leave an overnight pending reservation.

Two existing active Smart plans cause `OPERATOR_ATTENTION / ACTIVE_PLAN_LIMIT` before browser/AI allocation. UNKNOWN provider outcomes still require a person; daily automation never silently replays them. Persistent AppError 4xx responses become terminal attention holds with their error code, rather than three indistinguishable retries. A failed analysis becomes `ANALYSIS_HOLD`: no automatic paid replay occurs, but an explicit Smart UI retry rejoins the same run. A malformed daily config disables only daily orchestration; existing sends remain available. Graceful collection shutdown best-effort releases its token-fenced lease.

Prices are preparation-time observations, not live quotes. Observation timestamps remain internal and are omitted from daily captions; explicitly labelled flash/countdown deals are excluded. Regular prices can still change intraday. There is no pre-send Mercado Livre price refresh in this version, and the 24-hour freshness ceiling alone does not establish an unchanged price.

Commercial-score minimum 60 permits a strong, relevant, well-reviewed product without a discount. Thresholds and weights remain initial heuristics until a ranked dry run measures audience yield and affiliate tracking calibrates conversion. Default standout-copy calls are disabled (`maxStandouts:0`). At the maximum 500 candidates across both audiences, approximately 125 four-product batches is the initial batching estimate before accounting for deterministic rejection. Malformed-batch recovery is additional: a four-product batch can split into two pairs and four singles (six recovery requests, seven total before transport retries). Existing spend/request guards remain in force; measure initial, recovery and transport requests separately, along with traffic and qualifying yield. The browser-only cost illustration is not a total automation bill.

## Bounded operating choices

Item-only review edits recompute preview times and remove slots from deselected items; approval still recalculates the actual schedule. An effective daily window with no valid sending minutes stays closed instead of widening to the manual 09:00–21:00 defaults.

A collection that never obtains a nonempty payload for one audience does not create a plan. Completed audiences remain checkpointed and only missing audiences expand keyword pages; network failures have a bounded retry budget; an operator can repair collection and rearm the same run. Partial-day Smart approval applies to plans whose collected candidates have reached analysis, including an audience emptied by quality/classification gates. It is not automatic salvage from an incomplete browser collection.

Preview and non-full-window modes intentionally retain the configured candidate bound for ranked human review, even late in the day. They can cost more per usable slot; candidate limits should be reduced by the operator after measuring yield. No cross-day negative-classification cache was added. Legacy SCHEDULED/RUNNING campaign conflicts conservatively reserve the bound groups regardless of scheduled date, matching the existing approval contract; pause or complete the competing campaign before rearming.

Historical exclusions are bounded at 50,000 canonical identities including collection headroom, but currently read historical delivery IDs and eligible Smart offer snapshots before deduplication. The browser and backend rating/sales parsers remain separate implementations with parity regressions; only the political text detector is single-sourced. Catalog-only MLBU URLs without an attributable seller listing can consume an unsuccessful share attempt; widening listing-identity acceptance alone would not establish affiliate ownership. These are measured-yield and optimization boundaries for the first worker trial, not claims of production capacity.

Live changes to semantic political settings for ordinary manual Smart plans are outside this daily feature. Daily plans force exclusion at collection and analysis, preserve the required semantic result, and reject positive results during selection and approval. No classifier accuracy or political-image guarantee is inferred from that contract.

Cadence configuration uses the same buffered duration for target, minimum and nominal capacity. For example, a 24–25 minute range selects 28 products rather than targeting fewer than the full-window minimum. Full-window configurations that cannot span that duration within their exact gap range are rejected at startup; explicit partial-window configurations still fit their nominal capacity. A saved current-date run is loaded before checking startup collection/weekday eligibility, so changing a valid configuration for tomorrow cannot delay today's resumed run. Disabling daily automation still disables the daily scheduler path.

Review previews also refresh when immediate start is toggled, using the same daily floor and current-time interpretation as approval. Every recomputed preview slot must fit its evidence freshness limit; stale selections return the existing refresh-evidence error before the edited plan is saved. Approval retains its independent final scheduling/freshness checks. The existing approval revision fence already rejects concurrent committed item edits before its preflight audience set is used.

Approval rechecks each group's audience ownership under the audience-row locks, alongside the combined destination set. A concurrent addition of another audience's group, or a swap of existing groups, invalidates preflight and returns `SMART_BINDINGS_CHANGED` before creating sends. The PostgreSQL regression injects both changes between external group preflight and the locked binding read and confirms the plan stays in REVIEW with no sends.

Final preview preparation fixes: late review edits trim weakest unpinned selections to the remaining daily capacity, just as approval does; an inherited manual immediate-start flag no longer blocks moving items from yesterday to today. Explicitly enabling immediate start still requires today. UNKNOWN retries must fit the original daily envelope before any ledger deletion; an out-of-window retry preserves UNKNOWN and its duplicate barrier, and the operator can conservatively settle it with sent/skip.

## First deployed preview acceptance, 2026-11-09

Task-only commits were uploaded directly to the existing Railway API/worker with daily automation disabled. The daily migration is applied, API health returns 200, both services' SmartCampaignService source hashes match the release, and the actual Railway worker passes the Chromium collector fixture. A new private /data volume stores the user-authorized Zen Mercado Livre session at mode 0600. The interactive fresh-login attempt hit Mercado Livre's attempt limit and was stopped; no login retry was submitted afterward.

A controlled Railway comparison using the same session got 403/no cards with Chromium's default HeadlessChrome user-agent, then 200 with 18 hub cards using the normal Chrome user-agent for the actual installed Chromium version. The collector now uses that compatible user-agent, with its network request header verified by the real Chromium fixture. One-page acceptance used about 423 MB of total container memory while the browser was open; this is not a full collection-cycle memory/cost measurement. Ranked inventory, paid classification yield and delivery remain separate tests.


## D+1 preparation and value rule

The current implementation prepares tomorrow at19:00 today. Full readiness means30 qualified scheduled items per audience (60total),08:00 through18:58, with every nominal gap in20–25minutes. An incomplete pool expands keyword pages and appends unseen candidates with durable per-round receipts, up to250per audience/500total. Completed observations and AI results survive restarts; normal replenishment is not presented as a final shortage. Missing inventory, access or pipeline failures are reported to the configured Loja Geral operations group. A full-window automatic approval is blocked once08:00 is missed.

Gross payout is actual price times commission fraction. Ranking uses:

`easeIndex = (0.4 + 0.6 × demandScore/100) × (0.5 + 0.5 × fit/100) / sqrt(1 + priceBRL/250)`

`adjustedCommissionBRL = grossCommissionBRL × easeIndex`

`commissionScore = min(100,100 × log(1 + adjustedCommissionBRL)/log(31))`

This is an explicit initial ranking heuristic, not a trained conversion/revenue estimate. Thus R$1000at3% has grossR$30, while R$20at20% has grossR$4; the former receives a price difficulty discount instead of being rejected for a low percentage. For equal gross payout and equal evidence/fit, the cheaper product ranks higher on this component. At least20% of slots at each price end (<=R$100 and>R$500) are preferred when qualified stock exists, with score-based fill and interleaving. No price-band shortage excludes otherwise qualified products.

Alerts use a unique persisted event key, pre-provider claim, typed safe facts and a retainedUNKNOWN barrier. They cover preparation, pre-send readiness and sender outcomes, with an independent scheduler task. These improve detection; they are not proof that a dead worker, unavailable database or disconnected WhatsApp can report itself.

The source changes and local regression receipts for this release are separate from production acceptance. The current release's live status is retained under `/tmp/espia-daily-automation-20261109/d1-release/`. No new council round was requested or started.
