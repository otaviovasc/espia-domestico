# Open-source editor research and reuse

Researched 2026-10-05 against upstream repositories and license files.

| Project | Verified source | Fit and decision |
| --- | --- | --- |
| OpenCut | https://github.com/OpenCut-app/OpenCut | The current README describes a rewrite and points users to classic. The Rust/web/desktop rewrite is not an embeddable replacement for this React/Express renderer. |
| OpenCut classic | https://github.com/OpenCut-app/opencut-classic | Archived but MIT licensed. Reused its command base and undo/redo manager, adapted to bounded React form history. |
| OpenVideo / React Video Editor | https://github.com/openvideodev/react-video-editor/blob/main/LICENSE | The former designcombo repository redirects here. Its current custom license restricts commercial entities and selling derivative editors. No code copied. |
| OmniClip | https://github.com/omni-media/omniclip | Browser editor with a different component/rendering stack. Reviewed as an adjacent editor; no code copied. |

## Imported code

OpenCut classic pinned revision: `cf5e79e919144200294fb9fed22a222592a0aeea`.

Source files:

- https://github.com/OpenCut-app/opencut-classic/blob/cf5e79e919144200294fb9fed22a222592a0aeea/apps/web/src/commands/base-command.ts
- https://github.com/OpenCut-app/opencut-classic/blob/cf5e79e919144200294fb9fed22a222592a0aeea/apps/web/src/core/managers/commands.ts
- https://github.com/OpenCut-app/opencut-classic/blob/cf5e79e919144200294fb9fed22a222592a0aeea/LICENSE

Local adaptation: `achadinhos-frontend/src/lib/vendor/opencut/commands.ts`. Removed editor-core, ripple and selection dependencies. Added a 100-command bound and a form-state command. `useCreativeHistory` connects the imported manager to video/carousel editing. New edits clear redo; project switches clear history.

The upstream copyright and full MIT permission/warranty notice are retained beside the adapted source and in `public/open-source/OpenCut-LICENSE.txt`, which Vite includes in distributions. This imports a specific editing subsystem, not an entire CapCut clone. Native slide dragging, crop/audio/motion controls and server persistence are original project code.
