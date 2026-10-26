import { execFile } from 'child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { describe, expect, it, vi } from 'vitest';

import { QmdProcessAdapter } from '../../src/ui/qmd-process-adapter';

describe('QmdProcessAdapter', () => {
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

  it('matches a vault opened through a symlink by its real path', async () => {
    const execFileAsync = vi.fn(async (file: string, args: string[], options: { cwd?: string }) => {
      if (file === 'pwd') {
        return { stdout: options.cwd === '/Users/test/Link' ? '/Volumes/Data/Vault\n' : `${options.cwd}\n`, stderr: '' };
      }
      if (args[1] === 'list') {
        return { stdout: 'Collections (1):\n\nobsidian (qmd://obsidian/)\n', stderr: '' };
      }
      return { stdout: 'Collection: obsidian\n  Path:     /Volumes/Data/Vault\n  Pattern:  **/*.md\n', stderr: '' };
    });
    const adapter = new QmdProcessAdapter('/opt/qmd/bin/qmd', execFileAsync);

    expect((await adapter.resolveCollectionForVault('/Users/test/Link')).resolved?.name).toBe('obsidian');
    expect((await adapter.resolveCollectionForVault('/Users/test/Link', 'obsidian')).resolved?.name).toBe('obsidian');
    expect((await adapter.resolveCollectionForVault('/Users/test/Other')).resolved).toBeNull();
  });

  it('spawns pwd only after a direct miss and treats a failing pwd as no match', async () => {
    const collectionFake = (collectionPath: string, pwd: (cwd: string) => string) =>
      vi.fn(async (file: string, args: string[], options: { cwd?: string }) => {
        if (file === 'pwd') return { stdout: `${pwd(options.cwd ?? '')}\n`, stderr: '' };
        if (args[1] === 'list') return { stdout: 'Collections (1):\n\nobsidian (qmd://obsidian/)\n', stderr: '' };
        return { stdout: `Collection: obsidian\n  Path:     ${collectionPath}\n  Pattern:  **/*.md\n`, stderr: '' };
      });
    const pwdCalls = (fake: ReturnType<typeof collectionFake>) => fake.mock.calls.filter(([file]) => file === 'pwd').length;

    const exact = collectionFake('/Users/test/Vault', (cwd) => cwd);
    expect((await new QmdProcessAdapter('/opt/qmd/bin/qmd', exact).resolveCollectionForVault('/Users/test/Vault')).resolved?.name).toBe('obsidian');
    expect((await new QmdProcessAdapter('/opt/qmd/bin/qmd', exact).resolveCollectionForVault('/Users/test/Vault', 'obsidian')).resolved?.name).toBe('obsidian');
    expect(pwdCalls(exact)).toBe(0);

    const pwdFails = collectionFake('/Volumes/Data/Vault', () => {
      throw new Error('ETIMEDOUT');
    });
    const failed = await new QmdProcessAdapter('/opt/qmd/bin/qmd', pwdFails).resolveCollectionForVault('/Users/test/Link');
    expect(failed.resolved).toBeNull();
    expect(failed.error).toContain('No QMD collection matches this vault');
    expect(pwdCalls(pwdFails)).toBe(1);

    const elsewhere = collectionFake('/Volumes/Data/Other', () => '/Volumes/Data/Vault');
    const override = await new QmdProcessAdapter('/opt/qmd/bin/qmd', elsewhere).resolveCollectionForVault('/Users/test/Link', 'obsidian');
    expect(override.resolved).toBeNull();
    expect(override.error).toContain('belongs to another folder');
  });

  it('matches a real symlinked vault directory through pwd -P', async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'qmd-link-')));
    const vault = path.join(root, 'Vault');
    const link = path.join(root, 'Link');
    mkdirSync(vault);
    symlinkSync(vault, link);
    const realExecFile = promisify(execFile);
    const execFileAsync = vi.fn(async (file: string, args: string[], options: { cwd?: string }) => {
      if (file === 'pwd') return realExecFile(file, args, { ...options, encoding: 'utf8' });
      if (args[1] === 'list') return { stdout: 'Collections (1):\n\nobsidian (qmd://obsidian/)\n', stderr: '' };
      return { stdout: `Collection: obsidian\n  Path:     ${vault}\n  Pattern:  **/*.md\n`, stderr: '' };
    });

    try {
      const adapter = new QmdProcessAdapter('/opt/qmd/bin/qmd', execFileAsync);
      expect((await adapter.resolveCollectionForVault(link)).resolved?.name).toBe('obsidian');
      expect((await adapter.resolveCollectionForVault(link, 'obsidian')).resolved?.name).toBe('obsidian');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips the realpath step when there are no collections', async () => {
    const execFileAsync = vi.fn(async (file: string, args: string[], _options: { cwd?: string }) => ({
      stdout: file === 'pwd' || args[1] === 'list' ? 'Collections (0):\n' : '',
      stderr: '',
    }));
    const resolved = await new QmdProcessAdapter('/opt/qmd/bin/qmd', execFileAsync).resolveCollectionForVault('/Users/test/Link');

    expect(resolved.resolved).toBeNull();
    expect(execFileAsync.mock.calls.some(([file]) => file === 'pwd')).toBe(false);
  });

  it('uses a configured path directly without asking the login shell', async () => {
    const execFileAsync = vi.fn(async (_file: string, _args: string[], _options: { env?: Record<string, string | undefined> }) => ({ stdout: '', stderr: '' }));
    const adapter = new QmdProcessAdapter('/opt/qmd/bin/qmd', execFileAsync);

    await adapter.checkBinary();

    expect(execFileAsync).toHaveBeenCalledTimes(1);
    expect(execFileAsync).toHaveBeenCalledWith('/opt/qmd/bin/qmd', ['--help'], expect.anything());
  });

  it('resolves qmd through the login shell and runs it with that PATH', async () => {
    const execFileAsync = vi.fn(async (file: string, _args: string[]) =>
      file === '/bin/zsh'
        ? { stdout: 'rc noise\n/usr/bin:/bin\n/Users/test/.bun/bin/qmd\n', stderr: '' }
        : { stdout: JSON.stringify([]), stderr: '' },
    );
    const adapter = new QmdProcessAdapter('qmd', execFileAsync);
    adapter.setWorkingDirectory('/Users/test/Vault');

    await adapter.keywordSearch('search terms', 'obsidian', 5);

    expect(adapter.getResolvedExecutablePath()).toBe('/Users/test/.bun/bin/qmd');
    expect(execFileAsync).toHaveBeenLastCalledWith(
      '/Users/test/.bun/bin/qmd',
      ['search', 'search terms', '-c', 'obsidian', '--json', '-n', '5'],
      expect.objectContaining({
        cwd: '/Users/test/Vault',
        env: expect.objectContaining({ PWD: '/Users/test/Vault', PATH: '/Users/test/.bun/bin:/usr/bin:/bin' }),
      }),
    );
  });

  it('puts the binary folder first on PATH so a node-shebang qmd finds its node', async () => {
    const execFileAsync = vi.fn(async (_file: string, _args: string[], _options: { env?: Record<string, string | undefined> }) => ({ stdout: '', stderr: '' }));
    const adapter = new QmdProcessAdapter('/Users/test/.nvm/versions/node/v22/bin/qmd', execFileAsync);

    await adapter.checkBinary();

    expect(execFileAsync.mock.calls[0]?.[2].env?.PATH?.split(':')[0]).toBe('/Users/test/.nvm/versions/node/v22/bin');
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
