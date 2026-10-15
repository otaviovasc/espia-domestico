# UI/UX review — round 2 (Kiro / Opus)

Scope: authenticated `/painel` routes, login, dialogs, and studio. Public landing pages are out of scope and were not reviewed. Baseline is `62283c0`. The review covers the shared working tree as of 2026-10-15 ~11:15–11:35 BRT. Other agents were still editing the tree during the review (Vite HMR reloaded `index.css`, `ComposePage`, `AdLibraryPage`, `ProductCatalogPage` and others, and one full page reload), so a line number may have moved by the time you read this.

Evidence labels:
- **[runtime]**: observed in my own incognito tab at `http://127.0.0.1:5279/painel` with the synthetic QA account, at 1280×800 and 390×844, light and dark.
- **[source]**: inferred from reading the code, not exercised in the browser.

I did not log out of, or change anything in, the shared default-profile session.

## Verdict

The round-1 P0 fixes hold. The foundation (tokens, theme, shell, dialogs) is sound. It is **not ready to approve**: one P1 is a real-send risk, and several brief requirements are only partly met (product-led default route, studio chrome palette, 12 px text floor, unsaved-work guards).

## Round-1 fixes: do they hold?

| Round-1 finding | Status | Evidence |
|---|---|---|
| Offer picker sent on click | **Fixed** | [runtime] On `/messages`, Oferta → choosing a catalog item opens a WhatsApp preview. Nothing is sent until "Enviar oferta para o grupo" is clicked. No send request appeared in the network log. |
| Image checkbox ignored by preview | **Fixed** | [runtime] With the dialog checkbox on, the preview contains 1 `<img>`; with it off, 0. The dialog checkbox and the page checkbox share the same state. |
| Unconfirmed campaign cancel | **Fixed, but inconsistent** | [source] `CampaignDetailPage.tsx:616` uses `window.confirm`. Disconnecting the number uses a styled `<dialog>`. Deleting a studio project uses an inline confirmation (`AdLibraryPage.tsx:~2052`). That is three different confirmation patterns (see P2-4). |
| Labels not bound / modals not dialogs | **Fixed** | [runtime] My audit script found no unlabeled inputs on any route except three studio `file` inputs (P2-6). In the offer dialog, Escape closes it and focus returns to the "Enviar oferta" opener (checked with a real click, not a scripted one). The dialog is a native `showModal()` `<dialog>` with `aria-labelledby`. |
| Purple gradient / emoji chrome | **Fixed in the shell, still present in the studio** | [source] `.brand-gradient` is now solid accent (`index.css:132`). Violet and coral remain in the stage chrome (P2-1). |
| Tiny text | **Partly fixed** | [runtime] There is no text under 12 px on campaigns, compose, products, messages or connection. `/ads` has **57** text nodes under 12 px (10.2–11.2 px), for example "Inverter ordem", "Limpar seleção", "Cenas planejadas", "Variação 1", "Corte seco" and the time readouts. |
| Stage pushed down by tools | **Fixed** | [runtime] At 390 px the stage starts at y=346. "Ferramentas" is near the bottom (y≈3433). Settings are grouped `<details>` with value summaries ("Ritmo e formato · Personalizado · 6s · 1 va…"). |
| Theme contract | **Holds** | [runtime] `/painel/theme-init.js` is served (200) and `/theme-init.js` returns 404, so the script is scoped to the app. `data-theme`, `color-scheme` and `meta[theme-color]` update together. A `storage` event switches the theme across tabs. [source] No render, export or preview code reads the theme; `data-theme` is only used in `lib/theme.ts` and `index.css`. |
| Dark mode leakage | **Clean** | [runtime] A computed-style scan in dark mode found light backgrounds only in intended media: the WhatsApp wallpaper `#e5ddd5`/`#efeae2` and the white product-thumbnail tile on compose. The only dark-on-light text found was `accent-foreground` on accent buttons, which is intended. |
| Horizontal overflow | **Clean** | [runtime] At 390 px and 1280 px, no route overflows: `scrollWidth` minus `clientWidth` is 0 for both the document and `main`. |

## Findings, prioritized

### P1-1 — "Enviar agora" on a draft discards unsaved edits and sends immediately
- **Where:** `CampaignDetailPage.tsx:273` (`runM.mutate()`); `runM` is defined at `:154`.
- **Scenario [source]:** The user opens a draft campaign, edits the template, groups or safety settings, and clicks "Enviar agora" without clicking "Salvar". The page calls `campaignApi.run(campaignId)` directly, so the server sends the **previously saved** template and groups to real WhatsApp groups. The page has no dirty tracking, no "Salvar e enviar" path, and no confirmation, even though this button starts real sends.
- **Fix:**
  1. Track a dirty flag against the loaded campaign.
  2. While dirty, either disable "Enviar agora" with the hint "Salve as alterações antes de enviar", or chain save → run.
  3. Put the start behind the same confirmation component used for cancel. Have it state the number of pairs and groups ("Enviar 6 ofertas para 2 grupos agora?").
  4. Apply the same guard when the user navigates away with unsaved edits (P2-3).

### P1-2 — Studio stage chrome still uses the old violet/coral palette
- **Where:** `index.css:482` (`.ad-stage-panel { background:#171725 }`, a violet-tinted navy). Also `:527` (coral `rgba(255,115,94)` focus ring), `:624` (lavender `#c4b5fd` focus ring) and `:657` (`accent-color:#ff735e` on the scrubber).
- **Observed [runtime]:** Dark theme at 1280 px. The stage is the only blue-violet object on a green-slate page. Its focus rings are coral or lavender, while the rest of the app uses the green accent.
- **Why P1:** The brief asks for a single green/slate palette and removal of generic AI styling. The stage is the most prominent surface on `/ads`.
- **Fix:**
  - Move the stage to a neutral dark that does not depend on the theme, for example `#111614` as proposed in round 1, so media colours can still be judged.
  - Replace both focus rings and `accent-color` with `var(--app-accent)`. Use the dark-theme accent value inside the stage so it keeps contrast on the dark background.
  - This touches chrome only. `ad-preview-*` composition and export rendering stay unchanged.

### P1-3 — The studio's control column is still below the 12 px floor
- **Where:** `ClipSequenceEditor.tsx:330–466` (27 uses of `text-[11px]`); `AdLibraryPage.tsx:1372–1411` (`text-[10px]`/`[11px]`); `index.css:513,546,598,671` (0.64–0.68 rem, about 10–11 px, for stage toolbar labels, audio status and time).
- **Observed [runtime]:** 57 text nodes under 12 px on `/ads`. Some of these are buttons: "Inverter ordem" and "Limpar seleção" are 78×17 px text buttons, and "Usando" is 58×28 px.
- **Fix:**
  - Set a 12 px minimum outside the video canvas overlay. The overlay mimics the exported layout and can stay as is.
  - Give text buttons at least a 32 px height on desktop and 44 px on coarse pointers.
  - `ClipSequenceEditor.tsx:369` hardcodes `text-amber-700`, which is low-contrast on the dark surface. Use `text-warning`.

### P2-1 — Post-login landing is still the Connection settings page
- **Where:** `App.tsx:42`, `App.tsx:45`, `LoginPage.tsx:29`. All three redirect to `/connection`.
- **Observed [runtime]:** Logging in lands on "Conexão do WhatsApp". That conflicts with "product-led routes" in the stated responses.
- **Fix:**
  - Default to `/campaigns`, or `/products` if the catalog is the intended entry point.
  - Show connection state in the shell instead, for example a status line under the brand. Show a banner on send pages only when the number is disconnected.

### P2-2 — The studio header reports a saved state while loading has failed
- **Observed [runtime]:** During a backend restart, `/api/v1/ad-projects` returned 500.
  - The header still showed "Salvo na conta · versão 1", with Desfazer and Refazer visible but disabled.
  - Below it, the alert read "Não foi possível carregar seus projetos — Request failed with status code 500".
  - The raw axios message reached the user.
- **Fix:**
  - Hide the save-status line and the undo/redo controls when no project is loaded.
  - Map transport errors to plain copy: "O servidor não respondeu. Tente novamente em alguns segundos." Keep the technical detail in a disclosure.

### P2-3 — Long workflows have no guard against navigating away
- **Where [source]:** `beforeunload` exists only in `AdLibraryPage.tsx:1814`. Nothing uses `useBlocker`. There is no guard in:
  - `ProductCatalogPage`, where the classification session is held in page memory after **paid** Jev calls (the README tells users to keep the page open).
  - `ComposePage`.
  - `CampaignDetailPage` draft edits.
- **Also:** The studio's `beforeunload` does not catch in-app sidebar navigation.
- **Fix:** Add one shared `useUnsavedChangesGuard(dirty, message)`. It should combine `beforeunload` with react-router's `useBlocker`, which needs a data router, or an intercepted `NavLink` click. Use it on these four pages.

### P2-4 — Destructive confirmations use three different patterns
- **Where:**
  - Native `confirm()`: `CampaignDetailPage.tsx:595` (remove product), `:616` (cancel), and `AdLibraryPage.tsx:1930/1981` (switch or reload a project with unsaved changes).
  - Styled `<dialog>`: disconnect.
  - Inline text: delete project, remove product group (`ProductCatalogPage.tsx:746–751`).
- **Issue:** Native `confirm` cannot follow the theme, cannot name the button ("Cancelar campanha" versus "Manter"), and is blocked in some embedded webviews.
- **Fix:** Use a single `ConfirmDialog`, built on the existing `ConnectionMessagesDialog` pattern, everywhere. Give the destructive action a specific verb label and the safe choice the default focus.

### P2-5 — Compose still puts the send decision at the bottom
- **Where:** `ComposePage.tsx:451` (top summary) and `:597` (send button).
- **Observed [runtime]:** The top summary bar shows only "N produtos · N grupos · Revisar envio". The deciding numbers appear only in section 5, about four screens down on mobile: eligible pairs, already sent, in another campaign, without confirmation, and without commission.
- **Fix:**
  - On desktop (`lg+`), make section 5's figures plus the Enviar/Agendar/Rascunho buttons a sticky right rail.
  - On mobile, add a compact sticky bottom bar: "6 envios disponíveis · Revisar".

### P2-6 — Accessibility details
- [runtime] The dialog close button's accessible name is "Fechar enviar oferta", because the title is lowercased and prefixed. Pass an explicit `closeLabel`, for example "Fechar".
- [runtime] Three studio `<input type=file>` elements have no label and no `aria-label`. If they are triggered by visible buttons, add `aria-hidden` plus `tabIndex={-1}`; otherwise label them.
- [runtime] Some checkboxes are native 13–18 px boxes: product selection on `/products` (18×18), "Incluir …" on compose (16×16), and the resend checkbox on campaign detail (13×13). Where they sit inside a full-width `<label>` the hit area is fine. The bare per-row selectors on `/products` and compose need a 44 px label or cell on coarse pointers.
- [source] `Spinner` always renders `role="status"` (`ui.tsx`). `App.tsx` `LoadingPage` wraps it in another `role="status"`, and buttons that contain spinners turn into live regions. Add a `decorative` prop (`aria-hidden`) for spinners inside labelled containers.
- [source] `GroupMessagesPage.tsx:52` uses a purple sender name (`#6941a5`) and `:92` a 10 px timestamp. These sit inside WhatsApp artwork, so they are acceptable as media, but the timestamp is the only time information. Make it 11–12 px.

### P2-7 — Shell hierarchy
- [runtime] The 48–56 px top bar repeats the page title ("Conexão WhatsApp", "Campanhas") directly above an `<h1>` with almost the same text. On desktop it also repeats the brand. That is duplicated chrome on every route.
  - Desktop: drop the bar, or use it for connection status and global actions.
  - Mobile: keep only the menu button, brand and status.
- [runtime] The campaign-detail breadcrumb link "Campanhas" is 94×20 px. Give it `min-h-11`, as on the error state.

### P3 — Copy and polish
- [source] `ConnectionPage.tsx:75` shows "— nenhum —", and a bare "Status:" label appears. Use sentence copy, for example "Webhook não configurado nesta instância".
- [runtime] The studio heading reads "Prévia 360:640". Show the ratio users know ("9:16 · 1080×1920") instead of the internal preview size.
- [runtime] At 1280×800 the stage's transport row (play/pause and scrubber) starts at y≈840, below the fold, because three rows sit above the stage: title, undo/redo plus save status, and a full-width project selector. Merging undo/redo and the project selector into the title row brings the transport into view without shrinking the stage.
- [source] Delivery counts on campaign detail colour "já enviada(s)" as warning. Sent is not a warning; use neutral or success, and keep warning for "sem confirmação".

## Coverage and limits

- **Not run:** build, lint, or the `test:*` suites. This review does not certify them.
- **Not exercised, to avoid mutating shared QA data or incurring paid calls:**
  - the JSON import and Jev classification flow;
  - saving products;
  - campaign create, run, cancel or pause;
  - render jobs;
  - carousel export.
  
  Their dialogs and guards were reviewed from source only.
- **Theme:** dark and light were checked by computed-style scans and two screenshots: studio dark at 1280 px and campaign detail dark at 390 px. I did not measure WCAG contrast ratios numerically. Reduced motion and an OS-level theme flip in system mode were not emulated.
- **Exported media:** the claim that theme never changes exported media is based on source inspection (nothing in render or preview reads `data-theme`). No before/after comparison of exported files was done.
- **Not tested:** screen readers, and keyboard tab order beyond the offer dialog and the shell skip link.
- The default-profile tab I opened was used read-only on `/connection`. All interaction happened in a separate incognito tab.
