import { homedir } from 'os';
import { MarkdownView, Plugin, TAbstractFile, TFile, setTooltip } from 'obsidian';
import { AutoSyncController } from './domain/auto-sync';
import { VaultPathResolver } from './domain/path-resolver';
import { parseLegacyData } from './domain/legacy-data';
import { DEFAULT_SETTINGS } from './domain/settings';
import type {
  QmdCollectionInfo,
  QmdOpenTarget,
  QmdPluginSettings,
  QmdSearchMode,
  QmdSearchResult,
  SyncState,
} from './types';
import { QmdProcessAdapter } from './ui/qmd-process-adapter';
import { QmdRelatedView, QMD_RELATED_VIEW_TYPE } from './ui/related-view';
import { QmdSearchModal } from './ui/search-modal';
import { QmdSettingTab } from './ui/settings-tab';
import { buildRelatedQueryDocument, buildRelatedQuerySource } from './utils/query-builder';
import { toVaultRelativePath } from './utils/parser';
import { PluginLogger } from './ui/plugin-logger';
import { PluginNotices } from './ui/plugin-notices';
import type { NoticeCatalog, PluginNoticesHost } from './ui/plugin-notice-types';

const NOTICE_CATALOG: NoticeCatalog = {
  backend_status:         { template: '{{ message }}', timeout: 5000 },
  setup_error:            { template: '{{ message }}', timeout: 5000 },
  sync_complete:          { template: 'Search index is up to date.', timeout: 4000 },
  sync_error:             { template: "Couldn't sync the search index. Try again.", timeout: 6000 },
  update_complete:        { template: 'Search index updated.', timeout: 4000 },
  update_error:           { template: "Couldn't update the search index. Try again.", timeout: 6000 },
  embed_complete:         { template: 'Embeddings are up to date.', timeout: 4000 },
  embed_error:            { template: "Couldn't build embeddings. Try again.", timeout: 6000 },
  vault_map_error:        { template: 'Search result does not map to the current vault.', timeout: 4000, immutable: true },
  resolve_error:          { template: 'Could not find "{{ name }}".', timeout: 4000, immutable: true },
  wikilink_copied:        { template: 'Copied link.', timeout: 3000, immutable: true },
  wikilink_copy_failed:   { template: 'Failed to copy link.', timeout: 4000, immutable: true },
  wikilink_inserted:      { template: 'Inserted link to {{ name }}.', timeout: 3000, immutable: true },
  no_active_editor:       { template: 'No active editor to insert link.', timeout: 4000, immutable: true },
};

export default class QmdPlugin extends Plugin {
  settings!: QmdPluginSettings;
  adapter!: QmdProcessAdapter;
  collections: QmdCollectionInfo[] = [];
  activeCollection: QmdCollectionInfo | null = null;
  syncState: SyncState = { phase: 'idle', message: 'QMD ready' };

  readonly notices = new PluginNotices(this as unknown as PluginNoticesHost, NOTICE_CATALOG, this.manifest.name);
  readonly logger = new PluginLogger('QMD');
  private setupMessage: string | null = null;
  private statusBarEl?: HTMLElement;
  private settingTab?: QmdSettingTab;
  private autoSync?: AutoSyncController;
  private pathResolver = new VaultPathResolver();
  private unloading = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.adapter = new QmdProcessAdapter(this.settings.qmdExecutablePath);
    this.adapter.setWorkingDirectory(this.getVaultPath());
    this.autoSync = new AutoSyncController(this.settings.autoSyncDebounceMs, {
      shouldRun: () => this.canAutoSync(),
      runUpdate: () => this.adapter.runUpdate(),
      runEmbed: () => this.adapter.runEmbed(),
      onPhaseChange: (phase, message, error) => {
        if (error) this.logger.error('Auto-sync failed', { error });
        this.syncState = { phase, message, error };
        this.refreshStatusBar();
      },
      onComplete: () => {
        void this.handleAutoSyncComplete();
      },
    });

    this.registerView(
      QMD_RELATED_VIEW_TYPE,
      (leaf) => new QmdRelatedView(leaf, this),
    );

    this.registerHoverLinkSource(QMD_RELATED_VIEW_TYPE, {
      display: 'QMD related notes',
      defaultMod: true,
    });
    this.registerHoverLinkSource('qmd-search-modal', {
      display: 'QMD search',
      defaultMod: true,
    });

    this.settingTab = new QmdSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerCommands();
    // Vault "create" fires for every existing file during startup; only watch changes after layout is ready.
    this.app.workspace.onLayoutReady(() => this.registerVaultWatchers());

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClasses(['qmd-status-bar', 'mod-clickable']);
    this.registerDomEvent(this.statusBarEl, 'click', () => {
      if (this.setupMessage) this.openSettings();
      else if (this.syncState.phase === 'error') void this.runSyncNow();
      else QmdSearchModal.open(this, this.getActiveEditorSelection());
    });
    this.refreshStatusBar();

    await this.refreshBackendState();
  }

  onunload(): void {
    this.unloading = true;
    this.autoSync?.dispose();
    this.notices.unload();
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData() as Partial<typeof DEFAULT_SETTINGS> | null) ?? await this.adoptLegacyData();
    this.settings = { ...DEFAULT_SETTINGS, ...stored };
  }

  // One-time adoption of data saved under the pre-rename plugin id "obsidian-qmd"; the old folder is left untouched.
  private async adoptLegacyData(): Promise<Partial<typeof DEFAULT_SETTINGS> | null> {
    const path = `${this.app.vault.configDir}/plugins/obsidian-qmd/data.json`;
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(path))) {
      return null;
    }

    const legacy = parseLegacyData(await adapter.read(path));
    if (legacy) {
      await this.saveData(legacy);
    }
    return legacy;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  configureAutoSync(): void {
    this.autoSync?.setDebounceMs(this.settings.autoSyncDebounceMs);
    this.refreshStatusBar();
  }

  getInitialSearchMode(): QmdSearchMode {
    if (this.settings.persistLastMode && this.settings.lastSearchMode) {
      return this.settings.lastSearchMode;
    }

    return this.settings.defaultSearchMode;
  }

  rememberSearchMode(mode: QmdSearchMode): void {
    if (!this.settings.persistLastMode || this.settings.lastSearchMode === mode) {
      return;
    }

    this.settings.lastSearchMode = mode;
    void this.saveSettings();
  }

  openSettings(): void {
    // app.setting is internal; guard each call so a future rename only no-ops.
    const setting = (this.app as typeof this.app & {
      setting?: { open?: () => void; openTabById?: (id: string) => void };
    }).setting;
    setting?.open?.();
    setting?.openTabById?.(this.manifest.id);
  }

  getSetupMessage(): string | null {
    return this.setupMessage;
  }

  describeBackend(): string {
    if (this.setupMessage) {
      return this.setupMessage;
    }

    if (!this.activeCollection) {
      return 'QMD is ready, but no collection is active yet.';
    }

    return `Using the "${this.activeCollection.name}" collection.`;
  }

  describeExecutableResolution(): string {
    const resolvedBinary = this.adapter.getResolvedExecutablePath();
    if (!resolvedBinary) {
      return 'QMD executable has not been resolved yet.';
    }

    const configuredValue = this.settings.qmdExecutablePath.trim();
    const autoDetect = configuredValue === '' || configuredValue.toLowerCase() === 'auto' || configuredValue === 'qmd';
    const nodeRuntime = this.adapter.getResolvedNodePath();
    const modeLabel = autoDetect ? 'Auto-detected' : 'Configured';
    const nodeLabel = nodeRuntime ? ` via ${tildify(nodeRuntime)}` : '';

    return `${modeLabel} executable: ${tildify(resolvedBinary)}${nodeLabel}`;
  }

  async refreshBackendState(showNotice = false): Promise<void> {
    const vaultPath = this.getVaultPath();

    this.adapter.setWorkingDirectory(vaultPath);
    this.adapter.setExecutablePath(this.settings.qmdExecutablePath.trim() || DEFAULT_SETTINGS.qmdExecutablePath);

    try {
      await this.adapter.checkBinary();

      if (!vaultPath) {
        this.collections = [];
        this.activeCollection = null;
        this.setupMessage = 'Could not determine the current vault path.';
      } else {
        const resolved = await this.adapter.resolveCollectionForVault(vaultPath, this.settings.collectionOverride);
        this.collections = resolved.collections;
        this.activeCollection = resolved.resolved;
        this.setupMessage = resolved.error ?? null;
      }
    } catch (error) {
      this.collections = [];
      this.activeCollection = null;
      this.logger.error('QMD setup check failed', { error: error instanceof Error ? error.message : String(error) });
      this.setupMessage = "Couldn't start QMD. Check the executable path in settings.";
    }

    if (!this.setupMessage && this.syncState.phase !== 'error') {
      this.syncState = { phase: 'idle', message: 'QMD ready' };
    }

    this.refreshStatusBar();
    await this.refreshRelatedView();

    if (showNotice) {
      this.notices.show('backend_status', { message: this.describeBackend() });
    }
  }

  refreshStatusBar(): void {
    this.settingTab?.renderBackendStatus();
    if (!this.statusBarEl) {
      return;
    }

    this.statusBarEl.toggleClass('qmd-status-bar--hidden', !this.settings.showSyncStatusBar);
    if (!this.settings.showSyncStatusBar) {
      return;
    }

    let label = 'QMD';
    let detail = this.describeBackend();
    let state = 'idle';

    if (this.setupMessage) {
      label = 'QMD: Setup';
      state = 'setup';
    } else if (this.syncState.phase === 'syncing') {
      label = 'QMD: Syncing';
      state = 'syncing';
      detail = this.syncState.message;
    } else if (this.syncState.phase === 'embedding') {
      label = 'QMD: Embedding';
      state = 'embedding';
      detail = this.syncState.message;
    } else if (this.syncState.phase === 'error') {
      label = 'QMD: Error';
      state = 'error';
      detail = this.syncState.message;
    } else if (this.activeCollection) {
      label = `QMD: ${this.activeCollection.name}`;
    }

    const changed = this.statusBarEl.getText() !== label;
    this.statusBarEl.setText(label);
    const hint = this.setupMessage ? 'Click to open settings.' : state === 'error' ? 'Click to sync again.' : 'Click to search.';
    setTooltip(this.statusBarEl, `${detail}\n${hint}`, { placement: 'top' });
    this.statusBarEl.removeClasses(['is-setup', 'is-syncing', 'is-embedding', 'is-error']);
    if (state !== 'idle') this.statusBarEl.addClass(`is-${state}`);
    if (changed) {
      this.statusBarEl.removeClass('qmd-status-bar--swap');
      void this.statusBarEl.offsetWidth;
      this.statusBarEl.addClass('qmd-status-bar--swap');
    }
  }

  async search(mode: QmdSearchMode, query: string): Promise<QmdSearchResult[]> {
    const collection = this.requireActiveCollection();

    switch (mode) {
      case 'keyword':
        return this.adapter.keywordSearch(query, collection.name, this.settings.previewResultLimit);
      case 'semantic':
        return this.adapter.semanticSearch(query, collection.name, this.settings.previewResultLimit);
      case 'hybrid':
        return this.adapter.hybridSearch(query, collection.name, this.settings.previewResultLimit);
      case 'advanced':
        return this.adapter.structuredSearch(query, collection.name, this.settings.previewResultLimit);
    }
  }

  async findRelatedNotes(file: TFile): Promise<QmdSearchResult[]> {
    const collection = this.requireActiveCollection();
    const content = await this.app.vault.cachedRead(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const source = buildRelatedQuerySource(file.path, content, cache);
    const query = buildRelatedQueryDocument(source);
    const limit = this.settings.relatedResultLimit;
    // The note itself usually ranks first, so fetch one extra to fill the limit after dropping it.
    const results = await this.adapter.structuredSearch(query, collection.name, limit + 1);

    return results.filter((result) => this.toVaultRelativePath(result.file) !== file.path).slice(0, limit);
  }

  toVaultRelativePath(value: string): string | null {
    if (!this.activeCollection) {
      return null;
    }

    const slugified = toVaultRelativePath(value, this.activeCollection.name);
    if (!slugified) {
      return null;
    }

    this.pathResolver.rebuildIfDirty(this.app.vault.getFiles());
    if (this.pathResolver.isAmbiguous(slugified)) {
      return null;
    }
    return this.pathResolver.resolve(slugified) ?? slugified;
  }

  getResultFallbackTitle(result: QmdSearchResult): string {
    const mapped = this.toVaultRelativePath(result.file) ?? result.file;
    return mapped.split('/').pop()?.replace(/\.md$/, '') ?? result.file;
  }

  // Reports failures as notices so every caller (modal, related view, context menu) gets feedback.
  async openSearchResult(result: QmdSearchResult, target: QmdOpenTarget = 'current'): Promise<boolean> {
    const relativePath = this.toVaultRelativePath(result.file);
    if (!relativePath) {
      this.notices.show('vault_map_error');
      return false;
    }

    const abstractFile = this.app.vault.getAbstractFileByPath(relativePath);
    if (!(abstractFile instanceof TFile)) {
      this.notices.show('resolve_error', { name: this.getResultFallbackTitle(result) });
      return false;
    }

    const leaf = target === 'tab'
      ? this.app.workspace.getLeaf('tab')
      : target === 'split'
        ? this.app.workspace.getLeaf('split')
        : this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);

    await leaf.openFile(abstractFile);
    return true;
  }

  async refreshRelatedView(): Promise<void> {
    const view = QmdRelatedView.getView(this.app.workspace);
    if (view) {
      await view.renderView(true);
    }
  }

  private registerCommands(): void {
    this.addCommand({
      id: 'open-search',
      name: 'Open search',
      callback: () => QmdSearchModal.open(this, this.getActiveEditorSelection()),
    });

    this.addCommand({
      id: 'open-related-notes',
      name: 'Open related notes',
      callback: () => {
        void QmdRelatedView.open(this.app.workspace);
      },
    });

    this.addCommand({
      id: 'refresh-related-notes',
      name: 'Refresh related notes',
      callback: () => {
        void this.refreshRelatedView();
      },
    });

    this.addCommand({
      id: 'sync-now',
      name: 'Sync now',
      callback: () => {
        void this.runSyncNow();
      },
    });

    this.addCommand({
      id: 'run-update',
      name: 'Run update',
      callback: () => {
        void this.runUpdateCommand();
      },
    });

    this.addCommand({
      id: 'run-embed',
      name: 'Run embed',
      callback: () => {
        void this.runEmbedCommand();
      },
    });

    this.addCommand({
      id: 'rescan-collections',
      name: 'Re-scan collections',
      callback: () => {
        void this.refreshBackendState(true);
      },
    });
  }

  private registerVaultWatchers(): void {
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        this.handleVaultMutation(file);
      }),
    );

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        this.handleVaultMutation(file);
      }),
    );

    this.registerEvent(
      this.app.vault.on('rename', (file) => {
        this.handleVaultMutation(file);
      }),
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.handleVaultMutation(file);
      }),
    );

    this.registerEvent(
      this.app.workspace.on('editor-change', () => {
        this.handleVaultMutation(this.app.workspace.getActiveFile());
      }),
    );
  }

  private handleVaultMutation(file: TAbstractFile | null): void {
    if (!(file instanceof TFile) || file.extension !== 'md') {
      return;
    }

    this.pathResolver.markDirty();
    this.autoSync?.markDirty();
  }

  private canAutoSync(): boolean {
    return !this.unloading && this.settings.autoSyncEnabled && Boolean(this.activeCollection) && !this.setupMessage;
  }

  private async handleAutoSyncComplete(): Promise<void> {
    await this.refreshRelatedView();
  }

  async runSyncNow(): Promise<void> {
    if (this.setupMessage) {
      this.notices.show('setup_error', { message: this.setupMessage });
      return;
    }

    try {
      await this.adapter.checkBinary();
      this.syncState = { phase: 'syncing', message: 'Updating the search index\u2026' };
      this.refreshStatusBar();
      await this.adapter.runAutoSync();
      this.syncState = { phase: 'idle', message: 'QMD ready' };
      this.refreshStatusBar();
      await this.refreshRelatedView();
      this.notices.show('sync_complete');
    } catch (error) {
      this.failSync("Couldn't sync the search index.", error);
      this.notices.show('sync_error');
    }
  }

  private async runUpdateCommand(): Promise<void> {
    try {
      await this.adapter.checkBinary();
      this.syncState = { phase: 'syncing', message: 'Updating the search index\u2026' };
      this.refreshStatusBar();
      await this.adapter.runUpdate();
      await this.refreshBackendState();
      this.notices.show('update_complete');
    } catch (error) {
      this.failSync("Couldn't update the search index.", error);
      this.notices.show('update_error');
    }
  }

  private async runEmbedCommand(): Promise<void> {
    try {
      await this.adapter.checkBinary();
      this.syncState = { phase: 'embedding', message: 'Building embeddings\u2026' };
      this.refreshStatusBar();
      await this.adapter.runEmbed();
      this.syncState = { phase: 'idle', message: 'QMD ready' };
      this.refreshStatusBar();
      await this.refreshRelatedView();
      this.notices.show('embed_complete');
    } catch (error) {
      this.failSync("Couldn't build embeddings.", error);
      this.notices.show('embed_error');
    }
  }

  private failSync(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error(message, { error: detail });
    this.syncState = { phase: 'error', message, error: detail };
    this.refreshStatusBar();
  }

  private requireActiveCollection(): QmdCollectionInfo {
    if (!this.activeCollection || this.setupMessage) {
      throw new Error(this.setupMessage ?? 'No active qmd collection for this vault.');
    }

    return this.activeCollection;
  }

  private getVaultPath(): string | null {
    const adapter = this.app.vault.adapter as { basePath?: string };
    return adapter.basePath ?? null;
  }

  private getActiveEditorSelection(): string {
    const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    return editor?.getSelection().trim() ?? '';
  }
}

function tildify(filePath: string): string {
  const home = homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}
