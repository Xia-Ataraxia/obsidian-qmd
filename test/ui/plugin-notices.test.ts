import { describe, expect, it, vi } from 'vitest';

import { Notice } from 'obsidian';
import { PluginNotices } from '../../src/ui/plugin-notices';
import type { NoticeCatalog, PluginNoticesHost } from '../../src/ui/plugin-notice-types';

describe('PluginNotices', () => {
  it('interpolates messages and reuses an active notice by id', () => {
    installDom();
    const plugin = createHost();
    const notices = new PluginNotices(plugin, catalog(), 'QMD');

    const first = notices.show('backend_status', { message: 'Ready' });
    const second = notices.show('backend_status', { message: 'Re-indexing' });

    expect(first).toBeInstanceOf(Notice);
    expect(second).toBe(first);
    expect(readText(first)).toContain('Re-indexing');
  });

  it('persists mute state and suppresses muted notices', async () => {
    installDom();
    const plugin = createHost();
    const notices = new PluginNotices(plugin, catalog(), 'QMD');

    await notices.mute('backend_status');

    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(notices.isMuted('backend_status')).toBe(true);
    expect(notices.show('backend_status', { message: 'Ready' })).toBeNull();
  });
});

function catalog(): NoticeCatalog {
  return {
    backend_status: {
      template: '{{message}}',
      timeout: 100,
    },
  };
}

function createHost(): PluginNoticesHost & { saveSettings: ReturnType<typeof vi.fn> } {
  return {
    settings: {},
    saveSettings: vi.fn().mockResolvedValue(undefined),
  };
}

function readText(notice: Notice | null): string {
  const raw = (notice as unknown as { message?: unknown })?.message;
  if (raw instanceof DocumentFragment) return raw.textContent ?? '';
  if (raw instanceof HTMLElement) return raw.textContent ?? '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

function installDom(): void {
  class FakeNode {
    children: FakeNode[] = [];
    textContent = '';

    appendChild(node: FakeNode): FakeNode {
      this.children.push(node);
      this.textContent += node.textContent ?? '';
      return node;
    }
  }

  class FakeDocumentFragment extends FakeNode {}

  class FakeElement extends FakeNode {
    className = '';
    type = '';
    attributes: Record<string, string> = {};

    setAttribute(name: string, value: string): void {
      this.attributes[name] = value;
    }

    addEventListener(_event: string, _callback: () => void): void {}
  }

  const g = globalThis as Record<string, unknown>;
  g.window = globalThis;
  g.DocumentFragment = FakeDocumentFragment;
  g.HTMLElement = FakeElement;
  g.createFragment = () => new FakeDocumentFragment();
  const make = (o?: { cls?: string; type?: string; text?: string }) => {
    const el = new FakeElement();
    el.className = o?.cls ?? '';
    el.type = o?.type ?? '';
    el.textContent = o?.text ?? '';
    return el;
  };
  g.createDiv = (o?: { cls?: string }) => make(o);
  g.createEl = (_tag: string, o?: { cls?: string; type?: string; text?: string }) => make(o);
}
