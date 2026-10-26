import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QmdProcessAdapter } from '../../src/ui/qmd-process-adapter';

describe('QmdProcessAdapter', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('scopes auto-sync embedding to the given collection', async () => {
    const execFileAsync = vi.fn(() => ({ stdout: '', stderr: '' }));
    const adapter = new QmdProcessAdapter('amd', execFileAsync as never);

    await adapter.runAutoSync('docs');

    const calls = execFileAsync.mock.calls.map((call) => (call as unknown as [string, string[]])[1].join(' '));
    expect(calls.filter((args) => args.includes('update') || args.includes('embed'))).toEqual(['update', 'embed -c docs']);
  });

  it('resolves the collection whose path matches the current vault', async () => {
    const execFileAsync = vi.fn((_file: string, args: string[]) => {
      if (args[0] === '--help') {
        return { stdout: '', stderr: '' };
      }

      if (args[0] === 'collection' && args[1] === 'list') {
        return {
          stdout: ['Collections (2):', '', 'obsidian (qmd://obsidian/)', 'docs (qmd://docs/)'].join('\n'),
          stderr: '',
        };
      }

      if (args[0] === 'collection' && args[1] === 'show' && args[2] === 'obsidian') {
        return {
          stdout: ['Collection: obsidian', '  Path:     /Users/test/Vault', '  Pattern:  **/*.md'].join('\n'),
          stderr: '',
        };
      }

      if (args[0] === 'collection' && args[1] === 'show' && args[2] === 'docs') {
        return {
          stdout: ['Collection: docs', '  Path:     /Users/test/Docs', '  Pattern:  **/*.md'].join('\n'),
          stderr: '',
        };
      }

      throw new Error(`Unexpected args: ${args.join(' ')}`);
    });

    const adapter = new QmdProcessAdapter('amd', execFileAsync as never);
    const resolved = await adapter.resolveCollectionForVault('/Users/test/Vault');

    expect(resolved.resolved).toEqual({
      name: 'obsidian',
      path: '/Users/test/Vault',
      pattern: '**/*.md',
    });
    expect(resolved.error).toBeUndefined();
  });

  it('launches node explicitly for a node-backed qmd binary', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'qmd-adapter-'));
    tempDirs.push(tempDir);

    const binDir = path.join(tempDir, 'bin');
    mkdirSync(binDir);

    const qmdPath = path.join(binDir, 'qmd');
    const nodePath = path.join(binDir, 'node');
    writeFileSync(qmdPath, '#!/usr/bin/env node\nconsole.log("qmd");\n', 'utf8');
    writeFileSync(nodePath, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(qmdPath, 0o755);
    chmodSync(nodePath, 0o755);

    const execFileAsync = vi.fn((file: string, args: string[]) => {
      if ((file === '/bin/zsh' || file === '/bin/bash') && args.includes('-lc')) {
        return {
          stdout: `${qmdPath}\n`,
          stderr: '',
        };
      }

      return {
        stdout: JSON.stringify([]),
        stderr: '',
      };
    });

    const adapter = new QmdProcessAdapter('qmd', execFileAsync as never);
    adapter.setWorkingDirectory('/Users/test/Vault');
    await adapter.keywordSearch('search terms', 'obsidian', 5);

    expect(execFileAsync).toHaveBeenLastCalledWith(
      nodePath,
      [
        qmdPath,
        'search',
        'search terms',
        '-c',
        'obsidian',
        '--json',
        '-n',
        '5',
      ],
      expect.objectContaining({
        encoding: 'utf8',
        cwd: '/Users/test/Vault',
        env: expect.objectContaining({
          PWD: '/Users/test/Vault',
        }),
      }),
    );
  });

  it('reports configured and resolved paths when an explicit binary is missing', async () => {
    const execFileAsync = vi.fn((_file: string, _args: string[]) => {
      const error = new Error('spawn ENOENT') as Error & { code?: string };
      error.code = 'ENOENT';
      throw error;
    });

    const adapter = new QmdProcessAdapter('amd', execFileAsync);

    await expect(adapter.checkBinary()).rejects.toThrow(
      'QMD binary not found. Configured: "amd"',
    );
  });
});
