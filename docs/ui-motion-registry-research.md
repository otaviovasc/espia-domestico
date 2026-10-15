# Ready motion components for Espia Doméstico

Research date: 2026-10-15. Scope: authenticated workspace and login only. No public landing page, media-export appearance, API, saved-data or provider behavior changes are proposed here. This research file is the only file changed by this research task.

## Recommendation

Use a small local collection of adapted, attributed components, sharing one `motion` runtime. Prefer the plain-MIT **Animata Status Button** for save/import actions and **Motion-Primitives AnimatedBackground** for a controlled active indicator. **React Bits StatusMark** and **Animate UI Radix Dialog** are additional candidates with Commons Clause conditions; they are unnecessary if the MIT choices plus the application's accessible dialog foundation meet the need. Keep ordinary press feedback very small. Avoid decorative motion across every card or route.

These are integration candidates verified against actual source, not assurances that copying the demo creates a production-ready interaction. Several demos require changes to state ownership, keyboard behavior or reduced motion. Recommendations below distinguish these changes.

## Sources and licenses

The inspected frontend manifest uses React 19.2, Tailwind 4.1, Vite 7, React Router 7, TanStack Query 5 and Lucide. It had **no Motion or Radix dependency at research start**. Copy-paste registries distribute source; they do not require their Next.js documentation applications. Use `motion/react` consistently if Motion is added; do not add both `motion` and a separate `framer-motion` dependency. [Motion installation](https://motion.dev/docs/react-installation).

| Collection | Actual license verified | Fit and decision |
| --- | --- | --- |
| [Animata](https://animata.design/docs/button/status-button) | [MIT](https://github.com/codse/animata/blob/e7478b835a3b5c4153e71f60666634e91bb38813/LICENSE.md) | Best simple async-button starting point. Preserve its copyright/permission notice when adapting source. |
| [Motion-Primitives](https://motion-primitives.com/docs) | [MIT; file is spelled `LICENCE.md`](https://github.com/ibelick/motion-primitives/blob/120f64f6ca60348e251f929e9c81f11ccbe45eda/LICENCE.md) | Small readable primitives. Its README labels the project beta. Its examples need React 19 typing and interaction review. |
| [Animate UI](https://animate-ui.com/docs/components/radix/dialog) | [MIT + Commons Clause condition](https://github.com/imskyleen/animate-ui/blob/efeb96ffd7a3b7a4868667e4ac3c346620fb3044/LICENSE.md) | Commercial application use is permitted by the actual text; redistribution of original components themselves is restricted. README's plain “MIT” summary is incomplete. Keep actual notice. |
| [React Bits](https://github.com/DavidHDev/react-bits) | [MIT + Commons Clause condition v1.0](https://github.com/DavidHDev/react-bits/blob/43591e8b3fa327d45633b4e8239ff6742ef706ef/LICENSE.md) | StatusMark is directly useful. The license restricts redistribution of components, including ported versions. Application integration must retain the notice. |
| [Magic UI](https://magicui.design/docs/components) | [MIT](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/LICENSE.md) | AnimatedSubscribeButton is an alternative for a binary saved state; less suitable than Animata for real pending/error states. Do not copy paid templates. |

Inspected repository revisions: Animate UI `efeb96f`, Motion-Primitives `120f64f`, Animata `e7478b8`, React Bits `43591e8`, Magic UI `85f97fd`. Animate UI's live JSON registry exposes primitive implementation files that were not present in the inspected GitHub tree; the live registry links below are the actual inspected source for those primitives. Recheck that JSON and record its source revision or digest when vendoring.

For immediate implementation, exact upstream Animata Status Button and Motion-Primitives AnimatedBackground source, full notices and a download receipt are available in the session-local directory `/tmp/espia-motion-mit-y1q0b4x2/`. The receipt records pinned raw URLs and SHA256 digests. This is a handoff artifact, not a permanent application dependency; vendor only selected adapted source and retain its license within the repository when integrated.

## Five integration seams

### 1. Press feedback in the shared Button

**Ready source:** [Animate UI Button documentation](https://animate-ui.com/docs/primitives/buttons/button), [live registry source](https://animate-ui.com/r/primitives-buttons-button.json).

**Actual dependencies:** `motion`, plus Animate UI's Slot registry primitive. The basic implementation is a Motion button with `hoverScale` and `tapScale`; `asChild` adds the Slot dependency.

**Local seam:** `achadinhos-frontend/src/components/ui.tsx` shared `Button`, which is widely reused. Adopt the press behavior within the existing backward-compatible variants and HTML button API. A small CSS press transform is also sufficient if this is the only animation adopted.

**Adaptation:** the ready defaults are hover `1.05`, tap `0.95`, which are too large for this dense workspace. Use hover `1`, tap about `0.98`, 100–140 ms. Never enlarge table rows or move adjacent actions. Suppress transforms when disabled, pending or reduced motion is requested. Preserve the native button, `type`, disabled behavior, accessible name and visible focus ring. Avoid nested buttons when using composition. No click callback should be delayed until the press animation completes.

**Cost:** direct shared `motion` imports can put the runtime on every authenticated route. Prefer CSS for this universal primitive unless Motion is already justified by other selected components.

### 2. Active selection in Studio workspaces and theme controls

**Ready source:** [Motion-Primitives AnimatedBackground docs](https://motion-primitives.com/docs/animated-background), [component source](https://github.com/ibelick/motion-primitives/blob/120f64f6ca60348e251f929e9c81f11ccbe45eda/components/core/animated-background.tsx), [segmented-control example](https://github.com/ibelick/motion-primitives/blob/120f64f6ca60348e251f929e9c81f11ccbe45eda/app/docs/animated-background/segmented-control.tsx).

**Actual dependencies:** `motion` and the local `cn` helper. Source uses `layoutId` and `useId`, enabling one moving background scoped to an instance. It is a visual selection component, not an accessible tabs/radio implementation.

**Local seams:** Studio workspace selector in `StudioTools.tsx`; theme selection in the workspace shell; storyboard choice in `CreativeWorkbench.tsx`. Use only one active accent background within each group. Keep existing semantic native controls and existing selected value as the source of truth.

**Adaptation:** the upstream component stores internal active state and `cloneElement` **overwrites child `onClick`**. Do not wrap existing business actions unchanged. Compose handlers deliberately, derive the visual active item from the controlled application value, and preserve disabled behavior. Its `defaultValue` synchronizes through an effect; a controlled local adaptation should avoid a visibly incorrect initial indicator. It also inserts a `div` inside the cloned child: use a span-based decorative child for native button markup. Make the decoration `aria-hidden` and `pointer-events-none`.

For true tabs, provide tablist/tab/tabpanel semantics, Arrow/Home/End navigation and correct panel associations, or select [Animate UI Radix Tabs](https://animate-ui.com/docs/components/radix/tabs) with [its actual registry dependency list](https://animate-ui.com/r/primitives-radix-tabs.json). Theme choices are naturally radio choices, while routed navigation remains links with `aria-current`; do not relabel those as tabs.

**Motion:** 140–180 ms, no overshoot. Disable the sliding/layout movement under reduced motion; retain instantaneous selected color/border and focus. Do not animate whole workspaces or remount an unsaved form for an indicator change.

### 3. Actual pending, saved and failed results

**First ready source:** [Animata Status Button docs](https://animata.design/docs/button/status-button), [TSX source](https://github.com/codse/animata/blob/e7478b835a3b5c4153e71f60666634e91bb38813/animata/button/status-button.tsx), [registry](https://animata.design/r/button/status-button.json).

**Actual dependencies:** `motion`, `lucide-react`, local `cn`. Lucide is already installed. Source keeps the button element stable and transitions its inner label/icon, a useful starting point for preserving focus.

**Adaptation:** the demo simulates success with two 1.5-second timers. Remove those timers. Drive `idle | pending | success | error` from the actual mutation, and clear success when edits invalidate the saved state. Reserve stable width, use Portuguese action labels, add `aria-busy`, suppress repeated submission, and place a small persistent polite live region next to the action. Display errors with retry guidance and preserve entered data. A completed upload does not mean a completed render or sent/read message.

**Second ready source:** [React Bits StatusMark TS/Tailwind source](https://github.com/DavidHDev/react-bits/blob/43591e8b3fa327d45633b4e8239ff6742ef706ef/src/ts-tailwind/Micro/StatusMark/StatusMark.tsx). This provides controlled `pending | running | done | failed | cancelled`, with optional finite progress. It uses Motion values and direct SVG attribute writes rather than React state on every frame, and already consults `useReducedMotion`.

**Local seams:** actual media upload/render status in `StudioTools.tsx`, recipe-read/review result in `CreativeWorkbench.tsx`, catalog import results, save action near creative controls. Keep each status at its action or file; do not replace the full table on each progress tick.

**StatusMark adaptation:** localize its spoken status strings, use `strike={false}` (a successful saved filename must remain readable), derive colors from semantic success/danger tokens, and give “running” numeric progress only when the underlying operation supplies real progress. The inspected reduced-motion branch stops geometry movement but its CSS still runs an indeterminate opacity-breathing animation; disable that loop for a strict static reduced-motion mode. Do not announce every percentage update. The status itself is not a live region, so provide an appropriately throttled external announcement.

**Alternative examined:** [Magic UI AnimatedSubscribeButton source](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/animated-subscribe-button.tsx). It has controlled `subscribeStatus`, two span children, and a binary toggle; it lacks a real pending/error model. It can inspire “Salvar / Salvo”, but must never toggle success locally before persistence. Animata is the clearer starting point here.

### 4. Safe disclosure and dialog transitions

**Disclosure source examined:** [Motion-Primitives Disclosure docs](https://motion-primitives.com/docs/disclosure), [TSX](https://github.com/ibelick/motion-primitives/blob/120f64f6ca60348e251f929e9c81f11ccbe45eda/components/core/disclosure.tsx).

**Local seams:** advanced audio/creative options and recipe JSON editing. Existing native `details/summary` in `CompositionLayers.tsx`, `CreativeWorkbench.tsx` and `ImportFeedbackList.tsx` already supply useful keyboard semantics. Preserve these when possible; there is no need to replace them solely to add height motion.

The ready Disclosure is lightweight but unmounts content on collapse, clones children and does not wire trigger `aria-controls` to the content ID. React 19 makes some legacy `ReactElement.props` typing stricter, so check the adapted clone typings. If adopting it, use a native `button type="button"`, explicit matching IDs and `aria-expanded`, compose callbacks, retain draft values outside the disappearing subtree, and move focus back to the trigger before hiding focused content. Never keep hidden descendants keyboard-focusable during an exit animation. Limit height animation to a small section; under reduced motion show/hide immediately.

**Dialog ready source:** [Animate UI Radix Dialog docs](https://animate-ui.com/docs/components/radix/dialog), [actual primitive registry](https://animate-ui.com/r/primitives-radix-dialog.json). Dependencies are `motion`, `radix-ui`, and registry helpers `use-controlled-state`/`get-strict-context`. Its documented content does not support consumer `asChild` or `forceMount` because the animation implementation owns these details.

**Local seams:** message preview, media-library picker, connection messages, destructive cancellation/disconnection confirmation. Prefer one shared accessible dialog primitive rather than adding a separate visual wrapper around each bespoke overlay. Radix provides the semantic/focus foundation; verify the integration with [Radix Dialog's documented keyboard and focus behavior](https://www.radix-ui.com/primitives/docs/components/dialog).

**Adaptation:** Animate UI defaults include blur, a 3D flip and scale `0.8`. Override these with a 120–160 ms opacity transition and at most 2–4 px translation; no full-screen blur animation. With reduced motion, use an immediate state change or very brief opacity only. Maintain title/description, focus containment, Escape, safe backdrop policy, scroll locking, and restoration to the opener or a sensible fallback. Do not wait for an exit animation to block duplicate destructive submissions or to expose the mutation result. Dirty forms need an explicit discard path.

**Not selected:** Morphing Dialog for these operational forms. The [showcase](https://motion-primitives.com/docs/morphing-dialog) is visually appealing for a content card expansion, but shared-layout image/card morphing adds complexity without helping a cancellation confirmation or long editable form.

### 5. Confirmation after moving clips and layers

**Primary Motion source:** [layout animations](https://motion.dev/docs/react-layout-animations), [Reorder](https://motion.dev/docs/react-reorder). Use public core Motion APIs, not paid Motion UI examples.

**Local seams:** `CompositionLayers.tsx` already has explicit “Trazer para frente / Enviar para trás” controls and stable `layer.id`; `ClipSequenceEditor.tsx` has clip sequencing. Retain these keyboard-accessible controls. Animate only row positions after a confirmed local order change (`layout="position"`), and optionally a short accent background on the moved item. Announce the new position in a polite status message.

Do not add drag as a requirement for reordering. If drag is later included, use a dedicated handle, keep the existing buttons, avoid hijacking vertical touch scrolling, and persist only through the existing reorder path. Keep stable IDs rather than indices, preserve focus on the same moved item, and prevent display order from changing export layer semantics. In `CompositionLayers`, display order is a reversed copy of the configured layer list; visual order must not become a new persistence contract. Reduced motion changes the position immediately with the same textual confirmation.

## Runtime and bundle boundary

1. Vendor only selected component source plus a small attribution record; do not install all five documentation apps or pull every registry component.
2. Reuse existing React Router lazy route boundaries. Status/editing motion belongs in the affected authenticated route, not the public site bundle. Do not import an animation barrel containing all candidates.
3. A copied registry component importing full `motion` can negate `LazyMotion` savings. If adopting the smaller `m` API, adapt all selected components consistently and verify the chosen feature set: `domAnimation` covers state/hover/tap/exit; layout/drag requires `domMax`. The official guide explains the tradeoff; its quoted KB values are examples, not measured costs for this checkout. [Motion bundle guide](https://motion.dev/docs/react-reduce-bundle-size).
4. Set `MotionConfig reducedMotion="user"` at the relevant app boundary. That suppresses Motion transforms/layout but does **not** disable opacity, color, CSS keyframes, height animation or independent timers. Use `useReducedMotion` and CSS `prefers-reduced-motion` for those cases. Make all pending/success/error information readable with animation disabled. [Motion accessibility](https://motion.dev/docs/react-accessibility).
5. Prefer transform and opacity for short responses. Height animations measure/reflow; limit them to bounded user-opened sections. Do not animate filters, main content blur, every imported row, every polling update or large media previews. Theme switching must never change the rendered/exported creative.

## Verification when a component is adopted

- Run the normal TypeScript/Vite build and inspect actual chunk changes; this research did not install packages or run application tests.
- Exercise pointer and keyboard behavior at 390 px and desktop, in light/dark/system themes, with OS reduced motion enabled. Confirm no shift in document width, no clipping of the focus ring and no blocked action during an animation.
- For status controls, verify actual pending/success/error transitions, retry, stale-result protection, navigation/unmount cleanup and preserved draft data. Never substitute demo timers for operation state.
- For overlays, check initial focus, Tab/Shift+Tab containment, Escape/backdrop rules, close/reopen during animation, restored focus and nested picker behavior.
- For reorder, check keyboard buttons, item identity, announcement and exact export/persistence order before and after the visual change.

Research evidence is source and documentation inspection. No authenticated browser interaction, runtime performance profile, package compatibility build, persistence mutation, deployment or public-page edit was performed by this research task.
