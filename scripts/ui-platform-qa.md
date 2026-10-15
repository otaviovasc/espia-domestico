# Local platform UI QA

Build the backend once after source changes, then run from the repository root:

```sh
npm --prefix achadinhos-backend run build
node scripts/ui-platform-qa.cjs --serve
```

The API listens on `http://127.0.0.1:3118`. Point the frontend development proxy
for `/api` at this address. Login with `platform-qa@example.invalid` and
`Platform-QA-local-2026`. `UI_QA_PORT` overrides the port; `--disconnected` starts
the connection scenario disconnected. Without `--serve`, the script verifies
fixture creation and immediately cleans up. It requires the local PostgreSQL
connection in `achadinhos-backend/.env`, FFmpeg, and installed backend dependencies.

Each run creates a uniquely named disposable PostgreSQL database and temporary
media directory. It rejects non-loopback database hosts. Ctrl+C/SIGTERM closes
the local server/render queue, drops only that run's database, and deletes its
temporary directory. The ready output includes a manifest path, route fixture
IDs, and the QA account. `/api/v1/__qa/info` identifies the fixture process.

## Evidence boundaries

- Auth, API validators, database persistence, media upload/probe, private asset
  handling, duplicate remapping, and the local FFmpeg render queue are real.
- UAZAPI methods are replaced on the prototype **only inside this process**,
  before dependency injection resolves the application. Status, lifecycle,
  groups, webhooks, and sends are simulations. Sends receive IDs prefixed
  `qa-not-sent-` and persist only in the disposable database. No WhatsApp
  instance or message is created outside this process.
- The connection starts connected. Disconnect/reconnect presents a synthetic QR
  (or `QA12-3456` pairing code), then simulates connection after 12 seconds. The
  QR is a local illustration and cannot pair a phone.
- Put `[falhar]` in a manual message to receive an intentional 502 and verify
  visible failure feedback. Invalid/empty campaigns and negative product prices
  use real API validation, checked during startup.
- External HTTP is blocked in this Node process. `OPENROUTER_KEY` is emptied;
  AI classification/copy is unavailable, so failure feedback can be inspected
  without a paid request. External media/music imports cannot download files.
- All product links and published post URLs use `example.invalid`. Product
  pictures are local illustrations; video/audio fixtures are real generated
  files. The catalog images route through `/api` for the frontend proxy.
- Campaign scheduler is off. The seeded running campaign and its counters are
  a static scenario; a fixture heartbeat keeps its running presentation current.
  Manual campaign run/resume uses the real send loop with the simulated client.
- Campaign history, participant messages, publication metrics, scheduled times,
  and provider failures are fictitious. This environment proves local UI/API
  workflows; it does not prove real provider delivery or external publication.

## Seeded scenarios

Six A/B/C/D products, two custom catalog groups, one custom classification
profile, seven campaign states (draft, scheduled, running, paused, completed,
failed, cancelled) with mixed logs, four WhatsApp groups and two chat threads.
Creative studio includes a mixed image/video carousel, a vertical video with
audio, reusable image/video library items, a brand, a template, a scheduled
publication, and a published record with explicitly fictitious manual metrics.
Startup renders one small vertical video locally, required by the real published
record contract. New renders submitted from the UI also run locally.

Smart Campaigns also includes five audiences, two synthetic review plans and one
paused plan. Product assessments are directly seeded local fixtures, not paid
AI results. Audience saves and plan edits use the real API and database. AI is
explicitly disabled; new migrations apply only to the disposable database.
