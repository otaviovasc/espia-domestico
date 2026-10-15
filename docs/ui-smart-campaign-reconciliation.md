# Smart Campaigns UI reconciliation

15 October 2026. Pulled `origin/main` from `62283c0` through `f2d98e0`, then incorporated `1246add` when it arrived during validation. The earlier uncommitted UI overhaul was restored and reconciled. No new commit, push or deployment was performed.

## Merge and recovery

- Original recovery stash: `96773c8e43c6c2495b67f47a7380ec6302504726`, named `espia-ui-before-smart-campaign-reconcile-20261015`.
- Second recovery stash: `fda26c6e95f32a33fa9f488c45329cca05c8511c`, named `espia-ui-reconciled-before-1246add-20261015`.
- Both snapshots include tracked and untracked UI work and were applied, not popped.
- Resolved router/package conflicts by keeping the data router, lazy loading, theme, shell,404 and guards; added authenticated `/painel/smart-campaigns` and its desktop/mobile navigation, title and breadcrumbs. Preserved both `test:smart` and `test:ui`.
- Resolved the later Smart Campaigns conflict by retaining both the redesigned workflows and upstream per-file audience targeting.
- Preserved incoming backend classification, scheduling, budget and migration work. One local backend compatibility fix removes an absent optional audience-scope property from generic import provenance; two regression tests cover scoped duplicate merging and unrestricted duplicates. No classification rule was weakened.
- Public landing source and production settings were not edited. The recovery snapshots remain available; current changes are unstaged.

## UI and behavior

Smart Campaigns now uses Espiã light/dark tokens, typography, rounded outlines, short shadows, Memphis artwork, shared group multiselect and the controlled step indicator. Removed the purple gradient, emoji headings, fixed white surfaces and internal uppercase audience names. The five stages have previous/next navigation, plan history access and a bounded scrolling step ribbon.

Audience forms have associated labels, stable comma-separated editing, save/error feedback, restore controls and limits validation. Clearing a commission floor sends null to remove the saved minimum. Draft baselines compare editable values only, ignoring query metadata and group order.

Audience, import and review panels retain state across steps. Unsaved changes and pending operations use the existing navigation/logout/browser-close guard. Failed replacement uploads preserve the previous valid content. File reads have generation fencing and submission locks. Per-file rows show product counts, an editable source-audience suggestion, individual removal and mixed-collection mode. If a target audience leaves the plan selection, submission is blocked until the mapping is corrected. The file origin remains a weak routing hint, consistent with the upstream classification policy.

Special message drafts survive product filters and stage changes. Failed saves retain drafts; successful saves clear only the saved message. Approval/resume wait for audience rules and messages to be saved. Opening another plan prompts before discarding messages. Refreshing an open plan retains drafts. Native approval/cancel/resume dialogs show destinations, start with safe focus, close on Escape and restore focus. Unknown-send controls expose the server waiting period and require an explicit group check; unresolved sends block resume.

Retry reuses the prior request ID only while the current request still matches. Changing a file target, selection, date or content removes the old Retry action. Paid operations remain explicit mutations with no automatic retry.

## Automated validation

- Final frontend suite: **93 passed**. Includes incoming Smart tests and five audience/date/file contract tests.
- Final TypeScript/Vite build and full frontend ESLint: passed, with no chunk-size warnings.
- Final backend build, full ESLint and unit/render suite: **141 passed**. The incoming provenance regression was corrected and covered by two additional tests.
- No unresolved Git conflict entries; `git diff --check` passed. Public home, bio and masculine build output was byte-identical to unchanged landing sources.

## Browser evidence and boundaries

Native T3 browser checks used real local auth, API validators and PostgreSQL persistence in disposable databases. Five audiences and three directly seeded synthetic review/paused plans were available. AI was disabled, external HTTP blocked, provider behavior mocked and the scheduler off. No paid analysis, real WhatsApp delivery, external publication or production migration was performed.

| Area | Evidence |
| --- | --- |
| Audience persistence | Saved rules; saved then cleared a 5% minimum and read the policy back through the real API. Commas remained while typing. Stage/navigation cancellation retained edits; successful save allowed navigation |
| Failed audience save | Redirected one browser PUT to a missing local route. Error retained the 49-product draft and blocked navigation. Continuing and retrying saved. Known generic errors are translated into Portuguese |
| JSON/files | Pasted JSON survived stages. Valid upload followed by invalid replacement retained prior content. Latest two-file flow showed1 and2 products, inferred DOMESTICA for the named file, mixed mode for the other, editable targets and a warning when the target was deselected |
| File request contract | With only read-only AI readiness mocked, redirected plan creation to a missing local route. Same-tick double click produced exactly one non-empty plan request. Body contained two independent payloads and their selected audience targets, with no rawJson. Failure retained files; changing a target removed the old Retry action. No plan or paid job was created |
| Review drafts | Edited message survived selected/reserve filters, stage changes and cancelling a plan switch; saved through the revisioned API. Approval disabled until save |
| Confirmations | Opened/dismissed approval, cancellation and resume; actual group names shown, initial focus on Voltar, Escape closed. Zero execution calls from dismissal |
| Keyword failure | Mocked read-only readiness while actual server AI stayed disabled. Double click made one keyword POST; stage changes/refocus did not retry. One explicit Retry reused the request ID. Actual local validation failure displayed; no provider call |
| Unknown sends | Read-only browser fixtures added one waiting and one available UNKNOWN row. Waiting controls disabled, available decision required checkbox, resume disabled. Dismissing made zero resolve calls; these were not persisted uncertain deliveries |
| Responsive/themes | All five stages contained width at 320px in both themes and 768px dark. Additional 390px and1280/1440px form/review checks. Latest per-file rows also contained320px in dark mode |

Locator/text-wait timeouts during hot reload were resolved using fresh snapshots and settled DOM reads. Route changes were awaited through destination headings where necessary. No failed automation operation was counted as a successful product check. Viewport tests are not real-device or screen-reader certification.

## Captures

- [Desktop audiences](/home/marlos/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mv9qhb0p-35fb28e6.png)
- [Final per-file import, desktop](/home/marlos/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mv9qqk1f-df64b821.png)
- [Final per-file import, 320px dark](/home/marlos/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mv9qqvg3-992c178a.png)
- [Mobile review, dark](/home/marlos/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mv9q7fii-0ebc37c5.png)

QA cleanup completed: API3118 and Vite5279 stopped. Both task databases (`achadinhos_ui_qa_1792079927789_1116197`, `achadinhos_ui_qa_1792080783435_1294589`) were confirmed absent by a read-only PostgreSQL query; both temporary media directories were removed. The earlier failed startup also exited through its cleanup handler. All directly seeded or browser-created QA records belonged to these disposable databases.
