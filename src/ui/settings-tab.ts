import { PluginSettingTab, setIcon, type Setting, type SettingDefinitionItem } from 'obsidian';
import type QmdPlugin from '../main';
import { SEARCH_MODE_LABELS } from '../domain/settings';
import type { QmdPluginSettings } from '../types';

type SettingKey = keyof QmdPluginSettings;

const TEXT_KEYS: SettingKey[] = ['qmdExecutablePath', 'collectionOverride'];

type BackendTone = 'ready' | 'busy' | 'warning' | 'error';

const TONE_ICONS: Record<BackendTone, string> = {
  ready: 'check-circle-2',
  busy: 'refresh-cw',
  warning: 'alert-triangle',
  error: 'alert-circle',
};

export class QmdSettingTab extends PluginSettingTab {
  private backendSetting: Setting | null = null;
  private syncButton: HTMLButtonElement | null = null;

  constructor(app: QmdPlugin['app'], private readonly plugin: QmdPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: 'Backend',
        items: [
          {
            name: 'Status',
            searchable: false,
            render: (setting) => {
              this.backendSetting = setting;
              setting
                .addExtraButton((button) => button
                  .setIcon('rotate-cw')
                  .setTooltip('Check again')
                  .onClick(() => void this.recheckBackend()))
                .addButton((button) => {
                  this.syncButton = button.buttonEl;
                  button.setButtonText('Sync now').onClick(() => void this.plugin.runSyncNow());
                });
              this.renderBackendStatus();
              return () => {
                this.backendSetting = null;
                this.syncButton = null;
              };
            },
          },
          {
            name: 'Executable path',
            desc: 'Leave blank, "auto", or "qmd" to auto-detect npm, bun, nvm, and common path installs.',
            control: { type: 'text', key: 'qmdExecutablePath', placeholder: 'Auto' },
          },
          {
            name: 'Collection override',
            desc: 'QMD collection to use instead of the one matched to this vault.',
            control: { type: 'text', key: 'collectionOverride', placeholder: 'Auto-detect' },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Search',
        items: [
          {
            name: 'Default search mode',
            desc: 'Mode selected when the search modal opens.',
            control: { type: 'dropdown', key: 'defaultSearchMode', options: SEARCH_MODE_LABELS },
          },
          {
            name: 'Persist last mode',
            desc: 'Remember the last mode used in the search modal.',
            control: { type: 'toggle', key: 'persistLastMode' },
          },
          {
            name: 'Show mode selector',
            desc: 'Display the search mode selector in the search modal.',
            control: { type: 'toggle', key: 'showModeSelector' },
          },
          {
            name: 'Search result limit',
            desc: 'Number of results shown in the search modal.',
            control: { type: 'number', key: 'previewResultLimit', placeholder: '8', min: 1, step: 1 },
          },
          {
            name: 'Related note limit',
            desc: 'Number of related notes shown in the sidebar view.',
            control: { type: 'number', key: 'relatedResultLimit', placeholder: '8', min: 1, step: 1 },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Sync',
        items: [
          {
            name: 'Auto-sync',
            desc: 'Update the search index after vault changes, then build embeddings for the active collection.',
            control: { type: 'toggle', key: 'autoSyncEnabled' },
          },
          {
            name: 'Auto-sync debounce (ms)',
            desc: 'Wait time after the last change before syncing.',
            visible: () => this.plugin.settings.autoSyncEnabled,
            control: { type: 'number', key: 'autoSyncDebounceMs', placeholder: '7000', min: 1, step: 1 },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Display',
        items: [
          {
            name: 'Show sync status bar item',
            desc: 'Display sync status in the status bar.',
            control: { type: 'toggle', key: 'showSyncStatusBar' },
          },
      {
        name: 'Unmute notices',
        desc: 'Show notices again that were muted with the bell button.',
        visible: () => this.plugin.notices.listMuted().length > 0,
        action: () => {
          void this.plugin.notices.unmuteAll().then(() => {
            this.plugin.notices.show('notices_unmuted', {}, { timeout: 2000 });
            this.update();
          });
        },
      },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as SettingKey];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    settings[key] = this.normalize(key as SettingKey, value, settings[key]);
    await this.plugin.saveSettings();
    await this.applySideEffects(key as SettingKey);
  }

  private normalize(key: SettingKey, value: unknown, previous: unknown): unknown {
    if (TEXT_KEYS.includes(key)) return String(value).trim();
    if (typeof previous === 'number') {
      const parsed = Math.trunc(Number(value));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : previous;
    }
    return value;
  }

  private async applySideEffects(key: SettingKey): Promise<void> {
    switch (key) {
      case 'qmdExecutablePath':
      case 'collectionOverride':
        await this.plugin.refreshBackendState();
        this.renderBackendStatus();
        break;
      case 'relatedResultLimit':
        await this.plugin.refreshRelatedView();
        break;
      case 'autoSyncDebounceMs':
        this.plugin.configureAutoSync();
        break;
      case 'autoSyncEnabled':
        this.plugin.refreshStatusBar();
        this.update();
        break;
      case 'showSyncStatusBar':
        this.plugin.refreshStatusBar();
        break;
    }
  }

  renderBackendStatus(): void {
    if (!this.backendSetting) return;
    const tone = this.getBackendTone();
    this.backendSetting.setDesc(createFragment((frag) => {
      const line = frag.createDiv({ cls: `qmd-backend-status is-${tone}` });
      setIcon(line.createSpan({ cls: 'qmd-backend-status-icon' }), TONE_ICONS[tone]);
      line.createSpan({ text: tone === 'busy' || tone === 'error' ? this.plugin.syncState.message : this.plugin.describeBackend() });
      frag.createDiv({ cls: 'qmd-backend-detail', text: this.plugin.describeExecutableResolution() });
    }));
    if (this.syncButton) {
      this.syncButton.disabled = tone === 'warning' || tone === 'busy';
      this.syncButton.setText(tone === 'busy' ? 'Syncing…' : 'Sync now');
    }
  }

  private getBackendTone(): BackendTone {
    if (this.plugin.getSetupMessage()) return 'warning';
    switch (this.plugin.syncState.phase) {
      case 'syncing':
      case 'embedding':
        return 'busy';
      case 'error':
        return 'error';
      default:
        return 'ready';
    }
  }

  private async recheckBackend(): Promise<void> {
    await this.plugin.refreshBackendState();
    this.update();
  }
}
