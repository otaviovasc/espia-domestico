# Smart Campaigns

Implemented 2026-10-15. Original audit/design: [smart-campaigns-plan.md](smart-campaigns-plan.md).

## Operator flow

1. Open `/painel/smart-campaigns` and bind each audience to its actual WhatsApp group(s). DOMESTICA/MASCULINO are initially enabled; NATAL/PESCA/PET are seeded inactive. These are internal audiences, not automatically created WhatsApp groups.
2. Check the audience instructions, exclusion rules, commission floors, daily cap and end time. DOMESTICA covers home, beauty, self-care and women's accessories. Existing custom classification profiles are preserved.
3. Choose a date and generate keyword packs. Prefer **Copiar preset da extensão** and apply it in the updated extension's Smart Campaign preset section. Applying a preset fills the filters; it never starts collection.
4. Run collection in the authenticated affiliate hub. Import full/compact JSON by pasting or uploading multiple files. Source timestamps, keyword evidence and attribution status are preserved.
5. Review selected/reserve/rejected products, explanations, estimated payout per eligible sale, freshness, proposed times and standout text. Removing or selecting an offer uses optimistic revision checks. Hard commercial/attribution/fit requirements remain enforced on approval.
6. Approve. The dedicated worker executes persisted destination tasks and exposes progress. Pause the plan or disable an audience to stop its future sends. Already initiated provider calls cannot be recalled.

## Search behavior

The extension examines discovered cards in the affiliate hub. It does not submit the generated keywords to Mercado Livre's global search engine. Use the hub's own navigation/category/filter controls to expose relevant inventory before collecting.

Native legacy searches default to accent/case-insensitive substring matching. Smart presets use `matchStyle: "word"`, with accent/case-insensitive lexical boundaries and `matchMode: "any"`. Thus `pet` does not find `tapete`, and `ração` does not find `decoração`. Complete singular/plural words are generated deliberately; stems do not work in whole-word mode. Short phrases remain useful when a single word is ambiguous. ANY alternatives are appropriate for a mixed collection; ALL requires every supplied term on the same card.

When the extension records which search terms matched a product, the classifier receives up to six as weak collection context. The product's own title/description must still support a niche match; a keyword alone never assigns a product to an audience.

Smart packs contain at most 20 keywords (generated packs normally at most 12). The existing native collector still supports 100 phrases. Backend evidence accepts that native limit; no provenance is silently dropped at 20.

The calendar supplies bounded, sourced preparation windows for Christmas, New Year, Mother's/Father's Day, Black Friday and World Animal Day. Calendar relevance is not evidence of live demand, product availability or delivery dates. There is no invented sales conversion or shipping promise.

## Selection and scheduling

- Transparent commercial ranking: affinity 40%, observed offer value 20%, commission opportunity 15%, seasonality 10%, freshness 10%, marketplace rating/sales signal 5% when observed (75/100 neutral fallback). Marketplace popularity never replaces audience fit and does not establish sales in the target WhatsApp group. It is a starting policy, not a proven sales optimum.
- Automatic fit floor: 70/100. Primary routing chooses the strongest niche; a secondary niche requires at least 85 and a score within 10 of the primary. Products do not go to every selected audience.
- Estimated commission is current observed price × displayed commission rate. The Mercado Livre export's structured rate is normalized and retained through review. This is an estimate per eligible sale, not expected profit. Actual conversions, eligibility and cancellations are not inferred.
- No automatic use of unverified/non-affiliate links, missing observation times or expired commercial evidence. Original marketplace prices are not treated as verified price history.
- Up to three standout introductions per audience/day by default. Other offers use the existing template. Verified fields supply prices, coupons and affiliate links.
- Maximum 50 selected products per audience/local day. The actual WhatsApp destination also has a 50-message daily ceiling shared with legacy sends, so audiences mapped to the same group share that group's available capacity. Start is 09:00; closing is at or before 21:00, exclusively. Normal gaps are 720–960 seconds. Deterministic bounded slots fit the window; 50 is a ceiling, never a requirement to include weak products.
- The same connection also has a short account-wide throttle. Each group's 12–16 minute cadence is independent, so five audiences do not wait on one global 15-minute loop.
- Late approval uses future feasible slots; it never backdates or bursts to catch up. Downtime/provider delays can make real gaps longer than 16 minutes. Excess/stale work is deferred or skipped rather than sent at night.
- Commercial evidence has a hard maximum age of 24 hours. Planning up to three days is supported, but later sends need evidence valid at their scheduled time. There is no server-side live ML price/commission refresh yet; reimport updated evidence and create a new plan when needed.
- Approval refuses overlapping active manual campaigns. Manual sends also check smart reservations and configured destination policies before acquiring a delivery claim. Pause/cancel conflicts explicitly; existing production campaigns are not changed by installation.

## Deployment and activation

Apply the three additive migrations before running the new API/worker:

```sh
cd achadinhos-backend
npm run migrate
```

Migrations create `smart_audiences`, `smart_plans`, `smart_sends`, a database-triggered `smart_plan_events` transition history, and application `smart_operation_events` for audience changes, plan actions and UNKNOWN decisions. A persistent `smart_ai_requests` ledger stores request reservations, tenant-scoped cached results and conservative usage accounting. A unique user/request-ID index fences duplicate plan creation. No existing catalog or campaign is deleted. First-use seeding creates missing internal audiences/profiles under a user lock without overwriting existing custom classifiers. Historical product ratings remain stored; they are not silently recomputed.

Configure on both API and worker:

```text
AI_ENABLED=true
OPENROUTER_KEY=<existing server-side key>
AI_INPUT_COST_USD_PER_MILLION=0.20
AI_OUTPUT_COST_USD_PER_MILLION=0.80
CLASSIFICATION_MODEL=deepseek/deepseek-v4.1-flash
SMART_CLASSIFICATION_MODEL=deepseek/deepseek-v4.1-flash
SMART_KEYWORD_MODEL=deepseek/deepseek-v4.1-flash
SMART_COPY_MODEL=deepseek/deepseek-v4.1-flash
```

Automatic model upgrades and SDK retries are disabled. OpenRouter may fail over between providers of the same pinned model under the same price and privacy limits. OpenRouter routing requires supported parameters, denies training-data collection and caps provider prices at the explicit USD-per-million ceilings. Invalid or uncertain responses fail closed and keep their reservation. No model catalog is fetched at startup or page load. All paid endpoints require authentication and an explicit action; page queries, refocus and polling only read stored data.

Use `env.production.api.example` and `env.production.worker.example` as Railway variable templates. Replace domain/secret placeholders and the `Postgres` service reference with your actual service name. Preserve the same database and existing JWT/UAZAPI secrets on both services. Keep `AI_ENABLED=false` while applying migrations; set the real OpenRouter key and explicit price ceilings on both services before enabling. The checked local `.env` preserves existing credentials, disables paid AI and disables the embedded scheduler. Production variables have not been changed by this implementation.

The shared PostgreSQL ledger atomically reserves spend across API and worker processes. Defaults: USD 2/user/day, USD 5/deployment/day, USD 0.02/request, 1,000 requests/user/day, 2M input and 250k output tokens/user/day. Configure all `AI_*` values identically on both services. The quota day is UTC. Seven-day tenant-scoped semantic caching avoids paying again for unchanged classification inputs. Accounting uses conservative configured price ceilings rather than an invoiced cost; a timeout keeps the full reservation and prevents automatic duplicate calls. Failed reservations intentionally require a later quota day to retry identical inputs. These caps cover this product intelligence pipeline; set a separate OpenRouter account credit limit for other consumers of the key.

API: `RUN_SCHEDULER=false`. Dedicated worker: `RUN_SCHEDULER=true` / `npm run worker`. The example local `.env` keeps sending disabled until explicitly enabled. AI analysis runs separately from delivery ticks; durable chunk leases/fencing preserve progress across worker restarts. Restrict old worker instances during rollout so all active senders use the shared policy code.

Initially enable review-required plans for the existing two audiences, then bind and activate the three new ones. Reload the extension and the ML hub to load whole-word matching/preset support. This implementation was validated locally; the audit/implementation did not deploy or alter production records or send messages.

## Uncertain delivery and recovery

UAZAPI acceptance with a message ID is not a read/delivery receipt. A timeout/missing ID after a possible provider call becomes `UNKNOWN`, pauses the plan and retains the delivery barrier. A crashed in-flight lease also becomes UNKNOWN; it is never retried automatically.

The screen asks the operator to check the exact WhatsApp group. The server enforces a minimum five-minute cooling period, also considering the delivery heartbeat/lease. The operator may mark sent, explicitly retry only when absent, or end without retry. Retry atomically releases the matching barrier and schedules a fresh attempt only while evidence is valid; other decisions retain no-repeat protection. Decisions are audited. Failed/exhausted tasks remain paused for cancel/reimport, not a reanalysis of a partially sent plan.

Group binding/connection changes block execution. Disabling one audience defers its pending tasks while other audiences continue. New plans preserve historical no-repeat identities and manual catalog overrides.

## Cost and classifier evaluation

Default model: **`deepseek/deepseek-v4.1-flash`**, with reasoning disabled and four-product batches. The production-equivalent 24-product test returned 0 false positives / 0 false negatives on 110 clear labels, 86.67% range agreement, and USD 0.006830 reported cost (11,408 input / 8,261 output tokens). This is about USD 0.0285 per 100 similar products, approximately 70% less than the historical refined GPT-4.1 run. A separate eight-product holdout scored 90% range agreement with 0 false positives / 0 false negatives on 36 clear labels. Five-audience keyword packs, standout copy and the manual relevance schema also passed live smoke tests. The holdout plus those schema smokes cost USD 0.001823. Keywords and standout messages are separate operations. Actual costs vary with description length, provider and response length; the configured price ceilings deliberately reserve more than this observed cost.

Classification responses use required object keys for each product ID and requested audience. This makes omissions, extra audiences and duplicate list entries invalid at the provider boundary; validated replies are normalized to the existing analysis arrays before caching or persistence. Classification request cache versions are bumped to `v3`; keyword and copy caches retain `v2`. Failed analyses preserve completed chunks for the operator's retry. Schema failures report `structured_output` and bounded validation paths/codes, without logging product descriptions or provider response bodies.

Current reproducible results and rejected candidates: [modern model benchmark report](smart-classification-benchmark-2026-10-15-modern.json). These small synthetic fixtures do not establish real-world conversion or universal accuracy.

Historical OpenRouter development evaluation on 2026-10-15, using manually labelled synthetic cases across all five niches:

| Run | Products / niche scores | False positives / negatives on clear labels | Range agreement | Reported USD |
| --- | --- | --- | --- | --- |
| Initial GPT-4.1 mini | 24 / 120 | 7 / 0 | 82.5% | 0.020187 |
| Initial Gemini 2.5 Flash Lite | 24 / 120 | 28 / 0 | 55.0% | 0.006757 |
| Refined GPT-4.1 mini | 24 / 120 | 1 / 0 | 83.33% | 0.023107 |
| Separate held-out GPT-4.1 mini | 8 / 40 | 2 / 0 | 85.0% | 0.007861 |

The binary evaluation threshold is 60; automatic selection uses the more conservative 70-point gate. Ten calibration labels and four held-out labels straddle the binary threshold and are excluded from confusion counts. Range agreement checks finer human-authored score ranges and is a different measure. Calibration and held-out results are separate; this small sample does not establish real-world sales performance or universal accuracy. The historical benchmark runs above cost approximately USD 0.058. The historical GPT-4.1 run corresponds to approximately USD 0.096 per 100 similar analyses.

The historical GPT-4.1 results above are retained for comparison; the default is now DeepSeek V4.1 Flash after the newer-model evaluation below. Full results: [benchmark JSON](smart-classification-benchmark-2026-10-15.json). The live calls used the existing server key without displaying it, making production writes or sending messages.

The API limits a plan to 500 products, two active plans per user and 2,000 imported products per rolling 24 hours. Paid request routes also have per-user rate limits; the durable ledger adds the dollar and token reservation limits described above. Configure an account spending limit at OpenRouter if a strict external billing ceiling is required.

Reproduce without paid calls:

```sh
cd achadinhos-backend
npm run build
npm run benchmark:smart
node scripts/benchmark-smart-classification.cjs --fixture=heldout
```

Explicit paid evaluation:

```sh
node scripts/benchmark-smart-classification.cjs --live --models=deepseek/deepseek-v4.1-flash
node scripts/benchmark-smart-classification.cjs --live --models=deepseek/deepseek-v4.1-flash --fixture=heldout
```

Backend validation: `npm run validate`, `npm test`; paid ledger persistence checks: `npm run test:ai:integration`; opt-in disposable PostgreSQL validation: `npm run test:smart:integration` with a local test-only `DATABASE_URL`. Frontend: `npm run build`, `npm run test:imports`, `npm run test:smart`. Extension: `npm test`, `npm run check`. Browser QA verified zero paid requests on navigation, page load, reload and focus, plus one request for a same-tick double click followed by a provider error (no automatic retry). HTTP regression tests check authentication before parsing imports and read-only AI status. Browser QA also exercised five-audience setup/keyword packs at desktop/mobile sizes with mocked API data and no page errors.

## Follow-up integrations

Actual commission/sales report ingestion, measured conversion-driven optimization, live ML commercial revalidation and direct authenticated extension upload are not implemented. The first release optimizes observed offer signals, generates copyable presets, and accepts JSON imports as requested. These external integrations should be added only with supported data access and verified affiliate attribution.
