# UI/UX audit — design lead, round 1

Scope: `achadinhos-frontend` (painel SPA under `/painel` and the three static landings). The audit used the codebase-memory graph (`home-marlos-projects-espia-domestico`, scoped to `achadinhos-frontend/src`) and the live source. No dev server or backend was running, and none was started, so nothing here was checked visually in a browser. App files were not edited.

## Recommendation

Redesign the panel as an operations counter for Brazilian affiliate offers, not as a SaaS dashboard. The operator's work is: get a price tag in front of a WhatsApp group without double-sending, and know what each group already received. The design follows from that:

1. Introduce semantic CSS tokens with light and dark themes (`[data-theme]` plus `prefers-color-scheme`). Replace the 633 `zinc-*` and 263 `violet-*` utilities with token utilities (`bg-panel`, `text-muted`, `bg-action`, and so on). Without this step, dark mode is not achievable.
2. Remove generated-design tells: the violet-to-pink `brand-gradient`, the 🛍️ logo, `radial-gradient` page washes, `rounded-2xl` + `shadow-sm` on every card, pill badges everywhere, and the 9–11 px text.
3. Spend boldness in one place, the price tag ("etiqueta"): a yellow tag that shows `De R$ 199,90` struck through, `por R$ 99,90` in condensed bold, and `-50%`. It is the vernacular of Brazilian retail flyers and Mercado Livre offers, and it appears on every product row in the app. Everything around it stays quiet.
4. Fix the four P0 defects below before any visual polish. Two of them can send or cancel real WhatsApp traffic by accident.

## Screen map (current)

| Route | File | Purpose | Notes |
|---|---|---|---|
| `/` | `landing/index.html` | Public LP "Espia Doméstico" (casa) | Prebuilt HTML with inlined compiled Tailwind. Cream + Playfair + clay accent (`--color-ivory #f7f1e8`, `--color-clay #b96f55`), which is the most common AI default look. |
| `/masculino` | `landing/masculino/index.html` | Public LP (masculino) | Near-black + gold + Barlow Condensed uppercase, plus decorative gradient rules and panels. |
| `/bio` | `landing/bio/index.html` | Link-in-bio | Dark with orange/yellow gradient text, floating 3D "orbs", and a `drift` animation. |
| `/painel/login` | `pages/LoginPage.tsx` | Login | Emoji logo on a gradient; labels are not associated with the inputs. |
| shell | `App.tsx` `Shell` | Sidebar + main | On mobile the nav becomes a 2–3 column button grid above every page. There is no `aria-current` and no connection status. |
| `/painel/connection` | `pages/ConnectionPage.tsx` | QR / pairing / existing instance, webhook | This is also the default route after login and the 404 fallback. |
| `/painel/products` | `pages/ProductCatalogPage.tsx` (929 lines) | Import, classify, review, save, product groups, catalog, inline editor | Three jobs on one page. |
| `/painel/compose` | `pages/ComposePage.tsx` (911 lines) | Five-step campaign builder | The send summary and button sit at the bottom of a very long page. |
| `/painel/campaigns` | `pages/CampaignsPage.tsx` | Campaign list | A stack of cards with sent/failed counts as colored text. |
| `/painel/campaigns/:id` | `pages/CampaignDetailPage.tsx` + `components/CampaignProgressCard.tsx` | Edit draft, run, pause, resume, cancel, logs | Header actions include an unconfirmed Cancel. |
| `/painel/messages` | `pages/GroupMessagesPage.tsx` | Group thread viewer + manual send | The offer picker modal sends on click. |
| `/painel/ads` | `pages/AdLibraryPage.tsx` (2409 lines) + `StudioTools`, `ClipSequenceEditor`, `CreativeControls`, `CarouselCreator`, `CompositionLayers`, `AudioFinishingControls`, `ExportReadiness`, `PublicationPlanner`, `MediaLibraryPicker`, `EmojiPicker` | Video/carousel studio | Dark sticky stage on the left, about 10 stacked white sections on the right. |

## Biggest defects

### P0: behavior and accessibility

1. **One-click real send from the offer picker.** In `GroupMessagesPage.tsx`, `CatalogList` button `onClick={() => onSelect(p.offer)}` is wired to `sendOfferMutation.mutate(offer)`, so picking a catalog item sends it to the group immediately. The JSON tab shows a preview first (`OfferPreviewCard`); the catalog tab does not. Fix: selecting an item opens the same preview card with an explicit "Enviar para {grupo}" button. The preview also ignores the "Enviar imagem" checkbox (`showImage={Boolean(offer.imageUrl)}`); pass `sendImage` through.
2. **Unconfirmed campaign cancel.** In `CampaignDetailPage.tsx` around line 319, `cancelM.mutate()` fires directly, and the Cancel button sits next to Pause/Resume. Meanwhile, removing a single product uses `window.confirm`. Fix: one shared `ConfirmDialog` (a native `<dialog>` with `showModal()`), used for cancel, product removal (replacing `confirm()`), project switching with unsaved changes (`AdLibraryPage.tsx:1919`, replacing `window.confirm`), and disconnecting the number.
3. **Labels are not bound to their inputs.** `ui.tsx` `Label` renders `<label>` without `htmlFor`, and inputs have no `id`. This affects Login, Connection, Compose (name, schedule), the catalog editor, and `SafetyControls`. Fix: a `Field` component that calls `useId()` and wires `label`, `input`, hint (`aria-describedby`) and error (`aria-invalid` + `role="alert"`).
4. **Modals are not dialogs.** `OfferSender` (`GroupMessagesPage.tsx`) is a `fixed` div: no `role="dialog"`, no `aria-modal`, no focus trap, no Escape handling, no focus return, and the close icon has no `aria-label`. Use the native `<dialog>` from item 2.

### P1: flow and information architecture

5. **The wrong default route.** Login, `*`, and `/` all redirect to `/connection`, a settings screen. Default to `/campaigns`, and put connection state in the shell (see IA below).
6. **Compose puts the decision at the bottom.** The counts that decide a send (new pairs, already sent, in another campaign, unconfirmed, products without commission) only appear in card 5, after a long table, template editor, group list and safety form. On desktop, use a two-column layout. The left column holds the steps. The right column holds a sticky "Resumo do disparo" rail with: products × groups = pairs, new, ignored and unconfirmed counts, schedule, and the Send/Schedule/Draft buttons. On mobile, show the same summary as a bottom sheet bar.
7. **The products page does three jobs.** Split `ProductCatalogPage.tsx` into:
   - `/products/import`: profile → files/JSON → classify → review and save. This is a real sequence, so numbered steps are justified here and only here.
   - `/products`: the catalog, with the product-groups manager in a side panel and the editor in a drawer instead of an inline form that expands the row.
   The session is page-memory only (README), so add a `beforeunload` guard while a session has unsaved results.
8. **Campaign detail is a long column of cards.** Use a header with the status, the progress meter and the primary action. Put the content in tabs: `Progresso`, `Produtos`, `Grupos`, `Mensagem`, `Registro`. Keep Cancel visually separate from Pause/Resume and behind confirmation.
9. **Status depends on color alone.** Delivery summary counts are colored `<span>`s (`CampaignDetailPage.tsx` "a enviar / já enviada / em campanha / sem confirmação"; `CampaignsPage.tsx` sent/failed). Pair each state with an icon and a word (see "Delivery states").
10. **Duplicated template editor.** The template editor, placeholder chips and preview are duplicated between `ComposePage.tsx` and `CampaignDetailPage.tsx`. Extract a `MessageTemplateEditor` and fix both together. The image toggle needs `aria-pressed`. The chips need an accessible name ("Inserir campo Preço").

### P1: mobile

11. **Shell.** Below `lg`, use a 56 px top bar (brand, connection pill, menu) and a bottom tab bar with the four primary sections, instead of the nav grid that pushes content down on every page.
12. **Tables.** Compose has eight columns and the review table seven, so both need horizontal scrolling on phones. Below `md`, render each row as a product line instead: the price tag on the left; title, grade and commission in the middle; the checkbox as a 44 px hit area on the right; delivery status as a one-line summary that expands.
13. **Small targets.** Text-link buttons ("Selecionar página", "Remover", "Renomear") and `rounded-full px-3 py-1 text-xs` chips are under 32 px tall. The minimum is 32 px on desktop and 44 px on coarse pointers (`@media (pointer: coarse)`).

### P2: visual noise and generated-design tells

14. **Decoration.** `index.css` `.brand-gradient` (violet→pink) is used for the logo, the login and the progress bar. `.ad-library` adds a radial wash. The empty state uses a dashed violet box with a large icon tile. Remove all of these.
15. **Emoji and decorative copy.** Emoji appear in UI chrome (`App.tsx:30`, `LoginPage.tsx:34`) and in default ad copy (`AdLibraryPage.tsx:73-74` "✨", "😍"). Default ad texts should be neutral examples the user replaces. The EmojiPicker stays because it is a user feature for ad copy.
16. **Text size.** There are 70+ uses of `text-[9px]`, `text-[10px]` and `text-[11px]` (`CreativeControls`, `ClipSequenceEditor`, `AdLibraryPage`, `CampaignProgressCard`). Set a 12 px floor outside the video canvas overlay.
17. **Icon decoration.** Every section heading carries a violet icon (`Package`, `Video`, `Music2`, `Sparkles`, `WandSparkles`, `Crop`). Keep icons on controls and states, and remove them from headings. Remove `Sparkles` and `WandSparkles` entirely; "Direção criativa" does not need magic iconography.
18. **Spinner.** `Spinner` has no `role="status"` or accessible label. Give loading regions `aria-busy`.
19. **Copy.** Bare "Status:" labels, "— nenhum —", and "A prévia aparece aqui…". Rewrite empty and error states to say what to do next ("Nenhum grupo encontrado. Confira se o número conectado participa de grupos.").

## Proposed IA

```
┌ Shell (desktop sidebar 224px, light/dark aware) ───────────────┐
│ Achadinhos                                                     │
│ ● Conectado  +55 11 9…  (pill → /connection; red when offline) │
│                                                                │
│ Envios                                                         │
│   Campanhas          /campaigns   (button "Nova campanha" in   │
│                                    page header → /compose)     │
│   Grupos             /messages                                 │
│ Produtos                                                       │
│   Importar           /products/import                          │
│   Catálogo           /products                                 │
│ Instagram                                                      │
│   Anúncios           /ads                                      │
│                                                                │
│ ─────────────                                                  │
│ Tema: Claro / Escuro / Sistema   ·   Nome   ·   Sair           │
└────────────────────────────────────────────────────────────────┘
```

- Remove "Nova campanha" as a nav item; it is an action. "Conexão" leaves the main nav and becomes the status pill. When the number is disconnected, every send screen shows one banner: "WhatsApp desconectado. Conectar número".
- Section labels ("Envios", "Produtos", "Instagram") encode real channel boundaries. Write them in sentence case and muted, not tracked caps.
- Keep the routes under `/painel`. Add `/products/import`, and keep `/products` as the catalog so existing links to the catalog still work.

## Design direction: "balcão de ofertas"

The tone is a well-run offer desk: dense, legible, calm, with one loud object, the price tag. Reference points are the yellow price tags in supermarket flyers, the struck-through "de/por" price convention, and the WhatsApp message tick. They are used as data, not as illustration.

What it is not:
- The violet SaaS kit currently in place.
- Cream with a serif display (that is the current landing).
- Near-black with an acid accent.
- Identical rounded cards everywhere.

### Color tokens

Define them in `src/index.css` as CSS variables, then map them through Tailwind v4 `@theme inline` so utilities like `bg-panel` and `text-ink` exist.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--canvas` | `#F3F4F1` | `#0F1412` | App background (cool grey with a slight green cast; not cream) |
| `--panel` | `#FFFFFF` | `#161D1A` | Surfaces |
| `--panel-sunken` | `#ECEEEA` | `#111816` | Inputs, filter bars, table header |
| `--line` | `#D8DDD8` | `#29342F` | Borders and rules |
| `--ink` | `#16201C` | `#E4EAE6` | Primary text |
| `--ink-muted` | `#56625C` | `#9BA9A2` | Secondary text (≥ 4.5:1 on panel in both themes) |
| `--action` | `#0B5D4B` | `#4CC3A0` | Primary buttons, focus, selection (bottle green, from the WhatsApp channel, not acid) |
| `--action-ink` | `#FFFFFF` | `#06231B` | Text on action |
| `--tag` | `#FFDD2E` | `#FFD43B` | The price tag only. Never used for text color. |
| `--tag-ink` | `#1E1A00` | `#1E1A00` | Text on the tag |
| `--info` | `#2E4AA6` | `#93A8FF` | Scheduled, in another campaign |
| `--warn` | `#8A5300` on `#FFF3D1` | `#F0BE5A` on `#2A2210` | Unconfirmed, no commission |
| `--danger` | `#B42318` on `#FDECEA` | `#F2877C` on `#2C1513` | Failures, destructive actions |
| `--stage` | `#111614` | `#0A0E0C` | Ad preview stage (dark in both themes, for color judgement) |

Rules:
- Green means "act" and "accepted". Red means "failed or destructive". The palette has no purple or pink.
- Grades A/B/C/D are ordinal, so they share one hue at decreasing weight instead of four rainbow badges. A is a solid ink letter tile, B is an outlined ink tile, C is a muted tile, and D is muted with a dashed border. Relevance stays visible as a number next to the grade, not only in a `title` tooltip.

### Delivery states

The ticks follow WhatsApp convention, but stop where the data stops.

| State | Mark | Label | Note |
|---|---|---|---|
| unsent | empty circle | "Novo" | |
| sending | clock | "Enviando" | |
| sent | single tick | "Aceito pela UAZAPI" (short form "Enviado") | Never show double or blue ticks: the README says "sent" is not delivery or read. |
| unconfirmed | `!` tile, warn color | "Sem confirmação" | Plus the existing resolution action |
| failed | `×`, danger color | "Falhou" | Plus the error text |

Implement once in `components/ProductDeliveryStatus.tsx`, and reuse it in the campaign list counts and `CampaignProgressCard`.

### Typography

- **UI and body: IBM Plex Sans** (400/500/600). It is legible at 13–14 px, has full Portuguese diacritics, and has good tabular figures. Self-host it with `@fontsource/ibm-plex-sans` at a pinned version. The current `Inter` in `index.css` is never loaded and falls back to system fonts.
- **Prices and counters only: Barlow Condensed 700.** This keeps continuity with the `/masculino` and `/bio` landings. Use it for `por R$`, discount %, the big progress counter, and the "Próxima mensagem" countdown. Nothing else.
- **Code only: IBM Plex Mono.** Use it for the JSON textareas, the message template editor, webhook URLs and tokens. Do not use it for data labels.
- **Scale:** 12 / 13 / 14 (base) / 16 / 20 / 24, with tag prices at 20 / 28 / 40.
- **Line height:** 1.45 for body text, 1.2 for headings.
- **Numbers:** `font-variant-numeric: tabular-nums` on every number column.
- **Casing:** sentence case everywhere, with no tracked uppercase eyebrows.

### Spacing, density, shape

- 4 px grid. Page gutter: 16 px mobile, 24 px desktop. Panel padding: 16 px. Section gap: 24 px.
- Two densities via `[data-density]`. `comfortable` (default) uses 40 px rows and 36 px controls. `compact` uses 32 px rows and 32 px controls, for the catalog and logs. Coarse pointers always get 44 px targets.
- Radius: 6 px on controls, 8 px on panels, 0 on table rows. The tag has a notched left edge (a CSS `clip-path` punch hole), which is the only decorative shape.
- Elevation: borders, not shadows. Overlays only (dialog, drawer, popover) get one shadow token.
- Panels are reserved for real groupings. Tables and lists sit directly on a panel with hairline row separators. Do not nest cards inside cards; for example, the filter box inside `Card` in Compose becomes a sunken toolbar row.

## Ad studio: compact layout, without regressing the preview

The preview was already tightened, and the following must be preserved:
- `.ad-phone-stage` width `min(100%, calc((100dvh - 13rem) * ratio))`
- `.ad-carousel-canvas` `(100dvh - 16rem)`
- the 2.25 rem toolbar buttons
- the expanded/fullscreen mode
- the filmstrip and transport rows
- the `ad-preview-*` class names, which `test:preview` and `adPreviewParity` depend on

Do not add chrome above or inside the stage, and do not wrap it in another card.

Changes:

1. **Move `StudioTools` out of the stage's vertical path.** The tabs (Produtos, Mídias, Marca e templates, Calendário, Resultados) currently render above the workspace and push the stage down. Make them a single-row segmented control in the page header that opens a right-side drawer (`<dialog>`), or a full-width panel below the workspace. On `lg`, do not let them reduce the stage height.
2. **Turn the right column into an inspector.** About ten `rounded-2xl p-5` sections (Imagens e vídeos, Música, Textos, Ritmo e formato, Enquadramento, Estilo do texto, Direção criativa, Camadas, Acabamento de áudio, Prontidão) become disclosure groups with a 40 px header row showing the group name and a one-line value summary (for example "9:16 · 15 s · 3 variações"). Media and Texts start open; the rest start closed. Use 12 px padding, hairline dividers, no per-section card or icon.
3. **Keep the sticky bottom action bar,** and render it with the theme tokens instead of `bg-white/95 shadow-xl backdrop-blur`. The render button uses `--action`, not the one-off coral `#ee5b47`. The coral also appears as `#ff735e` in the stage scrubber and focus ring; replace it with `--action` there too, for a single accent.
4. **Simplify the page header.** Remove the `text-4xl` marketing-style h1 "Crie vídeos e carrosséis para Instagram" and its icon eyebrow. Use a 20 px title "Anúncios", the project selector, and the New video / New carousel buttons on one row. This returns about 120 px of vertical space to the stage.
5. **Light theme.** The stage stays `--stage` dark; only the inspector follows the theme.
6. **Reduced motion.** Keep the existing `prefers-reduced-motion` blocks. The clip drag "settle" animation is user-triggered and can stay.

## Landing pages

These are public conversion pages, so change them conservatively and measure the result.
- `landing/index.html`: replace the cream/Playfair/clay palette with the panel's tag yellow and bottle green, keep the WhatsApp CTA green (`#075E54`), and drop the radial washes. A condensed price-tag headline ("até 60% OFF" set as a tag) would be the hero, instead of a serif display line.
- `landing/bio/index.html`: remove the drifting 3D "orbs" and `percent-token` (`animation: drift`), the gradient text in `h1 strong`, and the gradient fills on group links. Use solid fills with sufficient contrast. Respect `prefers-reduced-motion` for the orbit carousel on all three pages.
- All three ship compiled Tailwind inline. Edit their source classes, not the compiled `<style>` block, or rebuild them. Check how they were generated before touching them.
- Confirm the group links (`chat.whatsapp.com/...`) are unchanged after any edit.

## Implementation order (concrete files)

1. `src/index.css`: tokens (light/dark), `@theme inline` mapping, font-face imports, focus ring (`outline: 2px solid var(--action); outline-offset: 2px`), density and coarse-pointer rules, the tag component class. Retheme the `emoji-picker-*` and `clip-sequence-*` rules from hex values to tokens.
2. `src/main.tsx` + new `src/lib/theme.ts`: read `localStorage('theme')` / `matchMedia`, set `document.documentElement.dataset.theme` before render, and add an inline script in `index.html` to avoid a flash of the wrong theme.
3. `src/components/ui.tsx`: rewrite `Button` (variants `primary | secondary | ghost | danger`, plus `size`), `Field`/`Label`/`Input`/`Select`/`Textarea` with `useId`, `Badge` as square status chips, `Spinner` with `role="status"`. Add `Dialog`/`ConfirmDialog` (native `<dialog>`), `PriceTag`, `GradeTile`, `EmptyState`, and `Panel` (replacing `Card`).
4. `src/App.tsx`: new shell, IA, connection pill, theme switch, mobile top bar + bottom tabs, `aria-current` on `NavLink`, default route `/campaigns`.
5. P0 fixes:
   - `pages/GroupMessagesPage.tsx`: preview before send, dialog semantics, honor `sendImage`.
   - `pages/CampaignDetailPage.tsx`: cancel confirmation.
   - `AdLibraryPage.tsx:1919`: replace `window.confirm`.
6. `pages/ComposePage.tsx`: sticky summary rail, extract `MessageTemplateEditor` (shared with `CampaignDetailPage.tsx`), mobile row layout.
7. `pages/ProductCatalogPage.tsx`: split into `ProductImportPage.tsx` and `ProductCatalogPage.tsx`; editor drawer; group manager panel.
8. `pages/CampaignDetailPage.tsx` + `components/CampaignProgressCard.tsx`: header + tabs; progress bar uses `--action` instead of `brand-gradient`.
9. `components/ProductDeliveryStatus.tsx`: the tick-state vocabulary above.
10. `pages/AdLibraryPage.tsx`, `components/StudioTools.tsx`, `CreativeControls.tsx`, `ClipSequenceEditor.tsx`: inspector groups, header compaction, 12 px floor, single accent.
11. `pages/LoginPage.tsx`, `pages/ConnectionPage.tsx`, `pages/CampaignsPage.tsx`: tokens and copy. The campaigns list becomes a table (name, status, pairs sent/total, failures, scheduled time) instead of a stack of cards.
12. Landings, last and separately reviewable.

## Verification the implementer should run

- `npm run build`, `npm run lint`, `npm run test:preview`, `npm run test:studio`, `npm run test:creative`, `npm run test:imports` in `achadinhos-frontend`.
- Browser checks in both themes at 390 px and 1440 px: login, compose (the summary rail stays visible while scrolling), the messages picker (no send without the preview button; Escape closes; focus returns), campaign cancel confirmation, and the studio stage height (compare with the current build at the same viewport; the stage must not shrink).
- Keyboard-only pass: the focus ring is visible on every control, and dialogs trap and return focus.
- Contrast: `--ink-muted` on `--panel` and on `--panel-sunken` in both themes ≥ 4.5:1; `--action-ink` on `--action` ≥ 4.5:1.
