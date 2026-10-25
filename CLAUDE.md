# obsidian-qmd

Obsidian plugin wrapping the local QMD CLI: search modal, related-notes view, autosync. Root `AGENTS.md` rules apply.

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | esbuild watch into `dist/` |
| `bun run build` | production build into `dist/` |
| `bun run ci` | build + typecheck + lint + test |
| `bun run release <bump>` | opens a release PR via the shared boiler-template script (CI-only tagging) |

## Architecture

- `src/main.ts`: lifecycle, commands, vault watchers, status bar, backend state.
- `src/domain/`: pure logic (auto-sync controller, path resolver, settings defaults). No `obsidian` imports.
- `src/utils/`, `src/types/`: query builder, output parser, shared types. No `obsidian` imports.
- `src/ui/`: process adapter for the `qmd` CLI, search modal, related view, result rendering, notices, logger, declarative settings tab (`getSettingDefinitions()`, requires Obsidian 1.13.0).

## Gotchas

- Manifest id is `obsidian-qmd` (published; never change it).
- Desktop only: spawns the `qmd` executable via the process adapter.
- `AutoSyncController` uses `window.setTimeout`; node tests stub `window` after `vi.useFakeTimers()`.
- CI/release workflows are thin callers of `GoBeromsu/obsidian-boiler-template`.
