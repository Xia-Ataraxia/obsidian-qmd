import { MarkdownView, Menu, TFile } from 'obsidian';
import type QmdPlugin from '../main';
import type { QmdSearchResult } from '../types';

export function showResultContextMenu(plugin: QmdPlugin, result: QmdSearchResult, event: MouseEvent): void {
  const relativePath = plugin.toVaultRelativePath(result.file);
  if (!relativePath) {
    plugin.notices.show('vault_map_error');
    return;
  }

  const abstractFile = plugin.app.vault.getAbstractFileByPath(relativePath);
  if (!(abstractFile instanceof TFile)) {
    plugin.notices.show('resolve_error', { name: plugin.getResultFallbackTitle(result) });
    return;
  }

  const menu = new Menu();

  menu.addItem((item) =>
    item
      .setTitle('Open')
      .setIcon('document')
      .onClick(() => {
        void plugin.openSearchResult(result, 'current');
      }),
  );

  menu.addItem((item) =>
    item
      .setTitle('Open in new tab')
      .setIcon('external-link')
      .onClick(() => {
        void plugin.openSearchResult(result, 'tab');
      }),
  );

  menu.addItem((item) =>
    item
      .setTitle('Open to the right')
      .setIcon('separator-vertical')
      .onClick(() => {
        void plugin.openSearchResult(result, 'split');
      }),
  );

  menu.addSeparator();

  menu.addItem((item) =>
    item
      .setTitle('Insert link')
      .setIcon('link')
      .onClick(() => {
        insertResultLink(plugin, result);
      }),
  );

  menu.showAtMouseEvent(event);
}

// Follows the vault's link settings (wikilink vs Markdown, shortest vs full path) relative to the active note.
export function buildResultLink(plugin: QmdPlugin, relativePath: string): string {
  const file = plugin.app.vault.getAbstractFileByPath(relativePath);
  if (!(file instanceof TFile)) {
    return `[[${relativePath.replace(/\.md$/, '')}]]`;
  }
  const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? '';
  return plugin.app.fileManager.generateMarkdownLink(file, sourcePath);
}

// Targets the most recent note editor, so it also works from the sidebar or a popout where the active leaf isn't an editor.
export function insertResultLink(plugin: QmdPlugin, result: QmdSearchResult): void {
  const relativePath = plugin.toVaultRelativePath(result.file);
  if (!relativePath) {
    plugin.notices.show('vault_map_error');
    return;
  }

  const view = plugin.getRecentNoteLeaf(true)?.view;
  if (!(view instanceof MarkdownView)) {
    plugin.notices.show('no_active_editor');
    return;
  }

  view.editor.replaceSelection(buildResultLink(plugin, relativePath));
  plugin.notices.show('wikilink_inserted', { name: plugin.getResultFallbackTitle(result) });
}
