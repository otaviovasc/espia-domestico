# Daily worker runbook

Daily orchestration defaults off. Verify account/group bindings, browser access, ranked inventory and migrations before enabling.

## Authentication

From `achadinhos-backend`, run `npm ci`, `npx playwright install --with-deps chromium`, `npm run build`, then `npm run daily:login` on a desktop. Sign in, wait for affiliate hub cards and press Enter in the terminal. The helper saves `data/daily-auth/mercadolivre.json` with mode 0600. This directory is ignored by Git and excluded from the Docker context. Treat the file as a password; never put cookies or login codes in repository files/logs.

The completed T3 browser login does not export HttpOnly cookies or provision worker authentication. The worker's private session file must be provided and verified from its deployment egress.

## Deployment configuration

Reuse the dedicated worker. For self-hosted Chromium, select root directory `achadinhos-backend`, Dockerfile path `Dockerfile.worker`, and start command `npm run worker` in the worker service settings. Railway CLI 5.71 rejects changing the deprecated Config-as-Code path; `railway.daily-worker.json` is retained as a reference descriptor. Upload the matching source before adding its volume, because attaching a volume can trigger a rebuild. Mount a private volume at `/data`; provision the session file privately outside the image. The API keeps its scheduler/daily orchestration disabled.

Worker variables:

```dotenv
RUN_SCHEDULER=true
DAILY_AUTOMATION_ENABLED=false
DAILY_AUTOMATION_CONFIG={"userId":REPLACE_WITH_REAL_INTEGER,"autoApprove":false}
DAILY_BROWSER_STATE_PATH=/data/daily-auth/mercadolivre.json
```

Replace the template's account ID with the exact existing integer. Defaults: prepare at **19:00 for the next local date** (`planningDaysAhead:1`); send08:00–19:00 São Paulo;20–25 minute nominal cadence;30 products per audience; candidate ceiling250 per audience. Full D+1 readiness requires all30 qualified slots in both audiences, including the first/last slot and gap checks. Rating4.5, accumulated sales100, fit75 and commercial score60 remain hard gates. `planningDaysAhead:0` explicitly preserves the legacy same-day mode. `weekdaysOnly:true` applies to the sending date.

Collecting at or after the preceding day's window end preserves the24-hour evidence limit through the next window. Configuration rejects an earlier D+1 collection time. This provides an overnight repair window, not24hours of unchanged prices. Price observations are retained internally; captions omit the observation timestamp.

Discovery starts with at most50 candidates per audience, classifies them and checks the missing quota. Short audiences receive new keyword pages and new candidates, preserving successful payloads, analyses and append receipts. Empty initial pages also advance keywords. Each browser request supports50 terms; the deterministic audience bank expands through disjoint pages. Discovery stops at readiness,250 candidates per audience, bank exhaustion, or the deadline. A shortage remains a held plan and triggers an operations alert; no unrelated filler or fabricated sales evidence is added.

Reuse the existing explicitly priced, guarded AI configuration. Both Smart audiences must be enabled and bound to distinct verified groups. The worker does not create or choose groups. Apply both daily migrations through the release procedure, including discovery state and the alert outbox.

For a collection/analysis preview, set `DAILY_AUTOMATION_ENABLED=true` with `autoApprove:false`. It still uses guarded paid classification, but waits in the existing Smart review UI. After setup verification, `autoApprove:true` enables the requested unattended cycle. Configuration changes apply to the next target date without a saved run. In-progress runs resume their persisted configuration across midnight and restarts.

Automatic approval enforces the full-window minimum. An explicit approval in Smart may accept a smaller qualified selection, including a single healthy audience, while preserving novelty, quality, cadence and the 08:00–19:00 daily envelope. This is a deliberate partial-day decision by the operator. `startNow` and `advance` cannot move daily sends before the daily start time.

Optional `DAILY_BROWSER_CDP_URL` accepts a private Chromium CDP endpoint. Provision/manage that provider's session separately. The collector creates an isolated context from the state file and disconnects afterward. CDP support alone does not implement a hosted provider's session lifecycle. Never expose the credential-bearing URL in logs/frontend.

Optional `DAILY_BROWSER_PROXY_SERVER`, `DAILY_BROWSER_PROXY_USERNAME`, `DAILY_BROWSER_PROXY_PASSWORD` configure outbound proxying for locally launched Chromium. Remote browser proxies belong in the remote provider's configuration. Add proxy expense only after an observed direct-egress failure calls for it.

## Status and recovery

Read metadata rather than raw payloads:

```sql
SELECT local_date, status, plan_uuid, attempts, last_error, lease_until
FROM daily_automation_runs WHERE user_id=:user_id
ORDER BY local_date DESC LIMIT 14;
```

`ANALYZING` belongs to the existing Smart analysis worker. `SCHEDULED` is approved/queued, not delivered. Check Smart sends/provider outcomes separately. Uncertain deliveries retain manual resolution and are not replayed automatically.

`AUTH_REQUIRED` requires a fresh private session file. After fixing a collection/configuration failure with no plan, an operator may explicitly rearm today's run within its commercial window:

```sql
UPDATE daily_automation_runs
SET status='COLLECTING', attempts=0, last_error=NULL, next_attempt_at=NOW(),
    lease_token=NULL, lease_until=NULL, updated_at=NOW()
WHERE user_id=:user_id AND local_date=:local_date
  AND status IN ('AUTH_REQUIRED','CONFIG_REQUIRED','FAILED','EMPTY','OPERATOR_ATTENTION','REVIEW')
  AND plan_uuid IS NULL AND (lease_until IS NULL OR lease_until < NOW());
```

Do not clear an existing plan's request ID/input to evade idempotency or budgets. Inspect REVIEW shortages in Smart rather than automatically relaxing quality. `DAILY_AUTOMATION_ENABLED=false` plus worker restart stops new daily orchestration, **not already-approved sends**: pause/cancel the existing Smart plan separately, preserving uncertain outcomes.

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

After a Chromium-enabled worker and private `/data` volume exist, select the exact linked project/environment and run `railway service link achadinhos-worker`. Railway CLI 5.71.0 exposes `railway service files upload ./data/daily-auth /data/daily-auth` to upload the local login directory. Use `--overwrite` only to deliberately replace an existing session. Confirm the remote session file is mode 0600 and readable only by the worker; the collector atomically preserves that mode when refreshing it. The initial release has been deployed; these instructions also apply to later session renewals. The shared T3 browser's authenticated session is still not a provisioned worker session file.

`OPERATOR_ATTENTION / ACTIVE_PLAN_LIMIT` requires inspecting existing plans, especially PAUSED/UNKNOWN outcomes, before creating another. Resolve or cancel through the existing Smart workflow; never delete delivery history. Other AppError 4xx codes are retained in `last_error`. An `ANALYSIS_HOLD` polls the existing plan without starting paid retries; use the explicit Smart analysis retry control, and the same daily run automatically rejoins it while the window remains feasible. Late full-window work is recorded as `EXPIRED / LATE_ANALYSIS` instead of spending on an impossible queue. Controlled shutdown releases its lease when possible; an abrupt process loss still relies on lease expiry.

Held analysis is checked on each daily scheduler tick, with no 15-minute collection backoff and no automatic paid retry. Prior-day unapproved automation plans are canceled using their observed revision; a concurrent operator change is preserved. Cleanup failures are recorded on today's run rather than escaping before its checkpoint exists.

A newly conflicting product is removed at approval; automatic approval continues if both audiences still meet the minimum. An insufficient remainder holds with `DAILY_NOVELTY_CONFLICT` or `DAILY_INVENTORY_SHORTAGE`. Connection, revision, binding and competing-manual-campaign conflicts retain distinct codes and require operator inspection; the worker does not silently override those changes. Empty/partial collection retries at most three total attempts before any paid classification; old `EMPTY` rows can be explicitly rearmed with the SQL above.

Small but nonempty inventories still receive bounded classification so the operator can inspect and explicitly approve a qualified partial day. This trades some AI spend for recoverability; no claim is made that the full window is feasible merely because classification ran. Measure actual yield before increasing candidate limits. Browser authentication is checkpointed after each successful audience so later failures preserve already-rotated state.

If a session write fails after both audiences were collected, completed payloads are checkpointed and the run holds as `CONFIG_REQUIRED / SESSION_PERSIST_FAILED`. Repair the private volume/session file and explicitly rearm; the observations can be reused without another collection. An incomplete audience is never treated as a complete day.

Preview mode deliberately retains REVIEW plans for inspection. At the end of each preview day, approve a qualified selection within the daily window or cancel its old unapproved plan through Smart. Otherwise two retained plans cause the documented `ACTIVE_PLAN_LIMIT` hold; preview is not unattended mode.

UNKNOWN delivery pauses the whole plan and requires inspection in Smart before resolving and resuming. This intentionally preserves the existing delivery barrier for both audiences. Loja Geral receives deduplicated operational alerts when configured; the Smart status and daily-run query remain the durable inspection paths. Auth/group failures must be addressed before enabling unattended approval.

The final pre-provider window/freshness check also protects ordinary Smart sends: if preparation crosses an approved deadline, that send is skipped. It does not transport an expired offer at the boundary. Historical identity hashes and ordinary manual repeat semantics are unchanged.

Category limits are a diversity preference. Daily analysis can draw additional already-qualified reserves to reach its minimum, recording a warning; rating, demand, fit, political and freshness gates remain hard requirements. Tight late schedules have less polling/transport slack and can skip slots; D+1 preparation leaves an overnight repair window. Actual per-audience yield, collection duration and memory must be measured from the worker before unattended approval.

Default standout-copy calls are off (`maxStandouts:0`). Captions omit the observed price's timestamp, and visible flash/countdown deals are excluded. Ordinary intraday price changes remain possible: this version does not re-fetch the product before every send.


## D+1 value, readiness and alerts

Daily selection uses actual gross payout `discountedPriceBRL × commissionRate /100`. A price/demand/fit heuristic discounts expensive-item selling difficulty before normalizing payout for ranking. It is not an observed purchase probability. Production audience filters accept a positive estimated payout of at leastR$0.01, without a commission-percentage floor or a price ceiling.

The mix reserves20% of slots for qualified products up toR$100 and20% aboveR$500, when available; remaining slots use score and soft category diversity. Missing price bands do not reduce the full qualified inventory or admit weak products. The bands are interleaved through the schedule and retained in approval order.

Set `alertGroupId` to the verified Loja Geral JID for the account. Collection/authentication/configuration/analysis failures, exhausted shortages, pre-send missing plans/manual approvals, paused plans and uncertain/failed/skipped sends produce typed deduplicated events. Messages contain only plan IDs, counts, deadlines and problem codes. Pending notification transport is independent of long collection/analysis. A provider-uncertain notification is retained asUNKNOWN and never replayed automatically. Pre-provider connection checks back off safely. Total worker/database/WhatsApp outages cannot guarantee delivery of their own notification.

An automatic full D+1 plan that reaches its first slot unapproved is held with `PREPARATION_DEADLINE_MISSED`. It cannot claim a complete day by silently shifting its start. Explicit operator salvage is still possible under existing time, freshness and delivery guards.

Outbox metadata (do not dump message payloads or credentials):

```sql
SELECT status,count(*) FROM daily_automation_alerts WHERE user_id=:user_id GROUP BY status;
```
