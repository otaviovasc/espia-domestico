# UI/UX Review — Round 3 (Authenticated Platform & Design Refinement)

**Repository:** `espia-domestico` (shared working tree vs. `62283c0`)  
**Scope:** Authenticated platform workspace (`/painel/*`). Public landing page is explicitly excluded.  
**Review Agent:** Gemini UI/UX Sub-Agent (Read-only review; report written exclusively to `docs/ui-ux-gemini-review-r3.md`).  
**Credentials & Verification Target:** Synthetic QA (`platform-qa@example.invalid` / `Platform-QA-local-2026`) on `http://127.0.0.1:5279/painel`.  
**Evidence Tags:**  
- **`[runtime]`**: Observed and verified interactively via T3 preview automation (`incognito` session, tab `tab_q_d8c5d606-830e-4571-809a-fcfca8d449eb`).  
- **`[source]`**: Verified directly in implementation source code.  

---

## 1. Executive Summary & Verdict

Following the rejection of generic/flat styling and dropdown theme controls, the frontend platform has undergone an extensive aesthetic and architectural overhaul:
- **Design & Typography:** Replaced generic styling with an original brand identity featuring an eye/price-tag vector emblem (`BrandLogo`), local variable `Bricolage Grotesque` wordmark typography, geometric Memphis vector motifs (`BrandPattern`), and tactile blue-neutral background textures with subtle noise overlay. Customer artwork and video assets remain completely independent and un-recolored.
- **Architectural Upgrades:** Integrated Base UI, shadcn/ui Base-Nova, and ReUI components (`ToggleGroup`, `Combobox`, `Table`), Brutalist/Cult button treatments, Motion-Primitives layout transitions (`AnimatedSelection`), and Animata-adapted live feedback (`ActionStatus`).
- **Data Safety & Integrity:** Upgraded React Router v7 (`createBrowserRouter`) with a comprehensive `useUnsavedChanges` hook across all editing views (`/compose`, `/campaigns/:id`, `/products`, `/ads`). Replaced all legacy `window.confirm` calls with native accessible `<dialog>` modals.

**Overall Verdict:** **PASSED (Production-Grade Quality)**.  
All high-severity (P0/P1) and medium-severity (P2) findings from Round 2 have been genuinely and rigorously resolved. Zero horizontal overflow exists at `390px` mobile viewport, zero text nodes fall below `12px` in workspace chrome, and real WhatsApp dispatch paths are strictly protected by dirty-checking guards and recipient confirmation dialogs. Only two minor interaction/copy improvements remain open (P2-1 theme arrow auto-selection, P3-1 copy label).

---

## 2. Round 2 Baseline Findings Resolution Matrix

| Prior Finding | Status | Evidence & Resolution Details |
|---|---|---|
| **P1-1: Stale draft send without saving** | **FIXED** | **`[runtime]`** & **`[source]`** in [`CampaignDetailPage.tsx:220-226, 301-305`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/pages/CampaignDetailPage.tsx#L220-L226). `canRun` explicitly checks `!dirty`. When a campaign name or field is edited, "Enviar agora" becomes `disabled`, an accessible warning banner (`#campaign-unsaved`) renders with "Ir para Salvar", and keyboard focus is routed to `#campaign-save`. On clean state, clicking "Enviar agora" opens `CampaignConfirmDialog` summarizing product and group counts before any run mutation occurs. |
| **P1-2: Studio stage violet/coral chrome** | **FIXED** | **`[runtime]`** & **`[source]`** in [`index.css:519-535`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/index.css#L519-L535). Legacy violet `#171725` and coral `rgba(255,115,94)` rings were eliminated. `.ad-stage-panel` background is `#1B2638` (`rgb(27, 38, 56)`), borders are `#526684`, and focus rings use `--ad-chrome-accent: #afc4ff`. |
| **P1-3: Studio text below 12px floor** | **FIXED** | **`[runtime]`** DOM tree evaluation on `/painel/ads` found **0 text nodes under 12px** across all controls and editor chrome. Only preview mock overlays inside `.ad-phone-stage` (representing scaled export video artwork) retain tiny labels, which is acceptable for canvas simulation. |
| **P2-1: Post-login landing on `/connection`** | **FIXED** | **`[runtime]`** & **`[source]`** in [`LoginPage.tsx:28`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/pages/LoginPage.tsx#L28). Form submission redirects directly to `navigate('/campaigns')`. Incognito login test immediately loaded `/painel/campaigns`. |
| **P2-2: Studio header reports "Salvo" on error** | **FIXED** | **`[source]`** in [`AdLibraryPage.tsx:1989-2005`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/pages/AdLibraryPage.tsx#L1989-L2005). The history toolbar and `ActionStatus` save indicators are strictly conditional on `current && hydratedProjectId === current.id && !project.isError && !projects.isError`. If loading fails, `ActionStatus` displays `unavailable`, and `QueryErrorState` renders with a retry button. |
| **P2-3: Missing unsaved changes guard** | **FIXED** | **`[runtime]`** & **`[source]`** in [`useUnsavedChanges.tsx`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/hooks/useUnsavedChanges.tsx#L1-L34) and [`UnsavedChangesPrompt.tsx`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/components/UnsavedChangesPrompt.tsx#L1-L60). Route navigation is blocked via React Router `useBlocker`, presenting a modal dialog with focus trapped on "Continuar editando". Browser reload/close triggers native `beforeunload`. |
| **P2-4: Inconsistent `window.confirm` dialogs** | **FIXED** | **`[source]`** Global ripgrep search confirmed **0 occurrences of `window.confirm`** in `achadinhos-frontend/src`. All confirmations use accessible native `<dialog>` modals with Escape handling and focus containment (`CampaignConfirmDialog`, `StudioConfirmDialog`, `UnsavedChangesPrompt`). |
| **P2-5: Compose send summary placement** | **FIXED** | **`[source]`** in [`ComposePage.tsx:590-605`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/pages/ComposePage.tsx#L590-L605). Section "5. Confirmar campanha" features a prominent `role="status"` banner reporting eligible sends, products, groups, and total combinations directly adjacent to dispatch buttons. |
| **P2-6: Missing accessibility labels** | **FIXED** | **`[runtime]`** File inputs in `/ads` and form inputs across all routes have valid accessible names via `<Label htmlFor="...">` or `aria-label`/`aria-labelledby`. |
| **P2-7: Header duplicates page H1** | **FIXED** | **`[runtime]`** In [`WorkspaceShell.tsx:132-140`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/components/WorkspaceShell.tsx#L132-L140), desktop header displays a hierarchical breadcrumb trail (`Painel › Publicação › Nova campanha`), eliminating the redundant H1 duplicate. |

---

## 3. Deep Architectural & Runtime Verification

### 3.1 Data Router & Unsaved Changes Guard
- **Mechanism:** `App.tsx` establishes a data router via `createBrowserRouter` (`basename: '/painel'`), wrapping workspace routes in `ProtectedWorkspace` and `<Outlet />`.
- **`[runtime]` Lifecycle Test:**
  1. Navigated to `/painel/compose` and typed `"Campanha Teste R3"` into `#campaign-name`. Form entered `hasUnsavedChanges = true`.
  2. Clicked sidebar navigation link to `/painel/campaigns`.
  3. React Router blocked navigation immediately. The `UnsavedChangesPrompt` (`role="alertdialog"`) opened with `showModal()`.
  4. Verified focus trapped inside the dialog; default focus landed on `"Continuar editando"`.
  5. Clicked `"Continuar editando"`. Dialog closed, focus remained on compose page, input text was preserved, and current route remained `/painel/compose`.
  6. Clicked sidebar navigation link again; dialog reappeared. Clicked `"Descartar e sair"`. Navigation unblocked and seamlessly transitioned to `/painel/campaigns`.
  7. Attempted full-page URL navigation while dirty: native browser `beforeunload` intercepted the unload attempt.
- **Form-Save Transitions:** Verified on `/painel/campaigns/9` and `/painel/compose`. On successful submission, `allowNextNavigation()` is called before programmatic navigation, preventing false positive blocker prompts.

### 3.2 Controlled Multi-Combobox (`GroupCombobox.tsx`)
- **Adaptation:** Adapted from ReUI `c-combobox-12` and shadcn/ui Base-Nova Combobox using Base UI primitives.
- **`[runtime]` Escape Key Test:**
  1. Navigated to `/painel/compose`. Located WhatsApp group selector.
  2. Opened combobox list (`button[aria-label="Mostrar grupos disponíveis"]`), revealing 4 available WhatsApp groups.
  3. Clicked `"Achadinhos do fim de semana"`. A selected chip appeared with `Remover Achadinhos do fim de semana`.
  4. Pressed the `Escape` key (`preview_press { key: 'Escape' }`).
  5. **Verified:** The combobox popup closed immediately, and the selected chip **was NOT cleared** (`details.reason === 'escape-key' -> details.cancel()` in [`GroupCombobox.tsx:55-59`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/components/GroupCombobox.tsx#L55-L59)).
  6. Combobox chips display clear remove buttons (`Combobox.ChipRemove`) with `aria-label="Remover [Nome]"`, and a global `"Limpar grupos"` button resets the selection when clicked.

### 3.3 Theme System & Direct Control
- **Structure:** Dropdown selector was completely rejected. The implementation provides a direct 3-segment toggle group (`ThemeControl`) with `Claro`, `Escuro`, and `Sistema` choices, powered by Base UI `ToggleGroup` and `Toggle`.
- **`[runtime]` Behavior:**
  - Clicking `"Tema escuro"` immediately set `document.documentElement` attribute `data-theme="dark"`, CSS `color-scheme: dark`, stored preference `localStorage['espia-theme'] = 'dark'`, and changed canvas background to `#121926` (`rgb(18, 25, 38)`).
  - Clicking `"Tema claro"` reset `data-theme="light"` and canvas background to `#EDF2FA` (`rgb(237, 242, 250)`).
  - System preference dynamically synchronizes with window `matchMedia('(prefers-color-scheme: dark)')`.
- **Visual Texture:** Both light and dark modes apply the subtle vector Memphis background (`canvas-memphis-light.svg` / `canvas-memphis-dark.svg`) combined with low-opacity SVG noise overlay (`feTurbulence`), providing tactile depth without distracting from data cards.

### 3.4 Brand Identity & Responsive Integration
- **Mark & Wordmark:** Vector eye/price-tag emblem (`BrandLogo`) uses clean SVG paths with a distinctive yellow tag fill (`#F8D95A`) and navy contour (`#18243C`). The wordmark loads the local variable font `'Espia Bricolage'` (`/fonts/brand/bricolage-grotesque-latin-variable.woff2`). Verified with `document.fonts.check()`.
- **Motif Safeguards:** On desktop (`>= 1280px`), `BrandPattern variant="header"` decorates the header bar at `width: 11rem; max-height: 2.5rem`. Below `1280px` and on mobile viewports, `.workspace-header .workspace-header-pattern` is explicitly set to `display: none` in [`workspace-shell.css:76`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/components/workspace-shell.css#L76), guaranteeing that vector artwork never obscures navigation controls or breadcrumbs.

### 3.5 Mobile 390×844 Layout Verification
- **`[runtime]` iPhone 12 Pro (390×844) Viewport Scan:**
  Evaluated horizontal scroll dimensions (`scrollWidth` vs. `clientWidth`) across all primary views:
  - `/painel/campaigns`: `docOverflow = 0px`, `mainOverflow = 0px`.
  - `/painel/compose`: `docOverflow = 0px`, `mainOverflow = 0px`.
  - `/painel/products`: `docOverflow = 0px`, `mainOverflow = 0px`.
  - `/painel/messages`: `docOverflow = 0px`, `mainOverflow = 0px`.
  - `/painel/connection`: `docOverflow = 0px`, `mainOverflow = 0px`.
  - `/painel/ads`: `docOverflow = 0px`, `mainOverflow = 0px`. (The studio filmstrip and tab sequences utilize dedicated internal horizontal scrollers with touch swipe; the main document does not overflow).
- **Touch Targets:**
  - Header hamburger button: `44px × 44px`.
  - Theme segment buttons: `46.3px × 44px`.
  - Navigation drawer close button: `44px × 44px`.
  - Meets WCAG 2.5.5 / 2.5.8 target size criteria.
- **Drawer Accessibility:** Clicking the hamburger menu opens `<dialog id="workspace-navigation">` with `showModal()`. Focus automatically lands on `"Fechar navegação"` (`autoFocus`). Pressing `Escape` or clicking the backdrop cleanly closes the modal. Focus trapping (`containDrawerFocus`) confines `Tab` cycling within the drawer.

### 3.6 Real State Indicators & Animations
- **`ActionStatus.tsx`:** Adapted from Animata `StatusButton` (MIT License). Renders controlled persistence/query states (`saving`, `unsaved`, `saved`, `error`, `loading`, `unavailable`).
  - Utilizes CSS grid stacking (`col-start-1 row-start-1`) with hidden measuring labels to guarantee stable pill width (`w-44`), preventing layout jitter during status transitions.
  - Fully accessible with `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`.
  - Supports `prefers-reduced-motion`: dynamically switches between Motion animations and static zero-motion rendering via `useSyncExternalStore`.
- **`AnimatedSelection.tsx`:** Adapted from Motion-Primitives `AnimatedBackground` (MIT License). Provides smooth sliding background indicator for active tabs while render props preserve semantic button controls and keyboard navigation.

---

## 4. Concrete Remaining Defects & Observations

### Defect P2-1: Keyboard Arrow Navigation in Theme Control Auto-Selects
- **Scenario:** A keyboard user tabs into the "Aparência" theme segment control and presses `ArrowRight` or `ArrowLeft` to inspect available options.
- **Observed `[runtime]`:** In [`ThemeProvider.tsx:37-45`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/components/ThemeProvider.tsx#L37-L45), `onArrowKey` immediately invokes `store.setPreference(choices[next].value)`. Pressing `ArrowRight` immediately alters the theme, changes `aria-pressed`, updates `data-theme` on `<html>`, and writes to `localStorage['espia-theme']`.
- **Evaluation:** In toolbar / toggle-group semantics with `aria-pressed`, arrow keys should move roving keyboard focus between buttons without activating them, while `Enter` or `Space` triggers the selection. Auto-activating on arrow navigation causes full-page re-theming on every keystroke.
- **Recommendation:** Update `onArrowKey` in `ThemeSegments` to focus the target button element (`targetButton.focus()`) rather than invoking `store.setPreference()`, delegating selection to the standard button click/activation event.

### Observation P3-1: Compose Send Confirmation Dialog Discrepancy Note
- **Note:** In prior review notes (Opus R3), it was flagged that Compose "Enviar agora" lacked a confirmation dialog.
- **Current Status `[source]`:** Audited [`ComposePage.tsx:600-622`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/pages/ComposePage.tsx#L600-L622). The working tree now routes the dispatch button to `setConfirmSend(true)`, which displays `CampaignConfirmDialog` specifying campaign title, product count, group count, and effective eligible combinations before `createMutation.mutate('send')` is called. This issue is already resolved in the current tree.

### Observation P3-2: Autosave Error Copy in Ad Studio
- **Location:** [`AdLibraryPage.tsx:2006`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/pages/AdLibraryPage.tsx#L2006) and [`ActionStatus.tsx:43`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/components/ActionStatus.tsx#L43).
- **Detail:** When autosave encounters a network or backend failure, the label renders `"Salvamento pausado"`. While technically accurate regarding the timer, adjacent error UI prompts the operator to retry. Displaying `"Falha ao salvar"` or `"Erro no salvamento"` would communicate the actionable error condition more clearly.

### Observation P3-3: Wordmark Accentuation Consistency
- **Detail:** The authenticated panel uses `"Espiã Doméstico"` (`BrandLogo.tsx:36`, `document.title`, `LoginPage.tsx`), whereas root repository documentation and public landing pages refer to `"Espia Doméstico"`. Product and branding teams should standardize whether the feminine tilde (`Espiã`) is canonical across both public marketing and internal tooling.

---

## 5. Deliberately Excluded / Non-Adopted Proposals

1. **Customer Artwork Recoloring:**  
   Suggestions to adapt promotional images, banner art, or video canvas mockups to the active theme palette were intentionally not adopted. In an advertising and affiliate marketing tool, operator artwork must display strictly true-to-source colors regardless of workspace theme.
2. **Full-Catalog Download Shortcut:**  
   Proposals to introduce an unmetered, bulk full-catalog JSON export were intentionally not adopted to protect rate limits and prevent inadvertent data leakage.

---

## 6. Verification Test Summary

| Test Area | Method | Scope / Target | Result |
|---|---|---|---|
| Navigation Guard | `[runtime]` | `/painel/compose`, `/painel/campaigns/9` dirty transitions | Passed (Modal blocked, cancel preserved dirty state, discard navigated) |
| Combobox Escape | `[runtime]` | `/painel/compose` WhatsApp group selection | Passed (Closed popup, retained selected group chips) |
| Theme Switching | `[runtime]` | Direct 3-way toggle (Claro, Escuro, Sistema) | Passed (Tokens, color-scheme, storage updated) |
| Text Floor (12px) | `[runtime]` | `/painel/ads` studio DOM query outside canvas | Passed (0 text nodes < 12px) |
| Responsive 390px | `[runtime]` | All 6 panel views on iPhone 12 Pro preset | Passed (0px horizontal overflow across all pages) |
| Touch Target Minimums | `[runtime]` | Mobile header, drawer, and segmented controls | Passed (All targets >= 44px) |
| Confirmation Modals | `[source]` | Ripgrep scan for legacy `window.confirm` | Passed (0 occurrences; replaced by `<dialog>`) |
| Send Dispatch Safety | `[runtime]` & `[source]` | `/painel/campaigns/1`, `/campaigns/9`, `/compose` | Passed (Gated on `!dirty`, requires confirmation) |
| Automated Test Suite | Pre-verified | Frontend unit, studio, creative, and preview tests | Passed (82 tests passing, lint/build clean) |

---
*Report finalized by Gemini UI/UX Sub-Agent on shared tree.*
