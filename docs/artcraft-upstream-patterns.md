# ArtCraft media workflow patterns

Research date: 2026-10-14. This note records first-party source inspected for media creation and ads. It proposes platform-authored adaptations; no upstream application code, branding, media, model weights, or binaries were imported in this research task. No generation provider was called.

## Identity and source boundaries

[getartcraft.com](https://getartcraft.com/) links its studio to [`storytold/artcraft`](https://github.com/storytold/artcraft). Its [Craft Apps directory](https://getartcraft.com/apps) lists thirteen separate tools: PhotoCraft, VectorCraft, FilmCraft, LightCraft, PdfCraft, EffectCraft, DesignCraft, FigCraft, WordCraft, SoundCraft, DeckCraft, CADCraft, and GridCraft. The site describes early alpha or in-development status. An installer or marketing claim does not establish production readiness in this platform.

The [official GitHub organization API](https://api.github.com/orgs/storytold/repos?per_page=100) corroborated those repositories. This note inspected media workflow source in the following five repositories, rather than treating every organization repository as reusable application code.

| Repository | Exact inspected commit | License evidence |
| --- | --- | --- |
| ArtCraft | `d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373` | [README](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/README.md#license), [MIT text](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/LICENSE-MIT), [Apache text](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/LICENSE-APACHE), [NOTICE](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/NOTICE) |
| FilmCraft | `0b432e3834f983d03b2a324c8953522ddda22b57` | [Cargo.toml](https://github.com/storytold/filmcraft/blob/0b432e3834f983d03b2a324c8953522ddda22b57/Cargo.toml#L9), [README credits](https://github.com/storytold/filmcraft/blob/0b432e3834f983d03b2a324c8953522ddda22b57/README.md#license-and-credits) |
| LightCraft | `3b4279fc2485bb51847c0071a1b3c514aa0f98f4` | [Cargo.toml](https://github.com/storytold/lightcraft/blob/3b4279fc2485bb51847c0071a1b3c514aa0f98f4/Cargo.toml#L8), [README credits](https://github.com/storytold/lightcraft/blob/3b4279fc2485bb51847c0071a1b3c514aa0f98f4/README.md#license-and-credits) |
| DeckCraft | `ea904591a59d01c9af75c2e7ef5730227da3e3a3` | [Cargo.toml](https://github.com/storytold/deckcraft/blob/ea904591a59d01c9af75c2e7ef5730227da3e3a3/Cargo.toml#L9), [README credits](https://github.com/storytold/deckcraft/blob/ea904591a59d01c9af75c2e7ef5730227da3e3a3/README.md#license-and-credits) |
| SoundCraft | `3a28a657692c1b98b28c276d8f61df9471074f0f` | [Cargo.toml](https://github.com/storytold/soundcraft/blob/3a28a657692c1b98b28c276d8f61df9471074f0f/Cargo.toml#L9), [README credits](https://github.com/storytold/soundcraft/blob/3a28a657692c1b98b28c276d8f61df9471074f0f/README.md#license-and-credits) |

Each inspected project declares `MIT OR Apache-2.0`, at the recipient's option. GitHub's license classifier reports Apache-2.0 and does not capture this full dual-license declaration. Code import must preserve the applicable notice and copyright text; bundled assets require their own license checks. `artcraft-services` is a separate repository whose GitHub license field reports `NOASSERTION`; its affiliation does not establish a usable license.

ArtCraft's pinned [NOTICE](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/NOTICE) explicitly excludes Nintendo sound effects, memes and likenesses, some skybox textures, third-party MMD motion data, and Mixamo animation renders. It also separates provider logos and ArtCraft trademarks. FilmCraft, LightCraft, DeckCraft, and SoundCraft README credits exclude ArtCraft branding and require forks to remove it. These exclusions matter if someone later proposes whole-directory imports.

## Patterns worth adapting

### A media library that can answer a specific editing task

LightCraft's [`crates/catalog/src/query.rs`](https://github.com/storytold/lightcraft/blob/3b4279fc2485bb51847c0071a1b3c514aa0f98f4/crates/catalog/src/query.rs#L18-L69) combines free-text search with kind, rating, pick/reject flags, labels, keywords, edited state, dates, and albums. Its [`token_matches`](https://github.com/storytold/lightcraft/blob/3b4279fc2485bb51847c0071a1b3c514aa0f98f4/crates/catalog/src/query.rs#L117-L154) handles fielded search tokens such as `type:video` and `name:product`. Text matches metadata as well as filenames. Its [sort model](https://github.com/storytold/lightcraft/blob/3b4279fc2485bb51847c0071a1b3c514aa0f98f4/crates/catalog/src/query.rs#L71-L114) supports a seeded, stable shuffle.

FilmCraft's [`crates/project/src/find.rs`](https://github.com/storytold/filmcraft/blob/0b432e3834f983d03b2a324c8953522ddda22b57/crates/project/src/find.rs#L61-L108) stores search bins as named queries, not copied asset lists. Results follow asset changes. Rows specify a column, an operator, and text; queries choose all or any matching rows and case sensitivity.

Safe adaptation: add search and kind filters over our existing `AdAsset` list; search filename, display name, and available metadata. Add saved filters only after the query contract and account scoping exist. For a compact ads library, start with images, videos, audio, and currently selected assets. A "ready for vertical" filter must use real dimensions rather than invented tags. A library filter must never remove selected clips from the project.

The seeded-shuffle idea is useful for reproducible campaign variants. Store the seed and source order so revisiting a draft produces the same arrangement. Do not reshuffle on every React render or randomly modify an approved campaign.

### Ordered selection with clear reference limits

ArtCraft's native [`artcraft-native/src/overlays/library_picker.rs`](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/artcraft-native/src/overlays/library_picker.rs#L20-L66) tracks the media kind, maximum selectable items, already-attached IDs, ordered selection, and pagination. It ignores an out-of-order page response and deduplicates media tokens. Its [tile renderer](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/artcraft-native/src/overlays/library_picker.rs#L160-L196) shows duration, numbered selection badges, and already-attached state.

Safe adaptation: use numbered selection in bulk add-to-carousel and add-to-sequence actions; preserve click order. Show the Instagram slide limit next to the count. Disable incompatible media choices for music/reference slots. Account for existing slides before adding a selection, and deduplicate only where the workflow forbids duplicate references. Deliberately duplicated timeline clips remain valid editing choices.

### Campaign starters that instantiate editable media projects

DeckCraft's [`crates/engine/src/templates.rs`](https://github.com/storytold/deckcraft/blob/ea904591a59d01c9af75c2e7ef5730227da3e3a3/crates/engine/src/templates.rs#L1-L36) defines a `Starter` with name, summary, theme, and ordered `SlideSeed` entries. Each entry has a layout, title, body placeholders, and notes. Its own starter text is original to DeckCraft.

Safe adaptation: newly author ad recipes such as product showcase, before/after, limited offer, and mixed-media demonstration. A recipe should explain how many assets it needs and then populate our existing project configuration and slide editor. For a product showcase, instantiate a hook slide, a product-detail slide, a benefit slide, and a call-to-action slide. Copy and ordering belong to our recipe, not to an invented upstream ads feature.

Recipes should preview their change before applying, use real project asset IDs, preserve the existing product selection, and define how existing text and clip edits are handled. Missing assets should leave explicit editable placeholders. Do not silently reuse one image across all slides or insert fake product claims. A reusable recipe schema can later support export/import with a version and bounded fields; the inspected source does not prove a compatible cross-app recipe format.

### A storyboard with semantic sections and durable media references

ArtCraft's [`frontend/libs/components/moodboard/src/lib/boards/BoardLibraryStore.ts`](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/frontend/libs/components/moodboard/src/lib/boards/BoardLibraryStore.ts#L23-L91) separates persisted boards and item order from transient search and selection. Boards have sections, and items can move between sections. Its [persistence configuration](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/frontend/libs/components/moodboard/src/lib/boards/BoardLibraryStore.ts#L540-L566) drops blob-backed items because browser object URLs expire after a reload.

Safe adaptation: show a campaign storyboard as ordered cards labeled hook, product, benefit/proof, offer, and action. Connect each card to an existing clip or carousel slide rather than maintaining a second conflicting order. Add a short creative note to a card only through a validated project field. Display notes in editing and keep them out of the rendered ad unless the user chooses visible text.

Persist asset IDs and stable backend URLs. Keep search query, hovered item, and current selection in UI state. A draft must not restore a `blob:` URL as if it were durable media. If a storyboard becomes a separate planning artifact, version it and resolve missing media explicitly.

### Nondestructive variants and resettable edit settings

LightCraft's [`crates/catalog/src/model.rs`](https://github.com/storytold/lightcraft/blob/3b4279fc2485bb51847c0071a1b3c514aa0f98f4/crates/catalog/src/model.rs#L204-L281) keeps settings, versions, history, and virtual copies separate from the source file. A virtual copy shares the original file and has its own metadata and editing history.

Safe adaptation: create alternate ad looks through `clipEdits` and project duplication rather than reuploading or rewriting source assets. Offer a reset-to-project-default action for framing, crop focus, motion, volume, and text. A bulk apply action should name which settings it copies and preserve clip duration, source trim, and identity unless explicitly selected. Reversible edits should participate in the existing draft/revision path.

### Project storage belongs to the hosting platform

ArtCraft's browser editor [`media-manager.ts`](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/frontend/libs/components/video-editor/src/lib/core/managers/media-manager.ts#L8-L13) routes persistence through the host's storage adapter. Asset addition [deduplicates IDs and rolls back a failed registration](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/frontend/libs/components/video-editor/src/lib/core/managers/media-manager.ts#L26-L62); clearing media [revokes object URLs](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/frontend/libs/components/video-editor/src/lib/core/managers/media-manager.ts#L122-L136).

Its [`project-manager.ts`](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/frontend/libs/components/video-editor/src/lib/core/managers/project-manager.ts#L89-L169) delegates save/load to a host adapter and closes the prior project before restoring the next project's scenes, media, caches, and autosave. The comments identify its OpenCut ancestry; copying the entire editor subtree would need a separate ancestry/dependency audit.

Safe adaptation: preserve our backend project API, autosave conflict behavior, and ownership checks. Changing projects must clear preview playback, selection, undo/draft state, and old object URLs. Imported UI utilities must not add a second persistence system that bypasses revisions or saves one account's draft into another account's project.

### Generation estimates precede provider uploads

ArtCraft's [`video_generation_draft.rs`](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/crates/api_clients/artcraft/artcraft_router/src/generate/generate_video/video_generation_draft.rs#L45-L59) separates a draft cost estimate from finalization, which may upload assets to a provider. [`video_generation_cost_estimate.rs`](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/crates/api_clients/artcraft/artcraft_router/src/generate/generate_video/video_generation_cost_estimate.rs#L1-L16) records credits, cents, free/unlimited status, rate limits, watermark, and nullable failure-refund policy.

Safe adaptation: distinguish local render preflight from paid generation. A provider estimate must include the actual model, aspect ratio, duration, reference count, and known/unknown cost. An unknown price must remain unknown. Use our authorized provider APIs and durable job IDs; no browser-session extraction or consumer-service private endpoints are needed for the media editor. The inspected code suggests request staging, but this research did not verify any provider behavior or price.

### Timed captions use source-media time, then map into the edit

FilmCraft's [`crates/project/src/transcript.rs`](https://github.com/storytold/filmcraft/blob/0b432e3834f983d03b2a324c8953522ddda22b57/crates/project/src/transcript.rs#L1-L31) stores words against source-media time with speaker and confidence. Reusing or trimming a clip leaves the source transcript valid; the sequence derives its transcript through edit mappings. Its [normalization and validation](https://github.com/storytold/filmcraft/blob/0b432e3834f983d03b2a324c8953522ddda22b57/crates/project/src/transcript.rs#L98-L141) handle empty words, reversed bounds, overlaps, and speaker references.

[`crates/project/src/caption.rs`](https://github.com/storytold/filmcraft/blob/0b432e3834f983d03b2a324c8953522ddda22b57/crates/project/src/caption.rs#L73-L167) separates track style from non-overlapping timed caption blocks. It uses a language tag and explicit anchors/margins; font sizes refer to a 1080-line frame.

Safe adaptation: support manual timed captions or validated SRT/WebVTT import before any paid speech-recognition work. Store source timing separately from output timing and remap through trim, order, and speed. Use the same caption layout calculation in browser preview and FFmpeg output. Test line wrapping, Unicode, boundary overlap, muted clips, and vertical safe areas. Caption styles should be editable without replacing the transcript text.

### Timeline snapping and audio dynamics need explicit units

ArtCraft's [`timeline/snapping/resolve.ts`](https://github.com/storytold/artcraft/blob/d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373/frontend/libs/components/video-editor/src/lib/timeline/snapping/resolve.ts#L4-L32) chooses the closest snap point within a distance threshold; ties preserve the caller's point priority. This is useful if our sequence editor gains drag timing. Define whether each value is seconds, frames, or pixels and compute the threshold from zoom.

SoundCraft's [`crates/dsp/src/plugins/dynamics.rs`](https://github.com/storytold/soundcraft/blob/3a28a657692c1b98b28c276d8f61df9471074f0f/crates/dsp/src/plugins/dynamics.rs#L11-L58) has compressor/limiter controls with dB, millisecond, ratio, and knee units. This supports a future voice/music balance workflow, but does not prove that a ready-made ad ducking workflow exists. Adapt through our existing FFmpeg renderer only when the preview can represent the result and meaningful audio fixtures confirm peak limits and voice intelligibility.

## Suggested sequence for this platform

1. Add media search/kind filters and ordered bulk insertion. Verify that hidden selected media remains selected and rendered.
2. Add original project starters that instantiate existing editable video/carousel configuration. Test empty and partially populated projects, aspect ratio, slide limits, and source-asset preservation.
3. Add resettable/bulk clip looks through existing edit fields. Test the same framing/color changes in preview and a real rendered fixture.
4. Add storyboard semantics to the same clip/slide model if needed. Avoid a second independent ordering store.
5. Add manual timed captions and explicit local-render preflight. Paid generation, speech recognition, automatic publishing, and provider-model routing require their own verified contracts.

The local graph was selected as `home-marlos-projects-espia-domestico`; paginated symbol discovery found `AdProjectConfig`, `AdAsset`, `ClipSequenceEditor`, `AdVideoRenderer`, and the project service/controller. Current `achadinhos-frontend/src/lib/api.ts` already has image/video carousel slides, `clipEdits`, framing, color presets, hooks, and text styles. The recommendations use those contracts rather than assuming the prior features are absent. Upstream source was researched through complete GitHub tree responses (`truncated: false`) and pinned raw files; those remote repositories were not cloned or indexed locally. This note does not establish source coverage for the remaining eight Craft Apps, runtime compatibility, deployment, or provider integration.
