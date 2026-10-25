# QMD Search

Local QMD search, related notes, and autosync for your vault.

![Searching the vault in the QMD search modal with keyword, semantic, and hybrid modes.](https://raw.githubusercontent.com/Xia-Ataraxia/obsidian-qmd/main/docs/assets/demo.webp)

## Features

- Search by keyword (BM25), meaning (vector), hybrid, or advanced queries in a modal, with highlighted snippets.
- Related notes sidebar for the active note.
- Insert a result as a wikilink into the current note.
- Auto-sync re-indexes notes when they change, with progress in the status bar.

## Usage

1. Install the [QMD CLI](https://github.com/tobi/qmd) and create a QMD collection that points at your vault folder.
2. Open **Settings**, **QMD**. The plugin finds the `qmd` binary on your `PATH`, or you can set its path.
3. Run **Open search**, type a query, and pick a mode.
4. Run **Open related notes** to see notes similar to the active one.

Other commands: **Sync now**, **Run update**, **Run embed**, **Refresh related notes**, **Re-scan collections**.

## Installation

Desktop only, Obsidian 1.13.0 or later.

**Community plugins**: open Settings, Community plugins, Browse, search for "QMD", then Install and Enable.

**Manual**: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Xia-Ataraxia/obsidian-qmd/releases/latest) into `<vault>/<configDir>/plugins/qmd/`, then enable the plugin. `<configDir>` is your vault's configuration folder (`.obsidian` by default).

## Disclosures

- **Network use**: none from the plugin. It runs the local `qmd` command-line program on your machine; your notes are indexed and searched locally.
- **Files outside the vault**: the `qmd` program keeps its own index outside the vault, as set by its own configuration.
- **Telemetry**: none.

## Development

See the [dev contract](https://github.com/GoBeromsu/obsidian-boiler-template#dev-contract): `bun run dev`, `bun run build`, `bun run ci`.

## License

[MIT](LICENSE)
