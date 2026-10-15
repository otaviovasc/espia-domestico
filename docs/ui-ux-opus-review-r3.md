# UI/UX review — round 3 (authenticated platform)

Scope: `/painel/*` in the shared working tree vs `62283c0`. Public landing excluded. Read-only review; no saves, sends, provider calls or paid AI.
Evidence tags: **[runtime]** = observed in the T3 incognito tab (QA account, dev server :5279); **[source]** = read in code only.

## Verdict

The round-2 P1 (stale-draft send) is resolved, and so are most round-2 P2s. No P1 remains. Two P2 items and three P3 items are open. Tests, type-check and lint all pass.

## Round-2 status

| R2 item | Status | Evidence |
|---|---|---|
| P1-1 stale draft can be sent | Fixed | [runtime] campaign 8 with an unsaved name edit: "Enviar agora" `disabled`, `aria-describedby="campaign-unsaved"`, warning banner + "Ir para Salvar". Fresh reload with no edits: no banner, send enabled. So the earlier "dirty on load" suspicion was a leftover local edit, not a false-dirty. [source] `CampaignDetailPage.tsx:143` canonical `formSignature` compare; run/resume both gated on `!dirty`. |
| P1-2 studio violet/coral chrome | Fixed | [source] no `#171725`, `ff735e`, `c4b5fd` left in `src`. |
| P1-3 studio text < 12px | Mostly fixed | [runtime] DOM scan at 390px on `/ads`: no chrome text under 12px. 9px text remains only inside the stage preview mock (`AdLibraryPage.tsx:1209,1214`), which represents export artwork. |
| P2-1 login lands on `/connection` | Fixed | [runtime] login lands on `/painel/campaigns`. |
| P2-2 studio shows "saved" when load fails | Fixed | [source] `AdLibraryPage.tsx:1998-2001`: when the project fails to load, `ActionStatus` shows `unavailable`; the toolbar with "Salvo" renders only after hydration and when there is no error. |
| P2-3 no navigation guard | Fixed | [runtime] see "Runtime-verified" below. |
| P2-4 inconsistent confirmations | Fixed | [source] no `window.confirm` / `confirm(` left in `src`; campaign actions use `CampaignConfirmDialog`. |
| P2-5 compose send summary at the bottom | Fixed | [source] `ComposePage.tsx` §5 "Confirmar campanha": `role=status` summary of eligible sends, product × group pairs and warnings sits directly above the buttons. |
| P2-6 a11y leftovers | Partly open | See P3-2. |
| P2-7 top bar duplicates the title | Fixed | [runtime] the banner shows a breadcrumb ("Painel › Publicação › Campanhas › Detalhes da campanha") instead of a second H1. |

## Open defects (priority order)

### P2-1 Compose "Enviar agora" dispatches with no confirmation step
- **Scenario:** in `/compose`, the user selects products and groups and clicks "Enviar agora". `createMutation.mutate('send')` creates the campaign and immediately calls `campaignApi.run` (`ComposePage.tsx:293-311`, button at `:600`). The same action on campaign detail opens `CampaignConfirmDialog` with recipient counts.
- **Risk:** the same irreversible WhatsApp send has two different safety levels. A single misclick on the primary button in compose sends to every eligible group.
- **Evidence:** [source]. Not clicked at runtime, by rule.
- **Fix:** route compose "send" (not "schedule" or "draft") through `CampaignConfirmDialog`, reusing the §5 summary numbers.

### P2-2 Theme arrow keys change the selection, not just focus
- **Scenario:** keyboard user tabs to the "Aparência" group and presses ArrowRight on "Escuro" to move to "Sistema".
- **Observed [runtime]:** focus moved **and** the selection switched to "Sistema" immediately: `aria-pressed` changed, `data-theme` flipped from dark to light, and `localStorage['espia-theme']` changed to `system`. Each arrow press therefore restyles the whole app and persists the change. Toggle-group semantics (`aria-pressed` buttons) suggest arrows should move focus and Space/Enter should select.
- **Cause [source]:** the custom `onKeyDown` in `ThemeProvider.tsx` calls `setPreference` on Arrow/Home/End, on top of Base UI's own roving focus.
- **Fix:** drop the `setPreference` call from the arrow handler (keep focus movement only), or switch to radiogroup semantics if select-on-arrow is intended.

### P3-1 Brand name spelling diverges between the panel and the public site
- The panel now reads **"Espiã Doméstico"** everywhere: `document.title`, logo `aria-label`, wordmark, and the compact mobile brand (`WorkspaceShell.tsx:83,118,125`, `BrandLogo.tsx:14,36`, `LoginPage.tsx:22`, `NotFoundPage.tsx:9`). The landing page (`landing/index.html:43-44,314-316`) and README still say **"Espia Doméstico"**. The brief uses "Espiã" (line 11).
- [runtime] The `'Espiã Bricolage'` font family loads correctly (`document.fonts.check` returned true), so this is not a rendering bug.
- **Action:** confirm which spelling is canonical. If "Espiã" is canonical, the inconsistency is only in the out-of-scope landing page; record it for the landing owner.

### P3-2 Remaining sub-12px text in previews
- `WhatsAppBubble.tsx:139` (11px link host), `:150` (10px timestamp); `GroupMessagesPage.tsx:92` (10px timestamp); `CompositionLayers.tsx:120` (10px "Área segura"). [runtime] One 10px span on campaign detail (the bubble timestamp).
- These mimic WhatsApp or overlay the stage, so the size is defensible. The "Área segura" label, however, is editor chrome, not artwork; raise it to 12px.

### P3-3 "Salvamento pausado" label for the autosave error state
- `ActionStatus.tsx:43`, `AdLibraryPage.tsx:2006`. The status reads as if saving was deliberately paused, but the adjacent alert shows an error and offers a retry. "Falha ao salvar" (or similar) matches the actual state better. Copy only; [source].

## Runtime-verified (no defect)
- **Route guard:** clicking a sidebar link with unsaved edits opens `UnsavedChangesPrompt` (`role=alertdialog`). Focus starts on "Continuar editando", Tab stays inside the dialog, and Escape closes it, keeps the route and returns focus to the opener ("Produtos" link). "Descartar e sair" navigates. The native `beforeunload` dialog also fires on unload (it was dismissed).
- **Theme control:** a 3-button `ToggleGroup` with 46×44 targets, never a dropdown. Clicking "Escuro" sets `data-theme=dark`, `color-scheme: dark`, `meta theme-color #121926`, persists to `localStorage`, and swaps the canvas to `canvas-memphis-dark.svg`.
- **Logo/wordmark:** the yellow tag mark keeps its contrast on the dark canvas (fixed navy stroke on the yellow fill), and the wordmark follows `--app-ink`. Screenshot: `/home/marlos/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mv9nsx8i-ff87c1c7.png`.
- **Material/texture:** `main` has the Memphis SVG plus the grain data URI in both themes. Dark body: `rgb(239,244,255)` text on `rgb(18,25,38)` canvas. Body text was readable in the screenshot; no contrast ratios were computed.
- **Production asset paths:** the built `dist/painel/assets/*.css` references `/painel/brand/...` and `/painel/fonts/...`. The root-path concern from dev is cleared.
- **Mobile 390×844:** `scrollWidth == clientWidth` (390) on `/campaigns`, `/compose`, `/products`, `/ads`, `/messages`, `/connection` and `/campaigns/8`. The `/ads` tab strip is wider than the viewport but sits inside its own horizontal scroller, so the page does not overflow.
- **Checks:** `test:ui` 16/16, `test:imports` 13/13, `test:studio` 2/2, `test:creative` 42/42, `test:preview` 9/9, `tsc --noEmit` ok, `eslint .` ok.

## Preferences (not defects)
- `GroupCombobox` "Limpar grupos" clears every selected group with no undo. The selection can be rebuilt, so this is acceptable; an undo toast would be nicer.
- `ActionStatus` is fixed at `w-44`. That is stable, but long labels such as "Salvo na conta · versão N" could truncate at large text zoom. Not observed.

## Not covered / limits
- No real sends, schedules, saves, provider (UAZAPI) calls or Jev/paid classification. Send and run paths were verified by disabled state and source only.
- `GroupCombobox` popup behaviour, Escape-keeps-selection and chip removal were reviewed in source only; not exercised at 390px.
- Studio tab indicator keyboard behaviour, the `AnimatedSelection` reduced-motion path and the `Table`/`DataTable` sort/focus behaviour were source-only.
- No screen reader pass, no measured WCAG contrast ratios, no export visual comparison, no Safari/Firefox check.
- System-theme following via OS `prefers-color-scheme` emulation was not exercised; only explicit Claro, Escuro and Sistema clicks were.
- The working tree was changing during the review (the brand rename landed mid-session). Findings reflect file state at about 11:53 local time.
