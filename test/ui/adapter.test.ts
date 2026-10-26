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
