import { afterEach, describe, expect, it, vi } from 'vitest';

import { AutoSyncController } from '../../src/domain/auto-sync';

function useFakeWindowTimers(): void {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
}

describe('AutoSyncController', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('debounces repeated dirty events into one update/embed run', async () => {
    useFakeWindowTimers();
    const calls: string[] = [];
    const controller = new AutoSyncController(100, {
      shouldRun: () => true,
      runUpdate: () => {
        calls.push('update');
        return Promise.resolve();
      },
      runEmbed: () => {
        calls.push('embed');
        return Promise.resolve();
      },
    });

    controller.markDirty();
    controller.markDirty();

    await vi.advanceTimersByTimeAsync(100);

    expect(calls).toEqual(['update', 'embed']);
  });

  it('runs exactly one follow-up pass when changes arrive during an active sync', async () => {
    useFakeWindowTimers();
    const calls: string[] = [];
    let releaseFirstUpdate = () => {};
    let updateRuns = 0;

    const controller = new AutoSyncController(50, {
      shouldRun: () => true,
      runUpdate: async () => {
        calls.push('update');
        updateRuns += 1;
        if (updateRuns === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstUpdate = resolve;
          });
        }
      },
      runEmbed: () => {
        calls.push('embed');
        return Promise.resolve();
      },
    });

    controller.markDirty();
    await vi.advanceTimersByTimeAsync(50);

    controller.markDirty();
    releaseFirstUpdate();
    await vi.runAllTimersAsync();

    expect(calls).toEqual(['update', 'embed', 'update', 'embed']);
  });

  it('does not run embed when update fails', async () => {
    useFakeWindowTimers();
    const phases: string[] = [];
    const controller = new AutoSyncController(25, {
      shouldRun: () => true,
      runUpdate: () => Promise.reject(new Error('update failed')),
      runEmbed: () => {
        phases.push('embed');
        return Promise.resolve();
      },
      onPhaseChange: (phase) => {
        phases.push(phase);
      },
    });

    controller.markDirty();
    await vi.advanceTimersByTimeAsync(25);

    expect(phases).toContain('syncing');
    expect(phases).toContain('error');
    expect(phases).not.toContain('embed');
    expect(phases).not.toContain('embedding');
  });
});
