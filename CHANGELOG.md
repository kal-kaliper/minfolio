# Changelog

All notable changes to Minfolio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-07-02

### Added

- **Find and highlighting polish.** Added the find bar, view scale controls,
  update highlighting visibility, and desktop update checks.
- **Copy final path.** Tab right-click menus can now copy the fully resolved
  on-disk path, alongside Reveal in Finder.

### Changed

- External file updates are reconciled across open tabs more reliably, including
  content-based refreshes when switching tabs or saving.

## [0.2.1] - 2026-06-29

### Added

- **Drag-and-drop to open.** Drag a markdown file from Finder/Explorer onto the
  window to open it. On desktop it opens as a live, saveable buffer (its folder
  is added to the sidebar and the file recorded in recents); a "Drop to open"
  overlay shows while a file is dragged over the window.

### Fixed

- Files opened from outside the Documents workspace via the OS `.md` association
  (Finder double-click, drag-to-dock) now open as live absolute-path buffers.
  They previously opened as untitled buffers, so edits and comments were
  silently lost on autosave, "Reveal in Finder" was missing from the tab menu,
  and no folder or recent was recorded for them.
- A toolbar edit made before typing anything (e.g. inserting a comment into a
  freshly-opened file) now marks the buffer dirty and saves. It was previously
  swallowed by the post-load change-suppression guard.
- Thematic breaks (`***` / `---`) render as a short, clearly visible centered
  divider. They were previously a faint, near-invisible line in a large gap that
  read as a rendering artifact, especially in dark mode.
- Dollar amounts no longer render as math, and no longer corrupt the file.
  Crepe's LaTeX feature is disabled, so `$` pairs (e.g. "US$36 billion … $16B")
  stay literal text. Previously the math span could cross `**bold**` markers,
  break the parse, and cause the serializer to escape the orphaned `*` and `$`
  (`\*\*`, `\$`) on save — progressively corrupting any document with dollar
  amounts.
- List items have a little more vertical spacing between them.

## [0.2.0] - 2026-06-29

### Added

- **Workspace folders (desktop).** Add any folder on disk to the sidebar, each
  with its own accent colour and recently-opened files. Folders, recents and the
  selected folder are shared and synced live across windows. Files outside the
  Documents workspace open and save by absolute path.
- **Mindmap node reordering.** Drag a node onto another's top/bottom edge to
  re-sequence it, or onto its centre to nest it. Pointer-based, so it works with
  touch and the Quest controller, not just a desktop mouse.
- **Reveal in Finder / Close tab** from a tab's right-click menu.
- **Text highlight.** Wrap text in `==marks==` (or use the toolbar button) to
  highlight it; round-trips to and from the markdown.
- **Inline comments.** Attach a note to a block from the toolbar. Comments are
  stored inline in the `.md` file as a plain, readable HTML comment
  (`<!-- folio-comment: ... -->`) — invisible when the markdown is rendered
  elsewhere, readable in the raw file, and writable by an LLM agent.
- **Window state restore (macOS).** Each window's position and size are
  remembered and restored on relaunch.
- **External files as live buffers (macOS).** Files opened from outside the
  workspace are tracked as live, auto-syncing buffers like any other note.
- **Tab tooltips.** Truncated tab titles show their full name on hover, and icon
  controls show custom hover tooltips (native `title` tooltips are unreliable in
  a frameless window).

### Changed

- Improved editor sync and formatting fidelity. The external-change watcher now
  compares file content (not just mtime), so edits that preserve the timestamp —
  as LLM agents and some editors do — are still detected.
- The formatting bar no longer gets squashed by the editor's flex basis on long
  documents.
- Recents are pruned when their file is moved or deleted; re-opening a recent no
  longer reorders the list.
- Lead with macOS in the platform descriptions across the README, package
  metadata, and the seeded welcome note.

## [0.1.0] - 2026-06-27

- Initial public release.

[0.2.2]: https://github.com/kal-kaliper/minfolio/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/kal-kaliper/minfolio/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kal-kaliper/minfolio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kal-kaliper/minfolio/releases/tag/v0.1.0
