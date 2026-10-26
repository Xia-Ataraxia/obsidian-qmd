import { Notice } from 'obsidian';
import { buildNoticeFragment } from './plugin-notice-fragment';
import type {
  NoticeCatalog,
  NoticeShowOptions,
  PluginNoticesHost,
} from './plugin-notice-types';

const BUILTIN_TEMPLATES: Record<string, string> = {
  notice_muted: 'Notice muted.',
  notices_unmuted: 'Notices unmuted.',
};

export class PluginNotices {
  private readonly active = new Map<string, Notice>();
  private readonly activeTimers = new Map<string, number>();

  constructor(
    private readonly plugin: PluginNoticesHost,
    private readonly catalog: NoticeCatalog,
    private readonly prefix: string,
  ) {}

  show(id: string, params?: Record<string, unknown>, opts?: NoticeShowOptions): Notice | null {
    if (this.isMuted(id)) return null;

    const definition = this.catalog[id];
    const template = definition?.template ?? BUILTIN_TEMPLATES[id] ?? id;
    const timeout = opts?.timeout ?? definition?.timeout ?? 5000;
    const immutable = definition?.immutable ?? id in BUILTIN_TEMPLATES;
    const message = this.interpolate(template, params ?? {});
    const fragment = buildNoticeFragment({
      id,
      prefix: this.prefix,
      text: message,
      immutable,
      button: opts?.button
        ? {
          text: opts.button.text,
          callback: () => {
            opts.button?.callback();
            this.remove(id);
          },
        }
        : undefined,
      onMute: (noticeId) => void this.handleMute(noticeId),
    });

    const existing = this.active.get(id);
    if (existing) {
      existing.setMessage(fragment);
      this.scheduleCleanup(id, timeout);
      return existing;
    }

    const notice = new Notice(fragment, timeout);
    this.active.set(id, notice);
    this.scheduleCleanup(id, timeout);
    return notice;
  }

  remove(id: string): void {
    this.active.get(id)?.hide();
    this.active.delete(id);

    const timer = this.activeTimers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.activeTimers.delete(id);
    }
  }

  async mute(id: string): Promise<void> {
    const store = this.getMutedStore();
    store[id] = true;
    await this.plugin.saveSettings();
  }

  async unmute(id: string): Promise<void> {
    const store = this.getMutedStore();
    if (store[id]) {
      delete store[id];
      await this.plugin.saveSettings();
    }
  }

  async unmuteAll(): Promise<void> {
    const store = this.getMutedStore();
    if (Object.keys(store).length === 0) return;
    this.getPluginNoticesSettings().muted = {};
    await this.plugin.saveSettings();
  }

  isMuted(id: string): boolean {
    const store = this.getMutedStore();
    return store[id] === true;
  }

  listMuted(): string[] {
    const store = this.getMutedStore();
    return Object.keys(store)
      .filter((key) => store[key] === true)
      .sort();
  }

  has(id: string): boolean {
    return this.catalog[id] !== undefined;
  }

  unload(): void {
    for (const id of this.active.keys()) {
      this.remove(id);
    }
  }

  private async handleMute(id: string): Promise<void> {
    try {
      await this.mute(id);
      this.remove(id);
      this.show('notice_muted', {}, {
        timeout: 4000,
        button: { text: 'Undo', callback: () => void this.unmute(id) },
      });
    } catch (error: unknown) {
      console.error(`[${this.prefix}] Failed to mute notice:`, error);
    }
  }

  private getMutedStore(): Record<string, boolean> {
    return this.getPluginNoticesSettings().muted;
  }

  private getPluginNoticesSettings(): { muted: Record<string, boolean> } {
    const settings = this.plugin.settings;

    if (!settings['plugin_notices'] || typeof settings['plugin_notices'] !== 'object') {
      settings['plugin_notices'] = { muted: {} };
    }

    const notices = settings['plugin_notices'] as Record<string, unknown>;
    if (!notices['muted'] || typeof notices['muted'] !== 'object') {
      notices['muted'] = {};
    }

    return notices as { muted: Record<string, boolean> };
  }

  private interpolate(template: string, params: Record<string, unknown>): string {
    return template.replace(/{{\s*([\w.-]+)\s*}}/g, (_match, key: string) => {
      const value = params[key];
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return JSON.stringify(value);
    });
  }

  private scheduleCleanup(id: string, timeout: number): void {
    const existing = this.activeTimers.get(id);
    if (existing !== undefined) {
      window.clearTimeout(existing);
      this.activeTimers.delete(id);
    }
    if (timeout <= 0) return;

    const timer = window.setTimeout(() => {
      this.active.delete(id);
      this.activeTimers.delete(id);
    }, timeout + 50);
    this.activeTimers.set(id, timer);
  }
}
