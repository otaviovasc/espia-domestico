# Daily worker runbook

Daily orchestration defaults off. Verify account/group bindings, browser access, ranked inventory and migrations before enabling.

## Authentication

From `achadinhos-backend`, run `npm ci`, `npx playwright install --with-deps chromium`, `npm run build`, then `npm run daily:login` on a desktop. Sign in, wait for affiliate hub cards and press Enter in the terminal. The helper saves `data/daily-auth/mercadolivre.json` with mode 0600. This directory is ignored by Git and excluded from the Docker context. Treat the file as a password; never put cookies or login codes in repository files/logs.

The completed T3 browser login does not export HttpOnly cookies or provision worker authentication. The worker's private session file must be provided and verified from its deployment egress.

## Deployment configuration

Reuse the dedicated worker. For self-hosted Chromium, select root directory `achadinhos-backend`, Dockerfile path `Dockerfile.worker`, and start command `node -r tsconfig-paths/register dist/worker.js` in the worker service settings. Railway CLI 5.71 rejects changing the deprecated Config-as-Code path; `railway.daily-worker.json` is retained as a reference descriptor. Upload the matching source before adding its volume, because attaching a volume can trigger a rebuild. Mount a private volume at `/data`; provision the session file privately outside the image. The API keeps its scheduler/daily orchestration disabled.

Worker variables:

```dotenv
RUN_SCHEDULER=true
DAILY_AUTOMATION_ENABLED=false
DAILY_AUTOMATION_CONFIG={"userId":REPLACE_WITH_REAL_INTEGER,"autoApprove":true,"repeatCooldownDays":30}
DAILY_BROWSER_STATE_PATH=/data/daily-auth/mercadolivre.json
```

Replace the template's account ID with the exact existing integer. Defaults: prepare at **19:00 for the next local date** (`planningDaysAhead:1`); send08:00–19:00 São Paulo;20–25 minute nominal cadence;30 products per audience; candidate ceiling250 per audience. Full D+1 readiness requires all30 qualified slots in both audiences, including the first/last slot and gap checks. Rating4.5, accumulated sales100, fit75 and commercial score60 remain hard gates. `planningDaysAhead:0` explicitly preserves the legacy same-day mode. `weekdaysOnly:true` applies to the sending date.

Collecting at or after the preceding day's window end preserves the24-hour evidence limit through the next window. Configuration rejects an earlier D+1 collection time. This provides an overnight repair window, not24hours of unchanged prices. Price observations are retained internally; captions omit the observation timestamp.

Discovery starts with `min(candidateLimit, max(50, requiredItems × 4))` candidates per audience:120 for the default30-item D+1 day. This allows up to75% combined novelty/classification losses before the initial pool falls below target; it is a headroom heuristic, not measured yield. Short audiences receive batches of at most50 additional candidates, preserving successful payloads, analyses and append receipts. Each browser request supports50 terms. Audience banks rotate by the frozen target date, remain deterministic across retries, and supply disjoint pages up to16 keyword rounds. After keywords, each audience gets one final keyword-free pass over authenticated affiliate-hub cards. The collector has no separate marketplace search/category crawler; a broader hub pass cannot guarantee fresh bestsellers. Empty initial pages advance independently per audience. Discovery stops at readiness,250 candidates per audience, finite source exhaustion, or the deadline. Before approval, a read-only novelty preflight checks selected products under the audience cooldown policy below against deliveries and pending/sending/sent/unknown sends. Conflicting selections count as missing for replenishment, including same-day mode; approval-time novelty conflicts also return to bounded replenishment. Approval still owns atomic novelty checks, qualified reserve promotion, and partial-day scheduling. Discovery conservatively replenishes missing selections before that reserve promotion, so it may collect despite usable reserves. No quality, political, freshness or novelty gate is relaxed.

Before restarting the worker, run `npx sequelize-cli db:migrate` from `achadinhos-backend` using the release database configuration. Apply every pending migration, especially `20261109000001-daily-automation-runs`, `20261109000002-daily-automation-alerts` (including discovery state), and `20261111000001-daily-approval-recovery` (`approval_attempts`/`approval_revision`); the new worker requires these columns on startup. Existing auth/sales features also require `20261110000002-ml-auth-challenges` and `20261110000003-affiliate-sales-notices`.

Reuse the existing explicitly priced, guarded AI configuration: `AI_ENABLED=true`, `OPENROUTER_KEY`, explicit `AI_INPUT_COST_USD_PER_MILLION`/`AI_OUTPUT_COST_USD_PER_MILLION`, the approved model variables and existing request/token/spend limits. Set `DATABASE_URL` and a valid `JWT_SECRET` for API and worker. Both Smart audiences must be enabled and bound to distinct verified groups. The worker does not create or choose groups. Set `alertGroupId` in `DAILY_AUTOMATION_CONFIG` to the verified Loja Geral JID. Enable `DAILY_AUTOMATION_ENABLED=true` only after migration and private browser-session verification; keep `RUN_SCHEDULER=false` and daily orchestration disabled in the API process.

For a collection/analysis preview, set `DAILY_AUTOMATION_ENABLED=true` with `autoApprove:false`. It still uses guarded paid classification, but waits in the existing Smart review UI. After setup verification, `autoApprove:true` enables the requested unattended cycle. Configuration changes apply to the next target date without a saved run. In-progress runs resume their persisted configuration across midnight and restarts.

Automatic approval always approves the qualified selection, even below the full-window target, after a late start, or with a single audience. It replaces novelty conflicts with qualified reserves first. Novelty, quality, political, cadence and the 08:00–19:00 envelope remain hard gates; only an empty qualified selection or a closed window holds the day. Explicit Smart approval retains strict eligibility, freshness and standout validation and does not automatically repair invalid selections. `startNow` and `advance` cannot move daily sends before the daily start time.

`repeatCooldownDays` defaults to **30**; `0`, missing persisted values, or no destination groups preserve lifetime novelty. Enabled values must be integers from 7 to 3650. One batched history query applies each audience's destination groups in collection filtering, exclusions, readiness, selection, approval and both pre-provider rechecks (the last three under the account lock). Any non-SENT reservation/uncertain outcome or SENT record without `sent_at` blocks regardless of age or destination; confirmed sends within the cooldown block only their destination groups, across connection changes. At exactly the cutoff or earlier they become repeat candidates for those groups; sends only to other groups remain fresh. Matching uses offer identity aliases, affiliate URL aliases and normalized Mercado Livre IDs, so a new listing ID with yesterday's affiliate URL is still blocked. Re-observed cooled products must pass all current price, rating, sales, affiliate, freshness, political and quality gates and stay flagged reserves until bounded fresh discovery exhausts its keywords or candidate budget. The worker then rebuilds from persisted analyses without buying classification again, always ranking fresh products ahead of repeats and price-mix preferences, and auto-approves the qualified remainder under the existing window and cadence gates. Inventory warnings count only fresh candidates. Smart items expose `repeatFallback` and “Repetição após N dias”; plan progress records `repeatCandidates`/`repeatSelected` and run `discovery_state.repeatSelected` records the approved count. Do not manually enable fallback before discovery is exhausted. Cross-day classification reuse remains unavailable because the cache includes campaign date/calendar and audience criteria; old lineage cannot prove unchanged inputs, and delivery history never imports an old offer or price.

Optional `DAILY_BROWSER_CDP_URL` accepts a private Chromium CDP endpoint. Provision/manage that provider's session separately. The collector creates an isolated context from the state file and disconnects afterward. CDP support alone does not implement a hosted provider's session lifecycle. Never expose the credential-bearing URL in logs/frontend.

Optional `DAILY_BROWSER_PROXY_SERVER`, `DAILY_BROWSER_PROXY_USERNAME`, `DAILY_BROWSER_PROXY_PASSWORD` configure outbound proxying for locally launched Chromium. Remote browser proxies belong in the remote provider's configuration. Add proxy expense only after an observed direct-egress failure calls for it.

## Status and recovery

Read metadata rather than raw payloads:

```sql
SELECT local_date, status, plan_uuid, attempts, approval_attempts, approval_revision, last_error, next_attempt_at, lease_until
FROM daily_automation_runs WHERE user_id=:user_id
ORDER BY local_date DESC LIMIT 14;
```

`ANALYZING` belongs to the existing Smart analysis worker. `SCHEDULED` is approved/queued, not delivered. Check Smart sends/provider outcomes separately. Uncertain deliveries retain manual resolution and are not replayed automatically.

Collection authentication failures now retry automatically, including persisted `AUTH_REQUIRED` runs. The collector attempts the same operator email-code recovery as the session refresher, in its own browser. Recovery logs and refresh receipts contain a fixed `step` code (for example `PREFLIGHT`, `LOGIN_OPTIONS`, `EMAIL_PROOF`), never page content or identities. Account pickers and alternate-method links are supported; passwords, SMS, QR and captcha bypasses are not.

Collection/authentication failures use durable backoff of 1, 2, 4, 8 and then 15 minutes until thirty minutes before the target start (07:30 local / 10:30Z by default). A running attempt is aborted at that cutoff. A late fresh run may make one final live attempt. At the cutoff, failed preparation switches to retained checkpoints, saved products and recent plan inputs/reserves with existing verified affiliate links and original evidence timestamps. No login or live collection is needed for that inventory pass. Cooldown, classification, freshness at each scheduled slot and automatic partial-day approval still apply; exhausted discovery enables eligible repeats through the existing mechanism. `DAILY_SESSION_FALLBACK` alerts explain the switch. No eligible inventory means `DAILY_OFFLINE_INVENTORY_EMPTY` and no fabricated/empty approved plan. AI, database and WhatsApp connection availability remain necessary.

After fixing a configuration failure with no plan, an operator may explicitly rearm today's run within its commercial window:

```sql
UPDATE daily_automation_runs
SET status='COLLECTING', attempts=0, last_error=NULL, next_attempt_at=NOW(),
    discovery_state=discovery_state - 'offline' - 'exhausted',
    lease_token=NULL, lease_until=NULL, updated_at=NOW()
WHERE user_id=:user_id AND local_date=:local_date
  AND status IN ('AUTH_REQUIRED','CONFIG_REQUIRED','FAILED','EMPTY','OPERATOR_ATTENTION','REVIEW')
  AND plan_uuid IS NULL AND (lease_until IS NULL OR lease_until < NOW());
```

Do not clear an existing plan's request ID/input to evade idempotency or budgets. Quality gates are never relaxed; a short day ships its qualified products instead. `DAILY_AUTOMATION_ENABLED=false` plus worker restart stops new daily orchestration, **not already-approved sends**: pause/cancel the existing Smart plan separately, preserving uncertain outcomes.

`attempts` counts failures within the current orchestration phase. Completing collection and first checkpointing the plan reset the counter; collection failures cannot consume the later approval retry budget. A held analysis is status polling, not another attempt. Completed audience payloads are checkpointed individually; after a timeout only the missing audience is recollected, with completed products excluded.

For a run with an existing plan, first inspect Smart. Use its explicit retry control if analysis failed. Once the plan is ANALYZING or REVIEW, an operator may rearm orchestration within today's feasible window without replacing inputs or replaying paid analysis:

```sql
UPDATE daily_automation_runs r
SET status='ANALYZING', attempts=0, last_error=NULL, next_attempt_at=NOW(),
    lease_token=NULL, lease_until=NULL, updated_at=NOW()
FROM smart_plans p
WHERE r.user_id=:user_id AND r.local_date=:local_date
  AND p.uuid=r.plan_uuid AND p.user_id=r.user_id
  AND p.status IN ('ANALYZING','REVIEW')
  AND r.status IN ('FAILED','OPERATOR_ATTENTION')
  AND (r.lease_until IS NULL OR r.lease_until < NOW());
```

Scheduled/paused/uncertain plans are deliberately excluded. Resolve those through Smart; do not rearm them as new daily work.

## Checks and extractor updates

Run `npm test`, `npm run lint`, and `npm run test:daily:browser`. Against a disposable migrated local PostgreSQL, run `npm run test:daily:integration` and `npm run test:smart:integration`. These checks do not send to real customers or establish deployed availability.

`npm run daily:sync-extractor` synchronizes the extension's extractor/share bridge from the sibling repository, recording base revision, uncommitted-source status and SHA-256 hashes. Rerun compatibility tests after syncing. Production uses the vendored files and does not need a sibling Git checkout.

## Private session provisioning and updated recovery

The worker now checks the authenticated affiliate hub at most once per four-hour bucket, independently of paid analysis and sending. Successful checks save rotated cookies, localStorage and IndexedDB to the private volume. A durable marker prevents restart/failure launch storms. Collector, sales observer and refresh writes use a file lock plus a content fence: a browser opened with an older state cannot replace an operator's newer login. These checks add at most six short browser visits/day and no AI requests; they cannot prevent Mercado Livre from revoking a server-side session.

For email-code recovery, provision `/data/daily-auth/login.json` privately with the account email (`{"email":"..."}`, mode0600). The worker uses only a real Mercado Livre email challenge, asks in the configured Loja Geral group through the existing outbox, and accepts one fresh six-digit reply from that connection/group within five minutes. API and worker must share the existing `JWT_SECRET`, which derives a separate encryption key for the temporary code relay. No password is collected. The code is intercepted before chat persistence, encrypted in the challenge table, removed before submission, and cleared on expiry/failure. Old, duplicate and cross-group replies cannot drive a browser. Expired requests are not sent later, and uncertain outgoing requests are not replayed. Only one active challenge/account and one submission/challenge are allowed. Captchas, unsupported verification methods and rejected/expired codes fail visibly; the worker cannot bypass Mercado Livre's security checks. Existing daily/AI/delivery markers and PAUSED/UNKNOWN plans are never rearmed by login recovery.

Apply migration `20261110000002-ml-auth-challenges` before shipping API/worker code. Run `npm run test:auth:browser` for isolated browser rotation/recovery fixtures, and `test:auth:integration` only with a disposable local PostgreSQL URL. After deployment confirm a fresh worker browser can load hub cards and verify the next refresh receipt under `session-refresh/`, with mode0600 and the active file on `/data`. Provider cookie expiry alone does not prove a server-side session is still valid.

After a Chromium-enabled worker and private `/data` volume exist, select the exact linked project/environment and run `railway service link achadinhos-worker`. Railway CLI 5.71.0 exposes `railway service files upload ./data/daily-auth /data/daily-auth` to upload the local login directory. Use `--overwrite` only to deliberately replace an existing session. Confirm the remote session file is mode 0600 and readable only by the worker; the collector atomically preserves that mode when refreshing it. The initial release has been deployed; these instructions also apply to later session renewals. The shared T3 browser's authenticated session is still not a provisioned worker session file.

`OPERATOR_ATTENTION / ACTIVE_PLAN_LIMIT` requires inspecting existing plans, especially PAUSED/UNKNOWN outcomes, before creating another. Resolve or cancel through the existing Smart workflow; never delete delivery history. Other AppError 4xx codes are retained in `last_error`. An `ANALYSIS_HOLD` polls the existing plan without starting paid retries; use the explicit Smart analysis retry control, and the same daily run automatically rejoins it while the window remains feasible. Automatic approval uses the remaining window; `LATE_ANALYSIS` expires only when no feasible capacity remains. Controlled shutdown releases its lease when possible; an abrupt process loss still relies on lease expiry.

Held analysis is checked on each daily scheduler tick, with no 15-minute collection backoff and no automatic paid retry. Prior-day unapproved automation plans are canceled using their observed revision; a concurrent operator change is preserved. Cleanup failures are recorded on today's run rather than escaping before its checkpoint exists.

Automatic approval reconciles novelty, eligibility, standout limits and freshness at actual tentative slots, sharing one batched cooldown-aware history snapshot per audience across its reconciliation passes. It replaces rejected items with qualified fresh reserves first, preferring the removed price band within that tier; flagged repeats come last and are admitted only after `repeatFallbackReady`. It normalizes final order, keeps the highest-scoring feasible pins, and trims to residual destination daily caps under the delivery locks. Only retained items reserve cross-audience identities. Operator approval retains strict validation. Frozen auto-approval REVIEW runs and transient approval holds (including existing `DAILY_NOVELTY_CONFLICT` holds) resume through the same novelty preflight, bounded replenishment and fallback path. Existing plans skip initial recollection; replenishment appends only new observations under durable request receipts. Fallback returns to ANALYZING once and rebuilds from persisted analyses without another paid classification. An already SCHEDULED plan, including an operator-approved one, only checkpoints its status and repeat count, even if AI is disabled or the run was held by operator intent or the approval retry limit; this terminal reconciliation does not authorize another automatic approval. Empty reconciliation retains `DAILY_NOVELTY_CONFLICT` for compatibility; it triggers bounded replenishment and then recoverable backoff, as does legacy `DAILY_INVENTORY_SHORTAGE`. Persisted `approval_attempts`, `approval_revision` and `next_attempt_at` provide exponential backoff from 30 seconds up to 15 minutes, bounded to 256 attempts and the target window. Exhausting the attempt budget records `DAILY_APPROVAL_RETRY_LIMIT` and requires operator action; transient failures before approval also consume that budget. Revisions, bindings and connection scope are fetched again on each attempt. Smart edits after an automatic approval hold set `dailyAutomation.operatorHold`; legacy holds whose plan changed after the run checkpoint are conservatively held as `DAILY_OPERATOR_HOLD`. Approve these explicitly through Smart. PAUSED/CANCELLED plans, frozen manual runs, AUTH/CONFIG/ACTIVE_PLAN_LIMIT and competing manual-campaign holds remain operator-owned; recovery never pauses a manual campaign. Empty/partial collection retries at most three total attempts before any paid classification; old `EMPTY` rows can be explicitly rearmed with the SQL above.

Small but nonempty inventories still receive bounded classification so the operator can inspect and explicitly approve a qualified partial day. This trades some AI spend for recoverability; no claim is made that the full window is feasible merely because classification ran. Measure actual yield before increasing candidate limits. Browser authentication is checkpointed after each successful audience so later failures preserve already-rotated state.

If a session write fails after both audiences were collected, completed payloads are checkpointed and the run holds as `CONFIG_REQUIRED / SESSION_PERSIST_FAILED`. Repair the private volume/session file and explicitly rearm; the observations can be reused without another collection. An incomplete audience is never treated as a complete day.

Preview mode deliberately retains REVIEW plans for inspection. At the end of each preview day, approve a qualified selection within the daily window or cancel its old unapproved plan through Smart. Otherwise two retained plans cause the documented `ACTIVE_PLAN_LIMIT` hold; preview is not unattended mode.

UNKNOWN delivery pauses the whole plan and requires inspection in Smart before resolving and resuming. This intentionally preserves the existing delivery barrier for both audiences. Loja Geral receives deduplicated operational alerts when configured; the Smart status and daily-run query remain the durable inspection paths. Auth/group failures must be addressed before enabling unattended approval.

The final pre-provider window/freshness check also protects ordinary Smart sends: if preparation crosses an approved deadline, that send is skipped. It does not transport an expired offer at the boundary. Historical identity hashes and ordinary manual repeat semantics are unchanged.

Category limits are a diversity preference. Daily analysis can draw additional already-qualified reserves to reach its minimum, recording a warning; rating, demand, fit, political and freshness gates remain hard requirements. Tight late schedules have less polling/transport slack and can skip slots; D+1 preparation leaves an overnight repair window. Actual per-audience yield, collection duration and memory must be measured from the worker before unattended approval.

Default standout-copy calls are off (`maxStandouts:0`). Captions omit the observed price's timestamp, and visible flash/countdown deals are excluded. Ordinary intraday price changes remain possible: this version does not re-fetch the product before every send.

## Muse Ember and sales observations

Production can pin all four AI model variables to `meta/muse-ember`. Its endpoint requires reasoning; the client uses low reasoning effort with reasoning text excluded, within the existing output-token, request and daily-spend caps. Other models retain their existing reasoning policy. Keep explicit conservative token-price ceilings configured; a reserved amount is not an actual bill.

Muse classification accepts one observed public `http2.mlstatic.com` image per product, tagged with that product's batch ID. Other hosts, credentials, query strings and data URLs are excluded. Missing images retain text classification. Image URLs participate in cache identity; each included image reserves an additional 2,048 input tokens. Existing limits can split a batch before any paid call. This is a conservative allowance, not a measured universal image-token bound: inspect returned usage and qualifying yield. Images do not establish sales, ratings, hidden specifications or political views of buyers/sellers.

The same classification response supplies a factual `shortCaption` of at most 80 characters and a short `captionEvidence` source/excerpt. Excerpts must contain 6–160 characters and exist at whole-token boundaries in supplied title/description text. Missing or malformed optional evidence blanks the caption while preserving classification. Decimal/thousands values are compared as complete numeric literals; negated product text cannot support an affirmative accessory claim. Image-only specifications, unsupported numbers/included accessories, ungrounded scene props, title echoes and unsafe medical/popularity/urgency/link claims fall back to the ordinary template. Optional captions of 81–240 characters are blanked while retaining the fit/political result. This is a conservative filter and self-reported evidence, not a proof of every claim. Singleton text/image IDs remain consistent after batch splitting. New daily plans retain model, policy version, image-URL hash and generated-caption hash; old decisions without lineage stay unknown. No extra copy request is made, and old approved sends are not rewritten.

`DAILY_SALES_OBSERVATION_ENABLED=true` on the worker captures the authenticated affiliate dashboard's last 90 completed days after the daily collection tick at/after collection time. It runs outside the delivery loop. Private mode-0600 state lives beside the session directory under `../affiliate-sales/account-<id>/`. Generation files retain observations, ledger and changes together; `current.json` is published last and identifies the complete file by UUID/hash. Partial captures and orphaned writes never replace it. Legacy `ledger.json` is read as an unverified baseline without deleting it. Structured daily attempt receipts retain running/complete/partial/failed state and typed error codes. An exclusive daily attempt marker prevents repeated browser launches after failure; inspect and explicitly remove only that observer's marker to retry a repaired observation. Daily-run/AI/delivery barriers remain separate and must never be cleared for this purpose.

The observer reads the visible table and stores hashed order/product identities, product IDs/category, displayed sale values/commissions/rates/units, direct/indirect attribution and original statuses. Dates acquire a year only when uniquely resolvable inside the observed report range. Revisiting an order updates its status instead of counting it again. Identical repeated rows are deduplicated. Differing rows sharing one order/product identity remain explicit ambiguous variants: they are not silently summed or treated as multiple purchases. Buyer data, seller identity, raw order IDs, cookies and credentials are not retained. Typed auth/schema/pagination/incomplete failures alert through the existing operations path. Period selectors accept observed date ranges and named presets. The observer passively validates the browser's own sales report response against the exact 90 completed days, expected page and row totals, then matches the DOM's order identities and statuses before capture. Completion follows response totals, never absent pagination. A verified zero-result response is complete; an empty default week does not prevent switching to 90 days. Missing/mismatched responses and unloaded rows fail with distinct typed codes and preserve the last complete report. No private API requests are replayed. Run `npm run test:sales:browser` for the isolated delayed-page/login fixture.

Run `npm run daily:sales-report` through authenticated worker SSH for private totals, newly observed records, status/commission changes, collisions, last-complete age, attempts and unresolved older pending records, including missing-date records last observed before coverage and unresolved identities absent from the latest capture. Absence never fabricates a new last-seen timestamp or cancellation. A failed/partial capture is not “zero sales.” Unknown labels remain unknown for commission accounting. The observed pending/cancellation labels and explicit returned/refunded labels are mapped conservatively; unknown labels remain visible, and none is invented as proof of paid earnings. A running attempt older than two minutes is flagged stale. The latest partial capture exposes its parsed purchases separately as an unverified lower bound; it is never added to complete totals.

**Under-review purchases count immediately as demand evidence**, including indirect sales. No two-month approval wait is imposed. A cancellation/return removes its positive demand contribution; an ambiguous identity whose variants are all non-cancelled contributes at least one purchase, labelled `ambiguousPurchases`; mixed cancelled/active variants remain unresolved. Ambiguous monetary values are excluded, and category/price-band/indirect attribution stay unknown rather than following an arbitrary variant. Product/category/price-band demand counts use non-cancelled purchases; price bands need observed units to avoid mistaking an order total for a unit price. Commissions remain marked by source status for accounting. “Newly observed” does not mean “sold today.” Historical sales are not credited to today's model, group or caption, and the report does not call provider acceptance an impression/conversion. Ranking remains unchanged in this patch; attribution experiments need reliable tracking labels and exposure/click evidence.


## D+1 value, readiness and alerts

Daily selection uses actual gross payout `discountedPriceBRL × commissionRate /100`. A price/demand/fit heuristic discounts expensive-item selling difficulty before normalizing payout for ranking. It is not an observed purchase probability. Production audience filters accept a positive estimated payout of at leastR$0.01, without a commission-percentage floor or a price ceiling.

The mix reserves20% of slots for qualified products up toR$100 and20% aboveR$500, when available; remaining slots use score and soft category diversity. Missing price bands do not reduce the full qualified inventory or admit weak products. The bands are interleaved through the schedule and retained in approval order.

Set `alertGroupId` to the verified Loja Geral JID for the account. Collection/authentication/configuration/analysis failures, exhausted shortages, pre-send missing plans/manual approvals, paused plans and uncertain/failed/skipped sends produce typed deduplicated events. Messages contain only plan IDs, counts, deadlines and problem codes. Pending notification transport is independent of long collection/analysis. A provider-uncertain notification is retained asUNKNOWN and never replayed automatically. Pre-provider connection checks back off safely. Total worker/database/WhatsApp outages cannot guarantee delivery of their own notification.

`DAILY_PARTIAL_DAY` is informational: an accepted SCHEDULED/COMPLETED plan still has a volume deficit, with per-audience selected/required/missing counts. Current-day recoverable holds take priority over expired historical holds. `AUTO_APPROVAL_STALLED` identifies automatic review/retry holds; `MANUAL_APPROVAL_REQUIRED` is emitted only for a frozen manual configuration. `DAILY_INVENTORY_LOW` retains its bounded `fresh=` collection count alongside those codes. Alert facts remain restricted to IDs, counts, deadlines and codes.

An automatic D+1 plan that reaches its first slot unapproved is still approved for the remaining window, starting at approval time under the existing time, freshness and delivery guards.

Outbox metadata (do not dump message payloads or credentials):

```sql
SELECT status,count(*) FROM daily_automation_alerts WHERE user_id=:user_id GROUP BY status;
```

## New-sales summaries

With sales observation enabled, the worker checks every six hours (São Paulo 00:00, 06:00, 12:00, 18:00). `DAILY_SALES_ALERT_INTERVAL_HOURS` supports 3, 6 or 12; default 6. Each bounded capture reads both the last 90 completed days and the verified Hoje view, including today's purchases. A durable interval marker prevents browser retries after restart/failure.

A verified first capture establishes a silent baseline. Later captures enqueue a Loja Geral summary only when newly observed, non-cancelled purchases exist: purchase/product counts, product names, observed sale values and reported commissions, including under-review and indirect sales. Commissions are provisional, not paid earnings. Missing/ambiguous money is explicitly excluded; mixed cancelled/active ambiguities are unresolved. No sale dates or quantities are invented. Every product is included; large summaries are split into bounded messages with one durable event per part. Dashboard reporting can lag, so newly observed does not mean sold in that six-hour period.

Migration `20261110000003-affiliate-sales-notices` stores the notification cursor. Advancing it and inserting the existing alert outbox occur in one transaction. Repeated captures/status changes do not announce a purchase again; uncertain WhatsApp transports retain UNKNOWN and are not replayed. No new-sales message is sent for zero additions or the initial historical import.

The worker's deployed command invokes Node directly. The prior npm startup wrapper reported SIGTERM as an error during normal container replacement; the worker's own signal handlers can now close browsers and exit cleanly.

## Inventory headroom and early warnings (local implementation, 2026-11-11)

`DAILY_INVENTORY_LOW` is an advisory operations alert, deduplicated per run/audience. It reports fresh canonical candidate IDs returned after browser exclusions against a warning floor of twice the required count (60 by default), capped at the requested batch size. A full50-candidate replenishment batch therefore does not warn merely because it is smaller than60. This is a collection-yield warning, not a persisted statistical forecast or proof of AI-qualified inventory. Alert persistence failure does not block collection or analysis; `alertGroupId` is required for delivery through the existing alert queue.

No candidate limits or analysis budgets were raised. Initial collection makes the same two audience passes, requesting up to240 candidates instead of100 (up to140 extra products, about35 extra initial four-product classification batches before deterministic rejection). All replenishments combined remain bounded at250 candidates per audience/500 per plan and the existing2,000-product rolling24-hour budget per user; cache, malformed-response recovery, transport retries and request/spend guards remain unchanged. Worst-case successful discovery is at most17 source passes per audience (16 keyword pages plus one broad hub pass), subject to candidate and deadline bounds. Browser failure retries can repeat a pass under the collection deadline and backoff above. These are bounds, not live cost/yield measurements; no paid or Mercado Livre calls were made in the local tests.
