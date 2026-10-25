# QMD

Local semantic search, related notes, and autosync for Obsidian, powered by the local QMD CLI.

[![Latest Release](https://img.shields.io/github/v/release/Xia-Ataraxia/obsidian-qmd?logo=github)](https://github.com/Xia-Ataraxia/obsidian-qmd/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

QMD bridges Obsidian with a local QMD daemon to deliver fast, privacy-first semantic search across your vault. All processing happens on your machine—no data leaves your device. Search by meaning instead of keywords, discover related notes automatically, and keep your notes indexed in real time.

This repo keeps plugin implementation local; shared family assets are limited to contracts, docs, and harness/tooling skeletons.

## Features

- **Local semantic search** — all processing runs on your machine; zero cloud dependencies
- **Related notes view** — always-on sidebar showing semantically similar notes
- **Natural language search** — find notes by meaning using the search modal
- **Four search modes** — keyword (BM25), semantic (vector), hybrid (combined), and advanced queries
- **Auto-sync** — automatically re-indexes notes when they change
- **Fast response** — instant results via local QMD daemon
- **Privacy-first** — zero data leaves your machine
- **Snippet highlighting** — search results include context snippets
- **Wikilink insert** — add results directly to your active note
- **Status bar** — real-time sync and indexing progress

## Installation

### Requirements

- **Obsidian** (desktop only; v0.15.0+)
- **QMD daemon** — local binary installed and running on your system
  - Installation: https://github.com/tobi/qmd
  - The plugin auto-detects the QMD binary on `PATH` or configure a custom path in settings
- **Active QMD collection** — a QMD collection matching your vault directory

### From Release (Recommended)

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Xia-Ataraxia/obsidian-qmd/releases/latest)
2. Create `.obsidian/plugins/qmd/` in your vault
3. Copy the three files into that directory
4. Reload Obsidian
5. Enable **QMD** in Settings > Community plugins

### From Source

```bash
cd <your-vault>/.obsidian/plugins
git clone https://github.com/Xia-Ataraxia/obsidian-qmd.git obsidian-qmd
cd obsidian-qmd
bun install
bun run build
```

Reload Obsidian and enable the plugin under **Settings > Community plugins**.

## Usage

### Getting Started

1. Ensure the `qmd` daemon is installed and available on your system
2. Create a QMD collection pointing to your vault folder
3. Configure the plugin in Settings > QMD
4. Open the search modal: use the command palette or your configured hotkey

### Search Modes

QMD offers four complementary search modes:

| Mode | Best For | Example |
|------|----------|---------|
| **Keyword** (BM25) | Exact terms, technical keywords | `obsidian plugin development` |
| **Semantic** (Vector) | Meaning, concepts, paraphrases | `how do I extend Obsidian` |
| **Hybrid** | Balanced mix of both | `embedding models` |
| **Advanced** | Structured queries | `lex:plugin vec:semantic hyde:advanced` |

### Commands

- **QMD: Open search** — Open the search modal (primary interface)
- **QMD: Open related notes** — Show related notes for the active file
- **QMD: Refresh related notes** — Manually refresh the related notes view
- **QMD: Sync now** — Trigger immediate indexing and embedding
- **QMD: Run update** — Index new and changed files
- **QMD: Run embed** — Generate embeddings for unindexed documents
- **QMD: Re-scan collections** — Auto-detect QMD collections for this vault

### Configuration

Open **Settings > QMD** to customize behavior.

| Setting | Default | Description |
|---------|---------|-------------|
| QMD executable path | `auto` | Path to the `qmd` binary, or `auto` to auto-detect |
| Collection override | _(empty)_ | Force a specific QMD collection name (advanced) |
| Default search mode | `hybrid` | Initial mode when opening the search modal |
| Preview result limit | `8` | Maximum search results shown |
| Related result limit | `8` | Maximum related notes shown in the sidebar |
| Auto-sync enabled | `true` | Automatically index notes when they change |
| Auto-sync debounce | `7000ms` | Wait time after last change before auto-sync |
| Show mode selector | `true` | Display the search mode toggle |
| Persist last mode | `true` | Remember the last-used search mode between sessions |
| Show sync status bar | `true` | Display QMD status in the status bar |

### Screenshots

<!-- screenshot -->

## Development

```bash
bun install
bun run dev         # esbuild watch into dist/
bun run build       # production build into dist/
bun run test         # Unit tests (Vitest)
bun run lint          # ESLint
bun run ci          # build + typecheck + lint + test
```

### Tech Stack

| Category | Technology |
|----------|------------|
| Platform | Obsidian Plugin API |
| Language | TypeScript 5 |
| Bundler | esbuild |
| Search Engine | QMD CLI (BM25 + vector search + hybrid) |
| Testing | Vitest |
| Linting | ESLint + Husky + lint-staged |

### Project Structure

```
obsidian-qmd/
├── src/
│   ├── main.ts              # Plugin entry point
│   ├── domain/             # Auto-sync orchestration, settings, path resolution
│   ├── ui/                 # Search modal, related view, settings, notices, process adapter
│   ├── types/              # TypeScript type definitions
│   └── utils/              # Pure parsing and query helpers
├── scripts/                 # Build and release scripts
├── boiler.config.mjs        # Repo-specific harness/release configuration
└── manifest.json            # Obsidian plugin manifest
```

### Contributing

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Follow [Conventional Commits](https://www.conventionalcommits.org/)
4. Run `bun run ci` to verify changes
5. Submit a pull request

## License

MIT

### Support

If you find QMD useful, consider supporting the developer:

[Buy me a coffee](https://buymeacoffee.com/gobeumsu9)

### Links

- [GitHub Repository](https://github.com/Xia-Ataraxia/obsidian-qmd)
- [QMD Project](https://github.com/tobi/qmd)
- [Obsidian Plugin Docs](https://docs.obsidian.md/)
