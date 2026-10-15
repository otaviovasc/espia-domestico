# Independent authenticated browser QA

Date: 2026-10-15. Local Vite: `http://127.0.0.1:5279/painel/`; isolated synthetic QA API: port 3118. Native T3 preview; dedicated tab `tab_9_d8c5d606-830e-4571-809a-fcfca8d449eb`, explicitly passed on every call. Existing default-profile synthetic session was authenticated when the tab opened. Implementation workers were active and Vite HMR changed source during this audit. This is local fixture evidence, not deployed/provider evidence.

Read: agent workflow, installed official Claude frontend-design skill, local frontend-design, vercel-react-best-practices, design brief, and QA environment documentation. Public landing pages excluded. No app files edited, no real sends/external provider calls, no persisted fixture record mutations, no server stopped. Only view state, selection, unsaved inputs and theme preference changed. One classification attempt exercised the intentionally disabled local AI path. Page-only temporary XHR GET mappings exercised error/retry states and were restored.

## Checked

| Case | View/theme | Observed result |
| --- | --- | --- |
| Campaign list | 1440×900, dark | Seven seeded states present: cancelled, failed, completed, paused, running, scheduled and draft. Product/group counts, creation/schedule dates and send/failure counts visible. No document horizontal overflow. |
| Failed campaign `/campaigns/6` | Desktop dark; 390×844 dark | Loading text for delivery checks and history replaced by per-product/per-group state; mixed sent/failure log showed specific synthetic provider failure. Send action disabled when all pairs were occupied by another campaign. No document overflow. |
| Detail form/control naming | Desktop dark | Name/schedule, message textarea, safety numbers and unit controls have accessible names in final observed DOM. Initial message-field concern was resolved by HMR; unit controls already had aria-labels. Product/group remove actions include entity names. |
| Campaign group editor | Desktop/mobile dark | Inline expandable group list opened with four named destinations and membership counts; no dialog implied. Did not change groups or save. |
| Catalog populated | 390×844 dark | Six products, images/prices/categories and delivery states; search/filter and primary import action visible. No document overflow. |
| Catalog hidden selection | Mobile dark | Select page then search for a nonexistent term: selection cleared to zero with explicit explanatory feedback. Empty state has a clear-filters action. |
| Catalog edit | Mobile dark | Inline editor opened for QA product 6; labeled inputs, origin/ID history explanation, category niche scope and save/cancel actions present. Cancelled without save. |
| Import and classification | Mobile dark | Separate import pane with pasted JSON/file upload and cost/limits text. Invalid pasted JSON disabled classification and displayed `JSON colado inválido. Corrija o conteúdo antes de classificar.` No provider invoked. |
| New classification profile | Mobile dark | Inline form focused name field; niche/audience, weights totaling 100, commercial ceilings and advanced limits visible. No document overflow. Cancelled without creating a profile. |
| Compose initial state | 390×844 dark | Five explicit stages; product/group counters, search/classification/collection filters, available product count; send and draft actions disabled until product/group chosen. No document overflow. |
| Compose selected state | Mobile dark/light; desktop light | Selected QA product 6 and one destination; preview populated, pair count became one. Safe preset changed summary to 3–6 minutes, max 20/hour. No send action clicked. |
| Compose image toggle | Mobile light | Unchecked attachment checkbox removed attached-photo presentation; link preview retained product illustration, consistent with text that WhatsApp can adjust link previews. |
| Compose scheduling | 1440×900 light | Future local datetime changed action from `Enviar agora` to `Agendar campanha`; explicit local-device time explanation remained. No schedule submitted. |
| Mobile navigation and theme | 390×844 | Named native navigation dialog opened with focus on close; choosing light persisted `espia-theme=light` and resolved html theme; Escape closed drawer and restored focus to `Abrir navegação`, with visible focus ring. |
| API-unavailable login | Desktop/mobile light | During API3118 outage, proxy returned 500; login retained fields but rendered raw English Axios error. See finding below. |
| Login recovery | Mobile light | API returned and submitting retained synthetic credentials authenticated successfully. |
| All campaign details | 390×844, dark/light according to shared preference | Routes 1–7 showed the appropriate state-specific editing/actions or read-only summaries. Running: pause/restart and 33% progress. Paused: save/resume. Scheduled: save/pause and local schedule. Completed/cancelled: no edit/send actions. All seven measured document width 390. |
| Cancellation confirmation | Mobile | Native confirmation clearly explains pending sends stop and sent messages remain. Dismissed without cancellation; focus remained on cancellation button. |
| Real missing campaign and route | Mobile | Campaign 999999 showed `Campanha não encontrada` with useful explanation/back link; unknown route showed `Erro 404`, useful explanation and return-to-panel action. |
| Campaign list failure/retry | Desktop | Page-only GET remapping to a nonexistent QA route showed `Não foi possível carregar as campanhas.` plus retry. Restoring GET and clicking retry recovered seven campaigns. |
| Campaign list empty search | Desktop | Nonmatching name returned zero of seven and explicit instruction to change the name or status. |
| Catalog failure/retry | Desktop light | Page-only saved-products GET mapping produced `Não foi possível carregar o catálogo. Tentar novamente`; restoring and retrying recovered all six products. |
| Catalog group organization | Desktop light | Expanded group organizer showed create, filter, rename and remove controls with two fixture groups. No mutations submitted. Group action labels could better include entity names. |
| Import disabled-AI failure | Desktop/mobile light | One valid synthetic pasted product resulted in one classified failure, zero saved; failure detail named the product and missing configuration. Retry and preservation explanation visible. No external request possible by fixture design. Document width remained 390 on mobile. |
| Campaign list themes | Desktop light/dark, mobile light | Screenshots show useful image/title/status hierarchy, readable secondary text and actions. No mobile document overflow. Shared localStorage preference changed from other worker tabs during some later navigations. |

## Findings

1. **Medium: login API failure is technical and unactionable.** With API3118 unreachable (curl exit 7, HTTP 000), submit synthetic credentials at `/painel/login`. The form displays `Request failed with status code 500`. Explain in Portuguese that the service could not be reached and suggest trying again. Environment outage itself is not a product defect; the error presentation is independently observable.
2. **Resolved during audit: origin-specific commission warning.** Selecting only the Shopee fixture product initially said to generate a Mercado Livre link. Later live DOM says `Gere o link afiliado na plataforma de origem para receber comissão.` Rechecked after HMR.
3. **Low: classification configuration error uses implementation language.** The intentionally disabled AI path shows `Configure OPENROUTER_KEY para categorizar produtos.` in per-item failure details. The failure/retry state works, but an operator needs a user-facing explanation that classification is unavailable and an administrator must enable it.
4. **Low: group organizer action names lack group context.** The expanded catalog organizer has repeated `Renomear`/`Remover` buttons with no aria-label/title including their group. Product actions already include product names; use the same approach for groups.

## Screenshots

All files are under `/home/marlos/.t3/userdata/browser-artifacts/`.

| Evidence | Filename |
| --- | --- |
| Campaign list desktop dark | `browser-screenshot-127-0-0-1-mv9mdp75-ad8804f2.png` |
| Failed campaign desktop dark | `browser-screenshot-127-0-0-1-mv9me7sg-6b55ca83.png` |
| Failed campaign mobile dark (scrolled message/product section) | `browser-screenshot-127-0-0-1-mv9mer5h-e48e97a5.png` |
| Catalog mobile dark | `browser-screenshot-127-0-0-1-mv9mf7ml-92dfb22e.png` |
| Catalog product edit mobile dark | `browser-screenshot-127-0-0-1-mv9mfhnv-a66bd64e.png` |
| Classification profile mobile dark | `browser-screenshot-127-0-0-1-mv9mgf3r-5e24d2a3.png` |
| Compose mobile dark | `browser-screenshot-127-0-0-1-mv9mh7cq-7993a7df.png` |
| Compose mobile light, image option/preview and restored nav focus | `browser-screenshot-127-0-0-1-mv9mi45i-dfa24713.png` |
| Compose desktop light, scheduled action | `browser-screenshot-127-0-0-1-mv9mimnb-b02a94b1.png` |
| API failure login desktop light | `browser-screenshot-127-0-0-1-mv9mk9vf-013f537a.png` |
| API failure login mobile light | `browser-screenshot-127-0-0-1-mv9mk9yd-1631e4cd.png` |
| Cancelled campaign mobile dark | `browser-screenshot-127-0-0-1-mv9mml6c-307fcd3f.png` |
| Missing campaign mobile | `browser-screenshot-127-0-0-1-mv9mmtfz-9e352aa5.png` |
| Campaign list controlled query failure | `browser-screenshot-127-0-0-1-mv9mnuls-561926a1.png` |
| Classification failure desktop light | `browser-screenshot-127-0-0-1-mv9mpo75-fa6dfb57.png` |
| Classification failure mobile light | `browser-screenshot-127-0-0-1-mv9mpuqd-359841b7.png` |
| Catalog controlled query failure desktop light | `browser-screenshot-127-0-0-1-mv9mqj66-87018c51.png` |
| Catalog group organizer desktop light | `browser-screenshot-127-0-0-1-mv9mqpsh-3a821a4a.png` |
| Campaign list desktop light | `browser-screenshot-127-0-0-1-mv9mr65b-c54e081f.png` |
| Campaign list mobile light | `browser-screenshot-127-0-0-1-mv9mr686-3338ecb5.png` |
| Completed campaign mobile | `browser-screenshot-127-0-0-1-mv9mrf23-c86110f2.png` |

## Limits and next checks

At about 14:18 UTC the isolated API briefly stopped responding. The pass resumed when API3118 returned HTTP 200; this auditor did not stop/restart any service. Import success, group creation/edit persistence, full reload/system/storage theme matrix, and authenticated messages/studio remain unverified by this independent pass. Other workers' evidence should be listed separately. Screenshots were visually inspected for selected mobile/catalog/preview/list cases; no automated contrast ratio scan or screen reader run was performed. HMR means this is a working-tree snapshot, not an exact immutable serving revision. Native confirmation text is recorded from preview_status; the pending browser dialog prevents screenshot capture.
