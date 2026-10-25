import { PluginSettingTab, type Setting, type SettingDefinitionItem } from 'obsidian';
import type QmdPlugin from '../main';
import { SEARCH_MODE_LABELS } from '../domain/settings';
import type { QmdPluginSettings } from '../types';

type SettingKey = keyof QmdPluginSettings;

const TEXT_KEYS: SettingKey[] = ['qmdExecutablePath', 'collectionOverride'];

export class QmdSettingTab extends PluginSettingTab {
  private backendSetting: Setting | null = null;

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
              this.renderBackendStatus();
              return () => { this.backendSetting = null; };
            },
          },
          {
            name: 'Executable path',
            desc: 'Leave blank, "auto", or "qmd" to auto-detect npm, bun, nvm, and common path installs.',
            control: { type: 'text', key: 'qmdExecutablePath', placeholder: 'Auto' },
          },
          {
            name: 'Collection override',
            desc: 'Optional qmd collection name to force instead of vault-path auto-detection.',
            control: { type: 'text', key: 'collectionOverride', placeholder: 'Obsidian' },
          },
        ],
      },
      {
        name: 'Default search mode',
        desc: 'Mode selected when the search modal opens.',
        control: { type: 'dropdown', key: 'defaultSearchMode', options: SEARCH_MODE_LABELS },
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
      {
        name: 'Auto-sync',
        desc: 'Run qmd update and qmd embed after vault changes.',
        control: { type: 'toggle', key: 'autoSyncEnabled' },
      },
      {
        name: 'Auto-sync debounce (ms)',
        desc: 'Wait time after the last change before running qmd update and qmd embed.',
        control: { type: 'number', key: 'autoSyncDebounceMs', placeholder: '7000', min: 1, step: 1 },
      },
      {
        name: 'Persist last mode',
        desc: 'Remember the last mode used in the search modal.',
        control: { type: 'toggle', key: 'persistLastMode' },
      },
      {
        name: 'Show mode selector',
        desc: 'Display the search mode pill in the search modal.',
        control: { type: 'toggle', key: 'showModeSelector' },
      },
      {
        name: 'Show sync status bar item',
        desc: 'Display sync status in the Obsidian status bar.',
        control: { type: 'toggle', key: 'showSyncStatusBar' },
      },
      {
        name: 'Unmute notices',
        desc: 'Show notices again that were muted with the bell button.',
        visible: () => this.plugin.notices.listMuted().length > 0,
        action: () => {
          void this.plugin.notices.unmuteAll().then(() => this.update());
        },
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
        break;
      case 'showSyncStatusBar':
        this.plugin.refreshStatusBar();
        break;
    }
  }

  private renderBackendStatus(): void {
    this.backendSetting?.setDesc(createFragment((frag) => {
      frag.createDiv({ text: this.plugin.describeBackend() });
      frag.createDiv({ text: this.plugin.describeExecutableResolution() });
    }));
  }
}
