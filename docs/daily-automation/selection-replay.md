# Offline daily selection replay

`achadinhos-backend/scripts/replay-daily-selection.cjs` replays exported observations and stored classifications through the current analysis worker, selection and automatic approval. It never starts a sender or browser. The intelligence, group and connection interfaces are stubbed; HTTP and fetch calls are disabled. Missing classifications are not inferred. Rating, sales and freshness gates remain active.

Use a disposable migrated PostgreSQL database on localhost port 55450. The harness creates isolated users, imports their historical ledger and removes those users in `finally`; it does not truncate shared tables. Do not point it at an existing application database.

```sh
cd achadinhos-backend
export DATABASE_URL=postgresql://dailyqa:dailyqa-local-only@127.0.0.1:55450/dailyqa
npx sequelize-cli db:migrate
npm run build
node scripts/replay-daily-selection.cjs --snapshot /absolute/path/snapshot.json --out /absolute/path/replay.json --forecast
```

Optional `--plan <uuid>` limits historical replay. `--approval-at-production-time` advances the clock and reloads history at the recorded approval time, separating delayed operator approval from immediate automatic approval. `--forecast-only --forecast` runs just the two November 12, 2026 inventory stress scenarios. The forecast date is deliberately fixed to the investigation; edit it for another evaluation.

The export contract is `{version, exportedAt, plans, runs, audiences, deliveries, sends}`. Rows use database snake-case column names; plan input/settings/items and run payloads retain their original JSON shapes. Plans need offers, observation timestamps, stored `analysisResults` and frozen `audienceProfiles`. Destination IDs, group names and connection scopes must be replaced consistently with stable pseudonyms before export. Keep exports outside the repository. The production export must use only SELECT inside an explicitly read-only transaction; the replay itself requires no production access.

Each plan is independent. History is reconstructed from retained rows created by collection time, excluding that plan's own sends. Deliveries completed later are conservatively treated as reservations. Deleted rows and intermediate transitions cannot be recovered from these tables. The planning clock is the later of plan creation and the last retained observation. The default approval is immediate; real AI latency is not reconstructed. Original manual plans are labelled counterfactuals under current daily gates, not evidence that daily automation ran on those dates.

Forecasts reuse the most recent real card shapes and classifications, including today's 58 reservations. One retains actual timestamps and should fail freshness; the other assumes a real re-observation at collection time. Timestamp refresh is a simulation assumption, not renewed marketplace evidence. Later discovery returns empty cards, exercising finite keyword/hub exhaustion, repeat fallback and approval of the qualified remainder. These scenarios establish behavior and remaining-inventory bounds, not the yield of tonight's live browser collection or performance/resource cost.

Results include planning/approval counts, raw and usable reserve depth, rejection histograms, history conflicts, repeats, price bands/targets, category families, score/fit and slot freshness, plus actual plan/send outcomes. Usable reserve depth is conservative: distinct fresh reserves after current selections and history exclusions, evaluated against the last full-window slot. Actual sends reflect the export instant, not future delivery acceptance. Replays are deterministic in eligibility/counts; UUID-seeded schedules may vary gaps within policy.

Variant aliases do not rewrite ledger identities. Explicit brand/model signatures for JBL Boombox generations, Dolce Gusto Genio S Basic/Plus/Touch, WAP GTW 10 and Mondial L-99 FB also match retained Mercado Livre ledger titles inside the existing batched cooldown query. The same group, uncertainty and cooldown rules apply to those matches. Kits/accessories and other model generations remain distinct. Other sufficiently descriptive exact titles share an alias only within a selection; they do not become cross-day history matches. Remaining seller/kit/size variants require stronger product-family evidence. Category normalization and preference improve spread when qualified alternatives exist; they never reject the qualified remainder to enforce a quota.

Run the two database integration suites after building, then `JWT_SECRET=local-test-only-secret-at-least-thirty-two-chars npm test` and `npm run lint`. Do not build into the same `dist/` while a test/replay is running.
