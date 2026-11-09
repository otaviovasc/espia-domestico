# Daily product selection and delivery

Working implementation and research, 2026-11-09. This is local work, not a deployment or proof of unattended delivery.

Local verification during review iteration: backend 196 passed/1 skipped; daily PostgreSQL integration 24 passed; existing Smart PostgreSQL integration 15 passed; focused checks cover classification, description ingestion, political rejection and browser checkpoints. Existing delivery-ledger, catalog, classification-profile and AI-budget integration suites also passed (six tests across four suites). Chromium fixture passed both on the host and inside the rebuilt worker image with networking disabled. Build, type check, lint and diff whitespace checks passed; extension 83 passed plus syntax checks. A separate image check confirmed `/app/.env` and the private session directory were absent. This does not establish Railway acceptance or a provisioned worker login.

## User requirements

- Collect new Mercado Livre affiliate offers daily for `domestica` and `masculino`.
- Deliver every day, 08:00–19:00 America/Sao_Paulo, with 20–25 minutes between products **per audience**.
- Prioritize products that fit the audience and have observed demand; exclude politics. Investigate sales history and current-day evidence.
- Reuse the current architecture, minimize cost, and review implementation and strategy independently.

## Implemented approach

Keep the existing Railway worker, PostgreSQL scheduler, Smart classifier, guarded AI budgets, catalog, and durable WhatsApp delivery ledger. Launch Chromium only while collecting, using the extension's existing DOM/share controls. No new queue, Redis, undocumented Mercado Livre affiliate API, or always-on browser service is required.

Daily automation is disabled by default. A JSON configuration identifies the exact account; only already-enabled and group-bound `domestica` and `masculino` audiences are eligible. Authentication is loaded from a private Playwright storage-state file; successful collection atomically persists rotated cookies and IndexedDB with mode 0600. An optional CDP endpoint permits a separately provisioned hosted browser. Creating provider sessions and exporting the T3 browser's session are not implemented by the CDP option.

Collect at 06:00; default 100 candidates per audience. Exclude previously delivered, pending, and uncertain Mercado Livre product IDs before share generation. Imports retain observation time, prices, commissions, and product identity. Collected observation payloads, excluding unused raw HTML, remain in the daily run as immutable retry inputs and historical observations. File audiences remain weak priors for classification. Daily plans route each candidate only to its highest-fit audience, preventing unisex products from occupying both daily selections; manual plans retain their existing secondary-fit routing.

The current 11-hour window produces a target of 30 selected products per audience. Spread slots over 08:00–18:58; the two-minute end buffer accommodates polling/account spacing. Every adjacent nominal gap is within 20–25 minutes. Send-time safety can defer or skip slots; no scheduler can guarantee an exact cadence through provider outages. Daily offers expire at 19:00 and are not moved into tomorrow's window.

A real-sender/PostgreSQL simulation of the 09:20 late schedule delivered all 58 approved sends under 30-second polling and five-second mocked acceptance latency, before 19:00 with per-audience gaps of 20–25 minutes. This supports the tested polling/latency scenario, not arbitrary delays or live WhatsApp availability.

Daily category limits are soft diversity preferences: if they prevent the minimum despite sufficient qualified inventory, analysis fills from qualified reserves and records a warning. No quality threshold is relaxed. Completed audiences are checkpointed separately, so the 22-minute collector deadline does not discard an earlier audience's observations; retries collect only missing audiences. Collection timing and worker resource use still require live measurement. Retry counters reset at the collection and first-plan checkpoints, preserving a separate bounded budget for post-plan failures.

Each account/local-date has one PostgreSQL run and a stable UUID. Durable payloads, expiring/fenced leases, and lookup by request ID recover restarts and the crash after plan creation. Browsing and analysis do not block send ticks. Collection failures have at most three total attempts (two retries) with a 15-minute backoff; expired authentication is held rather than retried indefinitely. Analysis failures retain the existing Smart retry controls and AI budgets.

With `autoApprove:false`, the normal Smart review remains necessary. With `autoApprove:true`, only plans with enough qualified inventory in both audiences are approved. Approval recalculates the remaining capacity without adding a second lead interval, trims lowest-ranked unpinned picks when necessary, and rechecks cross-plan product history under the account lock. Delivery repeats that novelty check and rechecks date/window/freshness after image preparation immediately before transport. By default, a full window needs at least 28 selected products per audience; otherwise hold in REVIEW instead of filling gaps with weak offers. An explicit `requireFullWindow:false` permits a smaller inventory. Prior unapproved auto-approved-mode plans are canceled on the next date; uncertain sends and operator pauses are not automatically resolved.

An operator may explicitly approve a qualified partial day from REVIEW; only automatic approval enforces the full-window minimum. Both approval modes retain the daily time envelope, freshness, quality and novelty checks. Newly conflicting products are removed before scheduling if sufficient eligible inventory remains. Manual early-start controls cannot bypass the daily start. Sparse nonempty collections still use bounded classification to permit this human recovery path; empty/partial collections get at most three collection attempts without paid analysis.

## Quality selection

Daily plans force political exclusion at collection, classification eligibility, and send-time checks. Browser and backend use the same vendored text detector, including conservative handling of ambiguous names and culinary terms. The existing classification request also requires a structured `political` assessment; a positive flag is retained on the plan item and blocks selection and approval when exclusion is enabled. Older persisted analyses can lack this flag and remain unknown; new provider responses must supply it. Neither layer establishes a seller's political views or guarantees detection of imagery/slogans; no image inspection or measured classifier accuracy is claimed. Default minimums: observed rating 4.5/5, observed accumulated sales 100, AI audience fit 80/100, commercial score 60/100. Missing ratings/sales remain unknown and do not pass these daily gates. Rating/sales and explicit time-limited-deal failures are removed before share-link generation. Attribution, commission, freshness, political and quality failures are removed before paid classification and retained as rejected evidence.

The daily score is: 50% audience fit, 25% observed demand, 15% observed discount, 5% freshness, 3% current-date/seasonal fit, 2% commission opportunity. Demand uses logarithmic accumulated-sales evidence, customer rating, and an observed best-seller badge. This prevents a higher affiliate payout from dominating audience fit or demand. These are initial heuristics, **not measured conversion probabilities or an optimized sales model**. Existing manual plans keep their original weighting.

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

Provision a private worker session; choose the actual user/group bindings; build/test Chromium on Railway; migrate the new table; perform a collection-only dry run; inspect ranked picks and shortages; then enable the configured cycle. No production database changes, deployment, purchase, or WhatsApp send has been performed by this work.

## Reviewed operation refinements

The default collection starts at 06:00 to leave two hours before business hours. A run finishing on time still starts at 08:00; a later approval starts at the next available minute. With a full-window minimum of 28, after approximately 09:58 the default window is no longer feasible: automatic full-window runs expire with `LATE_ANALYSIS` before collecting or starting paid work. Approval capacity is also recalculated atomically. Sparse inventory remains an explicit review hold rather than weak filler.

The daily date/time envelope is explicit and separate from the existing manual early-start override. Any cadence, disabled-audience, competing-manual-campaign or daily-cap deferral that would leave the daily window becomes SKIPPED immediately; it does not leave an overnight pending reservation.

Two existing active Smart plans cause `OPERATOR_ATTENTION / ACTIVE_PLAN_LIMIT` before browser/AI allocation. UNKNOWN provider outcomes still require a person; daily automation never silently replays them. Persistent AppError 4xx responses become terminal attention holds with their error code, rather than three indistinguishable retries. A failed analysis becomes `ANALYSIS_HOLD`: no automatic paid replay occurs, but an explicit Smart UI retry rejoins the same run. A malformed daily config disables only daily orchestration; existing sends remain available. Graceful collection shutdown best-effort releases its token-fenced lease.

Prices are morning observations, not live quotes. Daily captions state the observation date/time and ask the recipient to confirm the current price in the link; explicitly labelled flash/countdown deals are excluded. Regular prices can still change intraday. There is no pre-send Mercado Livre price refresh in this version, and the 24-hour freshness ceiling alone does not establish an unchanged price.

Commercial-score minimum 60 permits a strong, relevant, well-reviewed product without a discount. Thresholds and weights remain initial heuristics until a ranked dry run measures audience yield and affiliate tracking calibrates conversion. Default standout-copy calls are disabled (`maxStandouts:0`). At 200 candidates, approximately 50 four-product batches is the initial batching estimate before accounting for deterministic rejection. Malformed-batch recovery is additional: a four-product batch can split into two pairs and four singles (six recovery requests, seven total before transport retries). Existing spend/request guards remain in force; measure initial, recovery and transport requests separately, along with traffic and qualifying yield. The browser-only cost illustration is not a total automation bill.

## Bounded operating choices

Item-only review edits recompute preview times and remove slots from deselected items; approval still recalculates the actual schedule. An effective daily window with no valid sending minutes stays closed instead of widening to the manual 09:00–21:00 defaults.

A collection that never obtains a nonempty payload for one audience does not create a plan. Completed audiences remain checkpointed and only missing audiences retry, at most three collection attempts; an operator can repair collection and rearm the same run. Partial-day Smart approval applies to plans whose collected candidates have reached analysis, including an audience emptied by quality/classification gates. It is not automatic salvage from an incomplete browser collection.

Preview and non-full-window modes intentionally retain the configured candidate bound for ranked human review, even late in the day. They can cost more per usable slot; candidate limits should be reduced by the operator after measuring yield. No cross-day negative-classification cache was added. Legacy SCHEDULED/RUNNING campaign conflicts conservatively reserve the bound groups regardless of scheduled date, matching the existing approval contract; pause or complete the competing campaign before rearming.

Historical exclusions are bounded at 50,000 canonical identities including collection headroom, but currently read historical delivery IDs and eligible Smart offer snapshots before deduplication. The browser and backend rating/sales parsers remain separate implementations with parity regressions; only the political text detector is single-sourced. Catalog-only MLBU URLs without an attributable seller listing can consume an unsuccessful share attempt; widening listing-identity acceptance alone would not establish affiliate ownership. These are measured-yield and optimization boundaries for the first worker trial, not claims of production capacity.

Live changes to semantic political settings for ordinary manual Smart plans are outside this daily feature. Daily plans force exclusion at collection and analysis, preserve the required semantic result, and reject positive results during selection and approval. No classifier accuracy or political-image guarantee is inferred from that contract.

Cadence configuration uses the same buffered duration for target, minimum and nominal capacity. For example, a 24–25 minute range selects 28 products rather than targeting fewer than the full-window minimum. Full-window configurations that cannot span that duration within their exact gap range are rejected at startup; explicit partial-window configurations still fit their nominal capacity. A saved current-date run is loaded before checking startup collection/weekday eligibility, so changing a valid configuration for tomorrow cannot delay today's resumed run. Disabling daily automation still disables the daily scheduler path.

Review previews also refresh when immediate start is toggled, using the same daily floor and current-time interpretation as approval. Every recomputed preview slot must fit its evidence freshness limit; stale selections return the existing refresh-evidence error before the edited plan is saved. Approval retains its independent final scheduling/freshness checks. The existing approval revision fence already rejects concurrent committed item edits before its preflight audience set is used.

Approval rechecks each group's audience ownership under the audience-row locks, alongside the combined destination set. A concurrent addition of another audience's group, or a swap of existing groups, invalidates preflight and returns `SMART_BINDINGS_CHANGED` before creating sends. The PostgreSQL regression injects both changes between external group preflight and the locked binding read and confirms the plan stays in REVIEW with no sends.

Final preview preparation fixes: late review edits trim weakest unpinned selections to the remaining daily capacity, just as approval does; an inherited manual immediate-start flag no longer blocks moving items from yesterday to today. Explicitly enabling immediate start still requires today. UNKNOWN retries must fit the original daily envelope before any ledger deletion; an out-of-window retry preserves UNKNOWN and its duplicate barrier, and the operator can conservatively settle it with sent/skip.
