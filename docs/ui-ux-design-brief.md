# Platform UI redesign brief

Scope: authenticated platform routes, login, their dialogs, tools and empty/loading/error states. The user explicitly excluded all public landing pages; do not modify them. Keep API contracts and saved data intact. Existing media exports must not change when a display theme changes. Rebuild components when it improves task completion; keep React 19, Tailwind 4 and the current routing/data stack.

Every UI worker must read the installed official Claude frontend-design skill:
`/home/marlos/.claude/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/skills/frontend-design/SKILL.md`
Also read local frontend-design, vercel-react-best-practices and agent-workflow guidance. The user's permission to rebuild components takes priority over generic advice against rewrites.

## Direction

Espiã Doméstico is an offer-publishing workspace for Brazilian affiliate operators. Make products, destinations, delivery state and creative media easy to inspect. The signature is the offer itself: useful product imagery, clear Brazilian currency, readable message previews, and delivery/status information alongside actions. Avoid decorative dashboard statistics, generic motivational copy, gradients, floating ornaments, emoji branding, unnecessary large cards, pill badges everywhere and oversized page introductions.

Use the researched Azul oferta palette: blue actions, cool neutral surfaces, dark ink, and warm yellow reserved for the original eye/price-tag brand and actual price information. This is a working application, not a marketing hero on every route. Public landing pages remain outside this task.

Typography: Manrope for restrained page titles/brand; IBM Plex Sans for body/forms/data. Self-host only the necessary licensed fonts. Tabular numerals for prices/counts/dates. Use 24–30px app titles, 14–16px body, 12–13px secondary copy; readable contrast in both themes. Avoid all-caps decorative labels.

## Shared semantic token contract

Foundation owner provides Tailwind `@theme inline` color names, allowing these classes everywhere:

| Name | Light | Dark |
| --- | --- | --- |
| `canvas` | `#EDF2FA` | `#121926` |
| `surface` | `#FFFFFF` | `#1B2638` |
| `surface-muted` | `#E3EAF5` | `#26354B` |
| `surface-raised` | `#FFFFFF` | `#1B2638` |
| `ink` | `#18243C` | `#EFF4FF` |
| `muted` / `subtle` | `#4D5D77` | `#BAC7DE` |
| `line` | `#A9B7CB` | `#526684` |
| `line-strong` | `#18243C` | `#B4C7E7` |
| `accent` | `#3153C7` | `#AFC4FF` |
| `accent-foreground` | `#FFFFFF` | `#182B64` |
| `accent-soft` | `#DDE6FF` | `#293F70` |
| `danger` | `#AC3434` | `#FFB4AD` |
| `danger-soft` | `#FFF0EE` | `#472A29` |
| `success` | `#256441` | `#A5DDB7` |
| `success-soft` | `#E6F4E9` | `#274631` |
| `warning` | `#83520F` | `#F0CC88` |
| `warning-soft` | `#FFF4DC` | `#463B26` |
| `info` | `#245D79` | `#A8D5ED` |
| `info-soft` | `#EAF3FA` | `#283D49` |

Use `bg-surface`, `text-ink`, `text-muted`, `border-line`, `bg-accent text-accent-foreground`, and corresponding status tokens. Do not invert all zinc/white colors globally: dark media previews, customer-facing message artwork, export colors, source images and QR codes have their own actual visual meaning. Remove hardcoded light-only form/card/control colors within each owned module. Retain genuine media colors.

Shared CSS utilities provided by foundation: `workspace-page`, `page-header`, `page-title`, `page-description`, `page-actions`, `surface-panel`, `section-heading`, `field-label`, `field-control`, `workspace-toolbar`, `table-scroll`. Shared component API stays backwards compatible: Button variants primary/secondary/danger/ghost, Card, Input, Label (extend htmlFor), Badge tone aliases, Spinner; new Skeleton, EmptyState, InlineAlert helpers are optional.

## Theme contract

Preference key `espia-theme`, values `light`, `dark`, `system`. `html[data-theme]` is the resolved `light` or `dark`; system is default when no valid preference exists. Set `color-scheme`, avoid a flash before paint, follow OS changes only in system mode, persist manual choice, handle unavailable localStorage, and synchronize storage changes across tabs. Theme provider/control must be keyboard accessible. The app initializes preference through `/painel/theme-init.js`; do not add it to public landing pages. Theme selection does not modify ad/media configuration.

## Layout and interaction

One app shell and scroll region; desktop navigation can be compact/collapsible with persistent preference, mobile uses a named off-canvas drawer with focus management and Escape. Add skip-to-content and proper route headings. Product/catalog tables need mobile alternatives or contained horizontal scrolling, with primary actions in view. Page headers are compact: title, brief useful context, actions.

Use 4/8/12/16/24px rhythm, 6–8px field radius, 10–14px panels, subtle borders, sparse shadows. Typical controls 36–40px, icon/touch targets 44px. Retain readable density for data; give long multi-step workflows clear sections and useful summaries rather than endless identical cards.

Every query distinguishes loading, error/retry and empty state. Mutations show progress and errors near the action. Every destructive action explains consequences. Dialogs need title, role, contained focus, Escape, backdrop dismissal where safe, focus restoration and scroll control. Preserve unsaved edits and revision conflicts. Keep dates/timezones, factual prices/coupons, manual publication/metrics boundaries, existing provider guards and accessibility names.

Verify at 390px mobile and desktop, in light and dark, including populated and failure states. Check keyboard navigation, no horizontal document overflow, readable contrast, reduced-motion preference, and full theme persistence/reload. Code review is separate from authenticated fixture/browser evidence.

## Independent audit integration

Kiro Opus 5.5 and AGY Gemini 3.8 Flash completed source audits. Retain this single shared palette/type contract rather than introducing competing palettes. Incorporate behavior findings: preview an offer before direct send, ensure image checkbox matches preview, confirm campaign cancellation/disconnection, preserve reading position during inbox polling, clear or explicitly explain hidden catalog selections, avoid unbounded full catalog loading in compose, expose actionable query errors and real 404s. Studio tools should not consume the primary preview stage; group advanced settings with useful summaries. Delivery acceptance is not confirmed delivery/read. Public audit observations are excluded per user scope.

## Final user steering: material and interaction

Theme controls must NEVER use a dropdown. Use a direct keyboard-accessible light/dark/system segmented control. Apply a restrained rounded neobrutalist material: 12px controls, 16px panels, 2px interactive outlines, selective short hard shadows, static finegrain canvas texture, real press/selection/save feedback with reduced-motion alternatives. Custom native SVG eye/price-tag icon and licensed Bricolage Grotesque wordmark replace the generic scan icon. Adopt verified MIT source selectively: ReUI/shadcn/Base UI Combobox and table/toggle patterns, Brut/UI control treatment, Cult pending contract, Animata status and Motion-Primitives controlled selection. Public landings remain excluded. See ui-rounded-neobrutalism-research.md and ui-registry-research-index.md for evidence and final choices.

Brand spelling is explicitly **Espiã** per the user. Public landing content remains excluded, so its historical spelling is not a reason to revert the internal correction. Direct theme ToggleGroup arrows/Home/End move focus; Space/Enter/click commits the preference.
