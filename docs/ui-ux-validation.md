# Espiã internal platform UI validation

Date: 15 October 2026. Working tree based on `62283c0d53d7657c73a630eba3f30cafa26ffb83`. This is local implementation and fixture verification, not a production deployment. Public landing pages were excluded.

Subsequent upstream pulls and Smart Campaigns integration: [reconciliation and current validation](ui-smart-campaign-reconciliation.md). The original results below record the pre-pull pass.

## Delivered scope

All eight authenticated/login page modules and their shared controls were reviewed and changed: login, connection, compose, group messages, saved catalog/import, campaign list, campaign detail, and media studio. Added useful app404 and guarded logout. Shared theme, navigation, typography, brand assets, dialogs, loading/failure states and responsive material were rebuilt.

Final visual direction: Azul oferta light/dark palette, original eye/price-tag SVG logo, corrected **Espiã** wordmark with self-hosted Bricolage Grotesque, Manrope headings and IBM Plex Sans body. Direct accessible light/dark/system buttons replace the theme dropdown. Rounded structural controls, short offset shadows, finegrain texture and original bounded Memphis vectors provide depth. Customer-facing WhatsApp/media artwork is independent of display theme.

[Research index](ui-registry-research-index.md) counts62 distinct source families and records actual selected registry integrations and license boundaries.19 GPT6.1 Sol child workers handled disjoint implementation/research/verification lanes. Kiro `claude-opus-5.5` and AGY `gemini-3.8-flash-high` contributed independent audit/review rounds; their reports remain separate evidence.

## Automated checks

- `node --experimental-strip-types --test test/*.test.mjs`: **82/82 passed**. Includes13 import workflow,6 catalog state,7 theme/contrast,3 error-message,2 studio,42 creative/media/readiness and9 preview-parity tests.
- `npm run lint`: passed with no errors/warnings.
- `npm run build`: TypeScript and Vite passed; no missing-font or oversized-main-chunk warnings on final build. Routes remain lazy loaded.
- `git diff --check`: passed.
- Static build served on5289: theme initializer, favicon, both Memphis SVGs, all three WOFF2 font families and UI notices returnedHTTP200 with correct actual content, not an HTML fallback.
- Public home, bio and masculine HTML in built output remain byte-for-byte equal to their unchanged source. No backend source, migration, environment variable or production setting was changed by this UI task.

## Browser and persistence evidence

The native T3 browser was used against Vite5279 and disposable API3118. Real local auth, validators, PostgreSQL persistence, media upload/probe/private assets and local FFmpeg fixture render were exercised. UAZAPI was process-local mocked, AI/externalHTTP disabled and the scheduler off. No real messages or external publications were sent.

| Area | Verified cases |
| --- | --- |
| Shell/auth | Wrong/successful login, focused failure, meaningful campaigns home, real authenticated/anonymous404, mobile drawer Tab/ShiftTab/Escape/restore, guarded logout, skip link and route focus |
| Theme | Direct3way selector, exactly one pressed choice; arrows/Home/End move focus without changing preference, Space/Enter activate; persistence/reload, OS light/dark only in system mode, explicit override and actual cross-tab storage synchronization; blocked-storage invariants covered by tests |
| Catalog/import | Populated/empty/filter failures and successful retries, filter selection clearing, other-page selection disclosure, edit/profile fields, responsive review cards/contained tables; unsaved input/evaluated/partial work retained on stay, fully saved receipts no false block |
| Compose | Product/group selection, preserved selection under filtering/refetch, BaseUI multiselect keyboard/clear/chips/Escape, correct member/admin summary, real preview, safety/schedule validation, unsaved guard and save-navigation bypass; real fixture draft persistence never starts/schedules |
| Pagination | Temporarily created55 uniquely identified products in disposable DB. Browser entry made exactly `limit=50&offset=0`, displayed50/61, then explicit load-more made exactly `limit=50&offset=50` and displayed61/61. All55 were removed and original six-product fixture restored |
| Campaigns | All seven statuses, list filters/no-results, real invalid/missingID404, query failure/retry, canonical dirty state, safe send/resume/cancel/remove confirmations. Unsaved draft cannot start saved content; measured zero `/run` and `/cancel` calls while exercising/dismissing confirmation flows |
| Connection/messages | Safe disconnect dismissed with connection unchanged, loading/error/retry, mobile list/detail, draft retained after simulated502, polling preserves reader position and exposes new-message action, catalog offer selection requires explicit preview/send, image checkbox matches preview |
| Studio | Image/video carousel and video project, eight tool workspaces, actual media playback, fullscreen/Escape/focus, stable controlled tab indicator and retained tool drafts, real saved→unsaved→saving→saved status, invalid-save and missing-project feedback/retry, file labels and native deletion confirmation dismissal |
| Navigation drafts | Links, browserBack, logout and browser-close prevention for meaningful compose/catalog/profile/campaign/studio edits; staying retains values, intentional successful saves bypass one transition |
| Motion | Pointer/keyboard response and static reduced-motion branches; Studio indicator/ActionStatus live preference changes simulated using tab-local matchMedia with real change events, restored after test. Native OS reduced-motion emulation was unavailable |

Primary desktop/mobile checks were390px and1280/1440px in both themes. Additional parent spot checks at320px and768px confirmed catalog/compose/main/header contained width. This is browser CSS viewport testing, not a real-device keyboard/screen-reader certification or low-end hardware performance profile.

## Representative final captures

- [Built login, corrected Espiã wordmark](/home/marlos/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mv9npret-e731fa4c.png)
- [Built mobile login](/home/marlos/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mv9nprjo-8cf9c415.png)
- [Final light catalog, corrected Espiã branding and price hierarchy](/home/marlos/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mv9pmc82-492bbf8f.png)

Some earlier captures in worker reports precede the final accent correction from Espia to Espiã. The current DOM title, accessible logo names, visible wordmark and SVG asset titles were rechecked after correction; the Bricolage font is loaded with the accented glyph. Internal storage keys, recipe formats, domain and repository identifiers retain their compatible ASCII names.

## Review disposition and limits

Round2 Opus P1 stale-draft send risk was fixed and reproduced with real disposable persistence and zero run calls. Chrome contrast/tiny controls, truthful save state, labels, project error/retry, native confirmation consistency and navigation draft guards were addressed. Gemini's raw transport feedback and hidden-selection concerns were addressed. Manual publication/metrics remain explicit. Full-catalog search still applies to explicitly loaded pages and says so; no mount-time unbounded fetch was reintroduced.

Both third-round receipts were read: [Opus](ui-ux-opus-review-r3.md) and [Gemini](ui-ux-gemini-review-r3.md). Their remaining issues were resolved as follows:

- Immediate compose send now opens a themed confirmation listing campaign name, products, destination names, eligible combinations, image setting and resend warning. Real browser verification found initial focus on “Voltar à revisão”; Escape closed it and returned focus to “Enviar agora”. Instrumented XHR recorded only preview/history checks and **zero campaign-create or run calls** while opening/dismissing it.
- Theme keyboard navigation now moves focus independently of preference. Real browser dark→ArrowRight focused Sistema while preference stayed dark; Space activated system mode.
- Editor safe-area guide text is now12px; autosave failures say “Falha ao salvar”. Generic server “Validation failed” is translated into Portuguese with a field-review action; focused tests passed.
- Espiã is intentional user-directed internal branding. Public pages remain excluded from this change.

Auxiliary Studio drafts now contribute to the route/project guard independently of the main project autosave. Brand name/signature, media tags, unapplied generated copy, calendar fields and metrics retain separate save baselines. Planner/metrics stay mounted across tool tabs. Switching edited records or projects prompts before discarding; successful saves advance only the relevant baseline. Calendar creation resets before refreshing the list, avoiding accidental repeat creation if refresh fails.

Final real-fixture browser checks: calendar title edit blocked navigation and survived continuing; successful calendar save reset the form and allowed navigation. Brand signature edits and metrics edits survived tool switches. Undoing the signature to baseline did not clear the independent metrics guard. Project switching while auxiliary drafts existed showed “Trocar de projeto?” and retained project2 on cancel. Saving metrics allowed clean navigation. A new brand saved successfully; a subsequent negative-impressions metrics save failed real validation and still blocked navigation, preserving the draft. Disposable QA records were used throughout.

Final integrated verification after auxiliary draft changes: all82 frontend tests, full ESLint and TypeScript/Vite build passed. The final validation-message change also passed its focused3-test suite and repeated build/lint. No backend source changed. T3 browser locator errors and immediate pre-commit DOM reads were resolved using fresh snapshots, supported locators and explicit readiness checks; assertions use settled state.

QA cleanup completed: API3118, Vite5279 and static5289 were stopped. A read-only local PostgreSQL query confirmed zero databases named `achadinhos_ui_qa_1792073969522_613468`; `/tmp/achadinhos-ui-qa-vrQONx` no longer exists. This also removed all disposable brand/calendar/metrics records created during verification.

This report does not claim production account UI, provider delivery, external publication, actual screen-reader compatibility, real-device performance, or production rollout. No commit/push/deploy was made for this overhaul.
