# ArtCraft-inspired studio changes

Implemented locally on 2026-10-14. Eleven subagents covered source research, architecture, UX, six implementation areas, integration checks, provenance, and two independent code-review rounds. Changes are uncommitted and have not been deployed.

## Source and reuse

All thirteen applications linked by [ArtCraft's app directory](https://getartcraft.com/apps) were inspected, along with the main studio. The [source inventory](artcraft-research.md) records exact commits, releases, licenses, relevant capabilities and exclusions. The [source-pattern report](artcraft-upstream-patterns.md) links the specific library, layout, command and persistence implementations examined.

The additions below are original TypeScript/React/FFmpeg implementations of selected workflows. No native Rust editor, codec, WASM distribution, ArtCraft logo, sample media, or paid image/video provider was imported. The preview font and its license were copied from this platform's existing DejaVu export assets. Existing OpenCut history code retains its separate MIT notice.

| Source ideas | Addition in this platform |
| --- | --- |
| PhotoCraft, VectorCraft, main ArtCraft composition | Non-destructive text, rectangle/ellipse and image layers with position, size, opacity, visibility, ordering and duplication. |
| LightCraft, FilmCraft library selection | Type/name/tag/product filtering, ordered bulk insertion, metadata badges, capacity checks, progress and partial recovery. |
| FilmCraft, SoundCraft audio finishing | Opt-in loudness targets of -16/-14/-12 LUFS with 48 kHz AAC and a -1.5 dBTP processing target. |
| DeckCraft, DesignCraft, FigCraft layouts | Reviewable presentation, comparison and offer recipes, optional CTA and preserved factual text, source media, recrops and audio. |
| Structured exchange and editable starter patterns | Versioned JSON recipe export/import, explicit replacement review, validated values and remapped project-owned media references. |
| FilmCraft export checks and review workflows | Export blockers/advisories, completed-render matching, captionless carousel support, and safe-area guides that remain above opaque layers. |

CAD, full document/spreadsheet/PDF applications, native plugin hosting, arbitrary keyframe graphs, automatic background removal, 3D tools and paid image/video generation were evaluated for relevance but are not implemented or advertised as available. Existing crop, color, motion, presets, products, ZIP exports, calendar and manual metrics remain in use.

## Behavior

- Up to eight global layers appear above existing captions on every video scene or carousel slide. Image layers use owned project images, including transparent PNGs, without changing originals. Preview and render use the same output-coordinate geometry, wrapping and font.
- Image references are validated for ownership and media type. Duplication and format adaptation remap them; referenced media cannot be deleted. Reusable templates retain text/shape layers and strip project image references.
- Audio finishing runs after gain/fades/mixing. Dynamic normalization resamples to 48 kHz before AAC encoding. Silent/muted media remains silent. The live preview plays the original gain; the exported file is the reference for normalization. LUFS and true-peak settings are processing targets, not guarantees for every short or mostly silent clip.
- Video recipes add an optional CTA as a visible layer in every scene, rather than putting it into a rotating caption pool. Carousel recipes can append the CTA to the last slide. Factual text is preserved and applying a recipe is one undoable update.
- JSON recipes contain configuration, texts and media names/metadata, not media files, account/product IDs, credentials or private media endpoints. Import rejects unsupported fields/versions, invalid values, missing or ambiguous media, foreign references and normalized duplicate layer IDs. Current product links remain attached. Files are limited to 1 MB. Async reading and review guard against project/configuration changes.
- Bulk library insertion saves each success against the latest confirmed revision. Durable optional UUID receipts return the same asset after an accepted POST loses its response. Session recovery retains pending keys and asset IDs, reconciles lost saves/deletes, and preserves edits or Undo performed after failure. A changed draft produces a visible conflict instead of being overwritten. Internal receipts are not exposed as user-editable studio records.
- Export readiness separates blockers from resolution/crop/safe-area advisories and identifies completed files matching current render settings. Carousel saving/rendering accepts empty global video texts. Captionless carousel-to-video conversion supplies an editable generic call to action.

## Verification

Final commands and outcomes:

```sh
cd achadinhos-backend
npm run test
npm run validate
node --test test/ad-audio-finishing.test.cjs test/ad-composition.test.cjs
cd ../achadinhos-frontend
npm run build
npm run lint
node --experimental-strip-types --test test/ad-*.test.mjs
cd ..
AD_MEDIA_QA_PORT=3108 node scripts/validate-ad-media.cjs --serve
git diff --check
```

- Full backend suite: 89 tests passed. After review fixes, the seven composition/audio tests passed again against the rebuilt backend. Final backend typecheck/lint passed. The isolated integration suite separately exercises the new durable attachment receipts.
- Final frontend suite: 53 tests passed, including 15 workbench, 16 library/recovery, nine readiness, and two composition tests, plus existing preview/history/calendar checks. Build passed. Lint had zero errors and the two preexisting warnings in WhatsAppBubble and GroupMessagesPage. The new `npm run test:creative` command runs the new focused feature suites.
- Real FFmpeg assertions covered XML escaping, wrapping, opacity, order, hidden layers, image-only layer sources, mixed JPG/MP4 output, captions beneath layers, volume, silence, true peak, sample rate and duration.
- Disposable PostgreSQL/API/storage/worker checks passed: existing migrations, ownership/type/limits, deletion protection, copied references, template image stripping, captionless format conversion, concurrent attachment replay, uppercase UUID replay, mismatched/deleted/foreign receipt rejection, immutable render snapshots, ZIP content, range downloads and final worker renders.
- Actual 1080×1350 JPG pixels: green card `[0,255,0]`, magenta label `[253,0,253]`, orange image edge `[228,93,59]`, white inset center `[251,253,251]`. Carousel MP4 and final 1080×1920 video checks passed at the corresponding positions. Normalized final AAC was 48 kHz and measured **-13.99 LUFS**.
- Authenticated collaborative-browser acceptance used only the disposable QA account. It confirmed layers above captions, hide/undo restoration, bundled font loading, safe guides at z-index 20 above composition at 12, fullscreen/Escape focus restoration, recipe export with no private media fields, 3/3 media remapping, review-before-apply, undoable layout application, library insertion and audio-setting autosave.
- Browser fault injection suppressed one successful attachment response. The UI retained selection and reported the network error; retry sent the same UUID. Fresh API evidence showed exactly one copied asset and one selected slide, with no remaining alert. Temporary browser interception was restored afterward.
- At 390×844, carousel/video, media tools and recipe panels had zero horizontal overflow. The carousel canvas used 356 px; the expanded video dialog used the full 390 px and restored focus after Escape.

The first isolated run encountered a transient `ECONNRESET` while polling a render; it cleaned up and the rerun passed. The harness now retries at most two consecutive resets for read-only status GETs, while HTTP/render/assertion failures and mutations remain unretried. The collaborative browser briefly disconnected; reconnecting through the native preview tools completed the remaining checks.

## Review iterations

Independent review found and corrected 96 kHz normalized AAC, omitted/repeating video CTA placement, recipe ID normalization, guide stacking, lost attachment responses, loss of recovery state on remount, accepted cleanup with a lost DELETE response, and recovery overwriting subsequent factual edits or Undo. Final backend/frontend reviews reported no remaining material findings in the changed scope. The provenance review verified all thirteen inventories/licenses and 46 pinned links; its main-studio dual-license wording correction was applied.

## Release and environment boundaries

No new database migration is required for these JSON fields or internal receipts. The existing `20261005000002-ad-studio.js` migration must already be applied before using the studio API/worker on a normal database. Only disposable local databases were changed during validation; they and the task's development processes were removed after browser acceptance.

Local storage was exercised. Remote S3 acceptance, production accounts, native upstream binaries, paid image/video generation, deployment and Meta posting were not exercised. Instagram publication and metrics remain manual. The work remains on the current main branch without staging, commits, pushing or deployment. The current baseline includes the separate `0d6a0fd` product-merge change; those files were preserved.
