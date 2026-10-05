# Creative studio implementation and validation

Implemented locally on 2026-10-05. Changes remain in the working tree; no deployment or production migration was performed.

## Available workflows

- Insert still images into video sequences and create mixed image/video Instagram carousels.
- Import owned saved-product images and commercial facts, with visible per-product download errors.
- Bulk upload mixed media in order; reorder or duplicate slides; apply slide text styles across the carousel.
- Adjust trim, playback speed, volume/mute, focus, crop and image pan/zoom. Animated image slides export as MP4; static slides export as JPG.
- Save projects automatically to the account with optimistic revision checks. Recover local drafts, retry failed saves, reload conflicts, and undo/redo edits. Media deletion clears history so undo cannot restore missing files.
- Store reusable media independently of projects, with SHA-256 deduplication, tags, search, linked products and ownership checks.
- Save brand styles, reusable carousel layouts/text/captions, and account-synced video presets. Existing browser presets migrate using content-derived keys.
- Create independent Feed, Carousel, Reels and Stories variants with copied media and separate framing.
- Request and edit AI text suggestions. The model selects approved calls to action; title, price, coupon and link are assembled from saved products.
- Download completed renders as a ZIP containing numbered JPG/MP4 files, `caption.txt`, `cover.jpg` and a render manifest. Captions and ordering come from the render snapshot.
- Plan manual Instagram publication dates, associate completed render jobs, and record published URLs and timestamps.
- Record manual creative metrics linked to products. Rates show their denominator; sales and revenue stay unassigned until an attribution source is supplied.

## Preview UI

The project selector replaces the wide project column. Video and carousel canvases use the available width without nested padding. A compact toolbar, playback controls and numbered scene navigation replace repeated labels and help text. Safe-area and platform overlays are optional, with the safe area hidden initially. Export/render details expand on demand.

The enlarged view is an in-app dialog, compatible with embedded browsers. Background controls become inert, Tab stays in the preview, Escape closes it, and focus returns to the opening control. Carousel video playback and sound controls sit outside the cropped media so they remain accessible.

## Evidence

Final gates:

```sh
cd achadinhos-backend
npm run test
npm run lint
cd ../achadinhos-frontend
npm run build
npm run lint
npm run test:preview
npm run test:studio
cd ..
AD_MEDIA_QA_PORT=3105 node scripts/validate-ad-media.cjs
```

- Backend: 77 tests passed, including real FFmpeg output checks for moving image pixels, trimmed audio volume, mixed carousel rendering, and the concurrent extension task's transport-stream tests.
- Frontend: build passed; 9 preview tests and 2 studio tests passed. Lint has no errors and retains two preexisting warnings in WhatsAppBubble and GroupMessagesPage.
- Isolated PostgreSQL/API/storage/worker checks passed: migrations, ownership, upload validation, revisions (one concurrent write succeeds and one returns 409), media deduplication and independent copies, paginated/searchable records, template slide layouts, publication validation, attribution requirements, ZIP contents, real motion/trim/mute rendering, and format variants.
- Final isolated QA mocks only remote product-image HTTP and AI calls. Earlier live checks separately downloaded an HTTPS image from httpbin and obtained a real OpenRouter response while retaining the saved price, coupon and URL.
- Collaborative browser acceptance covered autosave, undo/redo, cross-device conflict/reload, product-image imports, editing/applying AI suggestions, brands/templates, media reuse, calendar records and metrics. The revised preview was checked at desktop and 390px mobile sizes without document overflow, including direct slide navigation, playback, sound, enlarged view, Escape and focus restoration. Retrying a conflicted save retained the local draft and left the remote revision intact; reload restored the remote name.

## Release boundaries

Apply `20261005000002-ad-studio.js` before starting the updated API/worker against a normal database. Only isolated QA databases have received this migration in this task. All task-owned QA databases, temporary media directories and development processes were removed after acceptance.

Publication dates are a manual planning workflow. No Meta publishing integration or automatic posting is included. Metrics are manually entered; no Instagram insights ingestion is claimed. AI commercial facts reflect the saved catalog snapshot, so stale catalog prices remain possible. Native previews approximate visual effects; the rendered final preview remains the reference. Local storage was verified; remote S3 acceptance was not exercised.

OpenCut classic command/history code was imported under MIT with its full notice included in source and distributed assets. See [the upstream research and exact pinned sources](open-source-editor-research.md).
