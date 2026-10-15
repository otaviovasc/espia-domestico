# UI source research and adoption

The expanded research covered **62 distinct libraries, registries, collections and reference systems** on 15 October 2026. The count deduplicates Base UI, Sonner and Animate UI across specialist reports. Page Flows, Refero and Coolors were additional limited/blocked checks and are excluded from the 62. A verified homepage does not imply every component was tested, licensed for copying, or adopted.

## Breadth

- **Libraries and interaction systems:** HeroUI, React Aria Components, Base UI, Ariakit, Headless UI, Radix Primitives, Ark UI, Park UI, Mantine, Chakra UI, Ant Design, MUI Material, Primer React, Blueprint, Sonner, cmdk, react-dropzone, Vaul.
- **Additional registries:** Kibo UI, Intent UI, coss / Origin UI, Kokonut UI, Smooth UI, UI Layouts, Jolly UI, Shadcn Studio, Shadcn UI Blocks, AI Elements, Skiper UI, 8bitcn, Eldora UI, Aceternity UI, Fancy Components.
- **Operational registries:** shadcn/ui, Base UI, Dice UI, ReUI, Animate UI, Cult UI, Sonner.
- **Motion collections:** Animata, Motion-Primitives, Animate UI, React Bits, Magic UI.
- **Rounded neobrutalism:** Neobrutalism components, Brut/UI, neobrutal-ui, BoldKit.
- **Collections and palette systems:** Uiverse, 21st.dev, shadcn.io, The Component Gallery, Mobbin, Nicelydone, Landbook, Recent / Godly, Radix Colors, Leonardo, OKLCH Color Picker, Realtime Colors, Open Props, Happy Hues, Huemint, Carbon data-table guidance.

## Actual implementation choices

| Upstream | Incorporated source or behavior | Platform use |
| --- | --- | --- |
| ReUI + shadcn/ui + Base UI | Actual multi-select Combobox registry composition, adapted controlled IDs/snapshots and chips | Campaign destinations; keyboard search, selection/removal, contained mobile popup |
| shadcn/ui + Base UI | Actual ToggleGroup registry composition; theme value cannot be deselected | Direct light/dark/system buttons, no theme dropdown |
| shadcn/ui | Actual Table source, with local semantic styles | Catalog import/review tables and consistent row/header structure |
| Brut/UI | Selected control, quiet-control and focus material treatment | Rounded controls, short hard shadow, restrained press feedback |
| Cult UI | Pending-state contract, without Halo decoration | Native buttons with loading label, disabled submission and aria-busy |
| Motion-Primitives | Actual AnimatedBackground useId/layoutId source, adapted to controlled render props | Studio tab indicator; existing callbacks, keyboard semantics and draft state preserved |
| Animata | Actual StatusButton transition structure, controlled by real persistence | Studio saving/dirty/saved/error state; no simulated success timers |

These selected sources have verified MIT notices. Base UI and Motion are the only new runtime packages. The original eye/offer-tag vector logo and Memphis vector scenes are custom work; Bricolage Grotesque, Manrope and IBM Plex Sans are self-hosted with their font notices. Media artwork and exported creative colors remain independent of application theme.

## Detailed evidence

- [Operational registry sources, dependencies and licenses](ui-registry-components-research.md)
- [Fifteen additional registries and explicit rejections](ui-registry-breadth-research.md)
- [Eighteen component libraries and interaction systems](ui-library-systems-research.md)
- [Motion source, pinned commits and adaptation pitfalls](ui-motion-registry-research.md)
- [Rounded neobrutalist sources and three contrast-tested palettes](ui-rounded-neobrutalism-research.md)
- [Collections, inspiration rights and palette tools](ui-collections-palettes-research.md)

Free code, paid blocks and inspiration screenshots were kept distinct. In particular, Animate UI and React Bits have additional Commons Clause conditions; current coss has directory-specific licenses; Vaul declares itself unmaintained. Their appearance in the research is not blanket permission or an adoption decision. Exact adopted source notices are retained in source headers and public app license assets.

The original palette alternatives were compared; the implemented choice is Azul oferta, with cool neutral surfaces, blue actions, warm yellow price/brand accents, and separate semantic error/success/warning colors. The final material combines static grain, bounded original vector motifs, 12px controls, 16px surfaces, deliberate outlines and selective offset shadows. Motion responds to actual selection, pressing and persistence, with static reduced-motion alternatives.
