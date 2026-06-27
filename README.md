# Minfolio

A clean, minimalist **WYSIWYG markdown editor and mind-mapping app**, designed to
work well alongside LLMs.

Minfolio edits plain `.md` files on your own filesystem. It **automatically loads
external changes** to the file you have open and **automatically saves your
edits** back to that same file. Because the file on disk is the single source of
truth, an LLM or agent can edit a note while you have it open and you see the
update live, and anything you write is saved back for the LLM to read.

If you and the agent change the same note at the same time, Minfolio
**automatically merges the non-conflicting edits** for you: it runs a three-way,
line-level merge (the same approach git uses) against the last-synced version, so
edits that touch different lines just fold together silently and save. It only
stops to ask you when both sides changed the *same* lines, which is a real
conflict. There is no account, no sync service, and no telemetry.

The same codebase runs as an Android app (including on Meta Quest) and as a macOS
desktop app, and supports multiple windows on Android.

## Screenshots

The editor, with the inline WYSIWYG rendering and the formatting bar (undo/redo,
headings, lists, code, tables):

![Minfolio editor (dark)](docs/screenshots/editor-dark.png)

The same note as a mindmap. Every heading and list item becomes a branch, and
edits flow back to the markdown:

![Minfolio mindmap view](docs/screenshots/mindmap-dark.png)

Light theme:

![Minfolio editor (light)](docs/screenshots/editor-light.png)

## Features

- **Inline WYSIWYG markdown.** Built on [Milkdown](https://milkdown.dev/) (Crepe
  + ProseMirror). Formatting renders in place; the raw markdown markers appear
  around the block you are editing.
- **Mindmap view.** Every note can be viewed as a mindmap, giving you a more
  visual, spatial way to navigate and edit the structure of your markdown
  document. It is a live mindmap view of the same file: edits in the mindmap
  flow back into the markdown, and vice versa. Pan and zoom with mouse,
  trackpad, or touch (including pinch-to-zoom on touch devices and Quest).
- **LLM-friendly file sync.** Auto-loads external edits to the open file and
  auto-saves your own edits back to it, so Minfolio and an LLM agent can share
  the same file in real time.
- **Automatic merge of concurrent edits.** When the open file changes on disk
  while you have unsaved edits, Minfolio performs a three-way, line-level merge
  (diff3-style) against the last-synced version. Non-conflicting changes (edits
  on different lines) merge and save automatically; only edits to the same lines
  prompt you to choose. A toggle in the formatting bar switches between this
  auto-merge mode and a plain reload-with-prompt mode.
- **Formatting toolbar** with multi-level undo/redo, headings, bold/italic/
  strikethrough/inline code, bullet/numbered/task lists, quotes, code blocks,
  tables, and dividers.
- **Multiple windows** on Android (and on macOS), each kept in sync with the
  others as files change on disk.
- **Day and night themes**, applied live without reloading the document.
- **Self-hosted fonts** (Inter, Newsreader, JetBrains Mono): no network calls.

## Platform support

| Platform        | Toolchain | Notes                                          |
| --------------- | --------- | ---------------------------------------------- |
| Android / Quest | Capacitor | Android 8+; multi-window; pinch-zoom mindmap   |
| macOS           | Electron  | Native menus, multi-window, file open          |
| Web             | Vite      | Any modern browser (also the dev environment)  |

## Getting started

Prerequisites: [Node.js](https://nodejs.org/) 18+ and npm.

```bash
npm install        # install dependencies
npm run dev        # start the web app (Vite dev server)
```

### Build

```bash
npm run build      # type-check (tsc --noEmit) and build to dist/
```

### Android (and Meta Quest)

```bash
npm run android    # build the web assets and sync into the Capacitor project
```

Then open `android/` in Android Studio to run or build an APK. You will need an
Android SDK installed; create your own `android/local.properties` pointing at it
(this file is intentionally gitignored). Quest devices install the same APK.

### macOS desktop (Electron)

```bash
npm run electron:dev      # run the desktop app against the Vite dev server
npm run electron:build    # build a distributable .dmg into release/
```

## Project structure

```
src/
  editor/      Milkdown Crepe wrapper (the markdown editor)
  fs/          filesystem abstraction + external-change watcher
  ui/          shell, tabs, sidebar, formatting bar, mindmap host, dialogs
  styles/      theme + dialog CSS
  store.ts     app state
  main.ts      app wiring (autosave, external-change reload, multi-window)
public/mindmap/  the embedded mindmap engine (loaded in an iframe)
electron/      Electron main + preload
android/       Capacitor Android native project
```

## License

Minfolio is released under the [MIT License](LICENSE).

It bundles third-party software (Milkdown, Capacitor, Electron, ProseMirror, and
the Inter / Newsreader / JetBrains Mono fonts). Their licenses and attributions
are listed in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md). The fonts are
licensed under the SIL Open Font License 1.1.
