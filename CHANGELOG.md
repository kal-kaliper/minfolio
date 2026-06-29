# Changelog

All notable changes to Minfolio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/kal-kaliper/minfolio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kal-kaliper/minfolio/releases/tag/v0.1.0
