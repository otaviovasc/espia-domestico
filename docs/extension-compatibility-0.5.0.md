# Extension 0.5.0 compatibility

Checked on 2026-10-05 against `/home/marlos/projects/afiliados-extension` and this checkout. Changes remain local; no commit, push or deployment was performed.

## Adaptations

- Full and compact `cards[]` imports preserve captured commission estimates, search filters, selection provenance and review-video receipts in `offer.extensionEvidence`. Classification, save validation and the saved-product JSONB field retain this evidence. No database migration is required for these changes.
- Optional metadata is bounded. Invalid metadata produces an import warning while the valid product remains importable. Queued entries default to `pending`; interrupted native downloads remain importable. Workstation download IDs are dropped and filenames retain only their basename.
- Import review and the saved catalog show the captured BRL estimate and completed/requested video counts. Expanded details link to the ad library and explain the separate file upload.
- The ad library accepts MPEG-TS (`.ts`, including generic binary MIME uploads), checks sync bytes and probes the actual media. H.264/AAC streams are remuxed to MP4; other codecs are transcoded to H.264/AAC. Stored assets use MP4 MIME, converted size and normal preview/render paths. Temporary input and conversion files are removed.

Video receipts are evidence, not uploaded media. The JSON importer does not fetch the receipt URLs or access files on the user's computer. Upload downloaded clips separately in the ad library. The existing clip limits remain 2 minutes and `AD_MAX_CLIP_MB` (100 MB by default). The extension can download larger files, so a successful extension download alone does not establish platform upload eligibility. The existing Nixpacks setup includes FFmpeg and ffprobe; no runtime package change is needed.

## Verification

- Backend build and lint pass. All 75 backend tests pass, including full/compact evidence retention, invalid optional evidence, queued/interrupted receipts, actual TS remuxing, MPEG-2/MP2 transcoding and decoding, and existing video rendering behavior.
- Frontend build passes. Lint has zero errors and two existing warnings in `WhatsAppBubble.tsx` and `GroupMessagesPage.tsx`. Existing frontend import tests (13) and preview tests (9) passed during this task.
- `node scripts/validate-bulk-import.cjs --serve --extension-path=/home/marlos/projects/afiliados-extension` passed isolated API/PostgreSQL import, classification, save and list readback using actual extension exporter outputs. It also passed the existing 5,000-item, 123-item and multi-file lanes. The evaluator was mocked; no paid classification request was made.
- `node scripts/validate-ad-media.cjs --extension-review=/home/marlos/projects/afiliados-extension/web-ext-artifacts/video-validation/review-1.ts` passed TS upload, MP4 download, audio retention, invalid TypeScript rejection and rendering alongside existing media workflows. The actual downloaded Mercado Livre review uploaded as MP4, 16.5 seconds at 1080×1920.
- The shared browser imported an actual extension-produced JSON fixture through the catalog UI, classified it, saved it and reloaded. The R$24 estimate and 1/3 completed-video count persisted. Expanded guidance and the ad-library link worked; the clip picker includes `.ts`. At 390px, the new saved-catalog evidence had no horizontal page overflow.

## Release boundary

Deploy both the backend and frontend adaptations before relying on the new evidence display and TS uploads on the hosted platform. Existing import formats remain accepted. Production rollout, hosted storage conversion and paid classification were not verified in this task. The extension's live signed-in native add-on workflow remains separate from its native fixture and live media checks; see its `docs/validation-0.5.0.md`.
