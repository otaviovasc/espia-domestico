# Smart Campaigns — audit and implementation plan

Date: 2026-10-15. Scope: repository audit, production data inspection, and implementation design. No application code, production records, campaigns, or WhatsApp groups were changed by this audit.

## 1. Outcome

Replace daily manual collections and campaign setup with:

**Choose dates → copy search packs → collect in the extension → paste JSON once → review the proposed daily agendas → approve.**

The application classifies across all active niches, saves the catalog, selects valuable offers, assigns actual WhatsApp destinations, writes a few standout messages, and schedules durable send tasks. Collection remains a user action in the authenticated Mercado Livre extension for the first release.

## 2. Verified current state

Production was inspected through Railway SSH into `espia / production / achadinhos-backend`, with PostgreSQL `BEGIN READ ONLY` and a statement timeout. The local `.env` points to an unavailable localhost database; its missing OpenRouter key says nothing about the production key. Production metadata identifies separate API, frontend, worker, and Postgres services.

Snapshot during the audit:

| Observation | Implication |
| --- | --- |
| 1,016 saved products; 9 explicitly non-affiliate | Existing catalog can supply candidates, but requires attribution and freshness checks. |
| 27 product collections named by date/niche | Daily batches are being represented manually as catalog folders. |
| 575 products rated under `default`; 494 under Masculino | Per-profile classifications already exist; these counts overlap. |
| One persisted profile, Masculino; Doméstico is built into code | New niches need persisted configuration, not more hardcoded classifier branches. |
| 31 campaigns: 21 completed, 2 running, 5 paused, 2 cancelled, 1 draft | Migration must coexist with active and paused legacy work. |
| Current running campaigns contain 53 and 45 products and enable `allowResend` | A default no-repeat policy and shared daily accounting are needed. |
| Recent logs include sends after midnight and more than 50 accepted messages/group/day | Current delays alone do not implement the requested daily policy. |
| A domestic campaign scheduled for 09:00 on October 14 continued into October 15 | End-of-day rollover is a core requirement, not a later convenience. |

Counters and logs are operational snapshots, not a sales report. UAZAPI acceptance is not WhatsApp delivery/read confirmation. Some campaign counters differ from offer counts; this audit does not establish a duplicate-send root cause.

### Existing implementation worth retaining

- `achadinhos-backend/src/ingestors/MercadoLivreIngestor.ts`: marketplace parsing, price/commission fields, affiliate link warnings and extension evidence.
- `src/services/OfferImportService.ts`: generic import, source identity and deduplication; raw import can handle 5,000 items/50 files/32 MB.
- `src/services/OfferCategorizationService.ts`: Jev relevance evaluation through OpenRouter, commercial scoring and partial failures. Current limits are 100 items for legacy classification or 4 for partial-result batches, with global concurrency 4.
- `src/services/ClassificationProfileService.ts` and `src/database/models/SavedProduct.ts`: user-owned profiles and separate product ratings per profile, plus manual overrides.
- `src/database/models/ProductGroup.ts`: manual catalog collections; these are not WhatsApp destinations.
- `src/services/CampaignService.ts`: campaign lifecycle, catalog identity, send history and recovery.
- `src/services/SafeSender.ts`: provider integration and product/group task expansion. Today it expands all offers × all selected groups, optionally shuffles them, and paces sequential tasks.
- `src/jobs/scheduler.ts` and `src/worker.ts`: 30-second polling and a dedicated worker. Retain that deployment boundary; add durable item scheduling instead of hours of process-local waiting.
- `src/database/models/ProductGroupDelivery.ts`: existing connection-scoped product/group deduplication and in-flight claims. Preserve these semantics.
- `achadinhos-frontend/src/pages/ComposePage.tsx` and `src/App.tsx`: manual campaign screen and navigation integration points.
- `afiliados-extension/`: existing multi-keyword ANY/ALL collection, commission percentage/estimated BRL filters, attribution evidence and full/compact JSON export. Keyword phrases are limited to 20 in imported evidence.

### Critical audience mismatch

The built-in Doméstico classifier explicitly excludes cosmetics, fashion and personal-use products. The requested DOMESTICA audience includes beauty and women's interests. Create an explicit editable DOMESTICA profile with that scope, migrate the smart audience to it, and re-evaluate affected products. Preserve old scores for historical campaigns; do not silently change their meaning.

## 3. Five audience configurations

Keep three concepts distinct: **classification profile** describes relevance; **product collection** organizes the catalog; **audience** maps a niche and sending policy to actual WhatsApp group JIDs and a connection.

| Audience | Included interests | Starter search phrases | Guardrails |
| --- | --- | --- | --- |
| DOMESTICA | Home, kitchen, organization, cleaning, beauty, personal care and women's accessories | `organizador`, `jogo de panelas`, `escova secadora`, `skincare`, `bolsa feminina` | Balance home and beauty rather than letting one category dominate. |
| MASCULINO | Technology, grooming, tools, fitness, men's fashion and automotive accessories | `fone bluetooth`, `aparador de barba`, `parafusadeira`, `camiseta masculina`, `acessório automotivo` | Unisex products can qualify; preserve existing useful tool criteria. |
| NATAL | Christmas decorations, gift wrapping, lights and gifts with a clear recipient/budget | `pisca pisca natal`, `árvore de natal`, `enfeite natalino`, `embalagem presente`, `kit presente` | Gift intent is not permission to admit every product; use delivery cutoff evidence when available. |
| PESCA | Rods, reels, lures, line, tackle organization and relevant fishing accessories | `vara de pesca`, `molinete`, `carretilha`, `isca artificial`, `linha multifilamento` | Distinguish fishing from unrelated outdoor items; capture compatibility/species when supplied. |
| PET | Dog/cat supplies, toys, feeding, hygiene, walking and domestic animal accessories | `areia para gato`, `comedouro pet`, `tapete higiênico`, `brinquedo cachorro`, `arranhador gato` | Species/size compatibility matters; exclude veterinary medicines from initial automatic approval. |

These are starter search ideas, not verified current offers or evidence of market demand. Seasonal keyword generation rotates them using actual inventory, prior collection yield and explicit calendar context.

Seed NATAL/PESCA/PET idempotently as inactive audience/profile configurations in implementation. Actual WhatsApp groups must be selected or created through a supported group-management flow, then bound to their JIDs. Names alone cannot establish destinations. Do not invent JIDs or assume internal product collections create WhatsApp groups.

## 4. Smart Campaigns screen

Route: `/painel/smart-campaigns`, with an audience setup panel and five workflow stages.

1. **Plan:** choose today/tomorrow/date range, enabled audiences, start/end time and product cap. Display existing queued/running campaigns and remaining capacity.
2. **Collect:** show 8–12 phrases per audience, packed into batches of at most 20. Provide copy actions, ANY mode by default for alternatives, minimum commission %, minimum estimated R$/sale, budget/category targets and a short explanation for today's searches. Distinguish evergreen, calendar-based and experimental phrases. Do not label model guesses as live trends.
3. **Import:** paste or upload one/multiple extension JSON exports. Deduplicate across batches; retain collection time, keyword provenance and affiliate evidence. Run analysis as a persisted background job with progress, cost ceiling, partial results and retry of failed items only.
4. **Review:** tabs for the five audiences and dates. Show selected/reserve/rejected counts, product prices, commission estimate, relevance, freshness, score components, routing explanation, scheduled time and message preview. Allow move/remove/pin/edit. Any plan change recomputes available slots and conflicts. Show why an offer was rejected.
5. **Approve and monitor:** one approval commits a versioned plan into scheduled tasks. Show paused/blocked/expired items, remaining capacity and tomorrow's shortages. Add pause per audience and a global stop control.

Product collections can be assigned automatically if helpful for the old catalog UI, but operators should no longer create date-named collections to send offers. Keep existing manual tools available.

## 5. Product intelligence

### Deterministic gates first

- Validate source identity, positive consistent prices, permitted links, commission values and configured exclusions.
- Separate verified affiliate attribution from a URL merely provided by an import. Unverified links go to review; explicitly non-affiliate products do not enter automatic profit campaigns.
- Missing commission, seller quality, shipping or ratings are unknown, not AI-generated facts. Initial quality gates only use evidence actually imported.
- Deduplicate by catalog/source identity and product variants when identity evidence supports it; do not merge distinct variants on title similarity alone.
- Exclude already sent or reserved product/destination pairs under the chosen repeat policy. Preserve manual catalog overrides and user boundaries.
- Reject stale offers from automatic scheduling. Proposed initial freshness policy: require refreshed evidence within 24 hours of send; configurable after real collection data is reviewed. Store `observedAt` separately from database `updatedAt`.

### AI enrichment

One structured classification pass per product returns fit for all active audiences, primary/secondary category, use case, recipient/species where applicable, seasonal fit, rationale and confidence indicator. A product may qualify for multiple audiences; e.g. an automatic pet feeder can suit PET and DOMESTICA. Do not broadcast every item everywhere. Low confidence routes to review and is calibrated against operator decisions; a model score is not a measured probability.

### Commercial ranking

`estimatedCommissionPerSale = observedCurrentPrice × observedCommissionRate / 100`.

This is a gross payout estimate for one eligible sale, not expected revenue or profit. Actual commission bases, eligibility, cancellations and conversions can differ. The extension already labels its BRL calculation as non-guaranteed.

Initial transparent score, with each input normalized to 0–100:

`0.40 × audienceFit + 0.20 × offerValue + 0.15 × commissionOpportunity + 0.10 × seasonalFit + 0.10 × freshness + 0.05 × assortmentContribution`.

This is a proposed starting policy to evaluate, not an established optimum. Fit and evidence gates cannot be outweighed by commission. Commission opportunity includes both rate and capped/log-scaled BRL payout so expensive items do not dominate. Offer value uses observed discount and, once accumulated, comparable historical prices; a marketplace crossed-out price alone does not prove a bargain. Mark price-history coverage explicitly.

Select the best feasible set rather than simply sorting raw scores: limit near-identical products, balance categories and price bands, retain strong affordable offers, and suppress audience fatigue. Proposed default: no more than 25% from one subcategory, relaxed transparently for sparse niches. Keep a reserve pool; never fill to 50 with weak offers.

Later, optimize measured commission per 1,000 sends using actual affiliate sales reports where attribution is available. Learn slot/category performance and maintain a small exploration allocation. Without click/sale attribution, the system can optimize proxies only. Do not alter affiliate URLs for tracking unless supported without losing attribution.

## 6. Daily scheduling contract

Recommended interpretation pending operator configuration: **at most 50 product messages per actual WhatsApp destination per local calendar day**, shared across all smart and manual campaigns. Five distinct groups therefore permit up to 250 messages/day in total. Make the per-group versus account-wide interpretation visible at setup; support an account-wide cap as a separate control.

- Timezone: `America/Sao_Paulo`; persist UTC instants plus local date and timezone.
- Daily window starts 09:00. Proposed end is 21:00, editable.
- Adjacent product messages to a destination must be separated by 720–960 seconds during normal operation. Sample and persist times once; bounded generation must fit the approved window, not keep resampling until it happens to fit.
- With 50 products there are 49 gaps: 09:00–18:48 at 12 minutes, 09:00–22:04 at 16 minutes; expected final time is 20:26 at a 14-minute mean, excluding provider delays. To guarantee a 21:00 finish at any allowed gap, select at most 46 items. Otherwise generate a feasible bounded schedule for up to 50 and enforce the hard end at execution.
- First send is scheduled for 09:00 when approved beforehand and capacity is available. Approval after 09:00 either starts at the next feasible slot after review, or begins tomorrow; never backdate or burst to catch up. Show this choice in review.
- Daily cap counts messages, including standout copy, which is part of the product message rather than an extra send. Reservations count against planning capacity; accepted sends consume daily capacity. Resolve uncertain send outcomes conservatively.
- Never accumulate midnight spillover. Items outside the window move to a future draft for revalidation and reranking. Already approved multi-day items can execute only if their evidence is still fresh.
- A disconnect or provider delay may exceed 16 minutes. Do not shorten the next gap below 12 minutes to recover lost time. Shift remaining slots or defer; notify the operator.
- Per-destination schedules operate independently. Enforce a separate shared connection rate limiter and stagger due sends by seconds; do not apply one global 12–16 minute wait that starves five audiences.
- Ranked selection and placement replace `shuffleOffers` in smart mode. Anchor strong offers across morning, midday and evening as an initial hypothesis, then learn from measured results.
- Preserve existing no-repeat history by default. Any intentional repost needs an explicit policy/approval and refreshed evidence; a date change alone cannot bypass duplicate protection.
- Legacy running/paused campaigns must participate in shared limits or be paused by the operator during transition. No automatic cancellation of current campaigns.

## 7. Seasonality and standout messages

Use a maintained event calendar with source, locality, date, preparation window and expiry. Feed today's actual date explicitly to the model. Include national/local holidays, retail events and user events, plus niche-specific seasonal configuration. Regional fishing seasons require location-specific verified data; do not infer legal fishing periods from a generic model answer.

NATAL should evolve from planning/decorations toward gifts, then only evidence-backed last-minute/local-delivery offers. Do not claim arrival before Christmas when shipping is unknown. After the season, pause or change its focus explicitly rather than filling it with unrelated inventory.

Write custom copy for at most 3 standout products per audience/day initially, also requiring high fit and strong evidence. Use normal templates elsewhere. Copy may explain a real use case and documented savings; it cannot invent scarcity, coupons, reviews, guaranteed results or commission claims. Final rendering inserts verified price/link fields deterministically. Cache by product evidence/audience/tone; preserve operator edits.

## 8. OpenRouter design

Reuse the existing provider integration behind a `SmartCampaignAIService`, with separate configurable roles for keyword planning, classification and standout copy. Keep Jev as a relevance baseline, but evaluate alternatives for richer cross-audience classification. It is an evaluation model in the current code, not a drop-in general copywriting model.

Use a small fast schema-capable model for bulk classification and short copy; escalate ambiguous/high-impact cases to a stronger configured model. Compare candidates on a human-labelled set from the existing catalog across all five niches. Choose by routing accuracy, missed good offers, unsupported claims, latency and cost per 100 products; do not hardcode a model as permanently best.

- Require JSON Schema outputs and application-side Zod validation, including returned product IDs and audience allowlists.
- Set provider parameter support requirements, explicit fallback models, request deadlines, concurrency limits and a plan/day cost budget.
- Cache category semantics by normalized title/description/profile version; rerun commercial scoring when price/commission changes. Calendar-sensitive analysis has separate date/context cache keys.
- Treat imported titles/descriptions as untrusted data, never as instructions or permission to fetch URLs. Send normalized minimal evidence rather than raw HTML, credentials or customer messages.
- Persist model/prompt/profile versions, token use, cost, result and errors. Model/network failure leaves items pending; existing approved valid plans remain independent of AI availability.
- Bound retries within the authorized analysis budget. Invalid or truncated responses need application validation/retry handling; provider fallback alone does not establish valid business output.

References checked during audit: [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

## 9. Persistence and execution

Proposed additions, all tenant-scoped:

| Entity | Purpose |
| --- | --- |
| `smart_audiences` | Profile reference, stable slug, inclusion/exclusion rules, keyword preferences, seasonal activation and policy. |
| `smart_audience_destinations` | Audience → user connection → WhatsApp JID binding, active state and unique binding constraints. |
| `smart_import_batches` / `smart_analysis_jobs` | Provenance, evidence timestamp, idempotency key, progress, budget and partial results. |
| `product_offer_observations` | Immutable observed price/commission/attribution snapshots and expiry evidence. |
| `smart_plans` | Date range, timezone, policy/profile snapshots, version, approval status and actor. |
| `smart_plan_items` | Product/observation reference, per-audience scores, rationale, selection/rejection state, copy and manual overrides. |
| `scheduled_product_sends` | Exact destination/product/slot, immutable approved payload, attempts, lease, status and provider acknowledgement. |
| `destination_daily_budgets` | Atomic reservations/accepted totals shared across smart and legacy sending paths. |

Keywords and calendar context can initially be versioned JSONB on plans/audiences; a separate events table is justified when calendar administration is added.

Approval transaction locks the plan version and destination/day budgets, validates user/connection ownership, reserves remaining capacity and inserts unique tasks. Repeat approval returns the same task IDs. Prevent overlapping plans from reserving the same destination/product, in addition to retaining the historical delivery ledger.

Worker claims due tasks with database locks (`FOR UPDATE SKIP LOCKED`) and expiring leases, then uses the existing provider formatting/transport and delivery identity guards. A send transition must coordinate daily budget, delivery ledger and task state. Use heartbeat/fencing across workers. A timeout after the provider may have accepted a message is `UNKNOWN`, not a blind automatic retry; reuse existing manual reconciliation principles. Provider-supported idempotency should be used if verified, but exactly-once external delivery cannot be assumed.

Do not implement this as hundreds of one-product legacy campaigns or a five-audience Cartesian broadcast. Use explicit destination tasks, with a plan/audience/day summary that reuses campaign monitoring where practical. Factor shared delivery functionality rather than duplicate provider code. Keep the delivery ledger separate from the queue: sent history and future scheduling have different lifecycles.

## 10. Delivery phases and acceptance criteria

### Phase 1 — Audience setup and collection assistant

Add editable five-audience configuration, bind existing WhatsApp groups, seed inactive NATAL/PESCA/PET, fix DOMESTICA scope through a new profile, and deliver date-aware keyword packs with extension-compatible copy controls.

Accept when each audience resolves to the correct profile/destination, beauty qualifies for DOMESTICA, unknown destinations cannot send, and keyword packs respect extension limits. No active legacy records are reassigned silently.

### Phase 2 — One-import intelligence and preview

Persist imports/jobs/observations, classify against all active audiences, compute explainable scores, save catalog entries automatically, and generate reviewed daily selections/reserves with selective copy. Support resumable imports and partial AI failures.

Accept when one mixed JSON can produce five distinct relevant agendas, duplicates are merged correctly, weak/unattributed/stale items stay out, moving products preserves overrides, and no AI request or preview can start a send.

### Phase 3 — Durable schedule and approval

Implement task queue, atomic daily budgets, conflict detection, connection limiter, end-of-day rollover, leases and uncertainty handling. Integrate legacy sends into shared policy accounting before enabling smart scheduling. Deploy the worker support before allowing approval that creates tasks.

Accept when concurrent approvals/workers cannot exceed the configured per-group cap, duplicate reservations are prevented, no send occurs outside the local window, accepted tasks are not replayed after restart, and missed slots never cause catch-up bursts. Verify normal gaps, later approval, all five groups, overlapping legacy campaigns, disconnects, crashes and provider timeouts using a fake provider.

### Phase 4 — Learning and faster extension handoff

Add observation-based deal quality, collection-yield feedback, affiliate sales import where supported, configurable experiments, and calendar maintenance. Then add a versioned extension preset import/deep-link and authenticated batch upload to eliminate copy/paste. Keep authenticated Mercado Livre collection in the extension unless a supported alternative is verified.

Accept when generated keyword packs can become actual extension filters without transcription, missing results inform the next pack, and commercial dashboards distinguish observed sales from estimates. Auto-approval is opt-in only after routing quality and scheduling behavior are measured.

### Validation and rollout

Use representative fixtures for all five audiences and meaningful integration tests for approval races, connection ownership, daily limits, identity variants, clock boundaries, stale observations, lost acknowledgements and multi-worker recovery. Run backend type-check/lint/tests and frontend build plus import tests for changed workflows. No code tests were needed for this documentation-only audit.

Pilot DOMESTICA and MASCULINO with review required, compare relevance and operator time to the manual baseline, then enable NATAL/PESCA/PET after their real groups are bound. Retain manual campaign creation and an immediate pause path throughout rollout.

## 11. Decisions to expose in configuration

Recommended defaults are a proposal, not existing production settings: 50 messages per destination/day, 09:00–21:00 São Paulo time, 12–16 minute normal gaps, up to 3 standout messages, 24-hour freshness and manual approval. Confirm or edit these during audience setup. Sales attribution access, actual new WhatsApp group IDs and regional calendar preferences remain implementation inputs.
