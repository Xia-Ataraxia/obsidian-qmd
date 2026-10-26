import { execFile } from 'child_process';
import { homedir } from 'os';
import * as path from 'path';
import { promisify } from 'util';
import type { QmdCollectionInfo, QmdSearchResult } from '../types';
import {
  normalizeFsPath,
  parseCollectionList,
  parseCollectionShow,
  parseSearchResults,
} from '../utils/parser';
import { buildEmbedArgs, buildUpdateArgs } from '../utils/sync-args';

type ExecFileAsync = (
  file: string,
  args: string[],
  options: { encoding: 'utf8'; maxBuffer: number; cwd?: string; env?: Record<string, string | undefined> },
) => Promise<{ stdout: string; stderr: string }>;

const defaultExecFile = promisify(execFile) as ExecFileAsync;
const SHELLS = ['/bin/zsh', '/bin/bash'];

export class QmdProcessAdapter {
  private resolvedExecutablePath: string | null = null;
  // The GUI app's PATH is minimal; the login shell's PATH lets `#!/usr/bin/env node` scripts find node.
  private loginShellPath: string | null = null;
  private workingDirectory: string | null = null;

  constructor(
    private executablePath: string,
    private readonly execFileAsync: ExecFileAsync = defaultExecFile,
  ) {}

  setExecutablePath(value: string): void {
    this.executablePath = value;
    this.resolvedExecutablePath = null;
    this.loginShellPath = null;
  }

  setWorkingDirectory(value: string | null): void {
    this.workingDirectory = value?.trim() ? normalizeFsPath(value) : null;
  }

  getResolvedExecutablePath(): string | null {
    return this.resolvedExecutablePath;
  }

  async checkBinary(): Promise<void> {
    await this.run(['--help']);
  }

  async listCollections(): Promise<string[]> {
    const { stdout } = await this.run(['collection', 'list']);
    return parseCollectionList(stdout);
  }

  async showCollection(name: string): Promise<QmdCollectionInfo> {
    const { stdout } = await this.run(['collection', 'show', name]);
    return parseCollectionShow(stdout);
  }

  async resolveCollectionForVault(
    vaultPath: string,
    overrideName?: string,
  ): Promise<{ collections: QmdCollectionInfo[]; resolved: QmdCollectionInfo | null; error?: string }> {
    const collections = await this.getCollections();
    const normalizedVaultPath = normalizeFsPath(vaultPath);

    if (collections.length === 0) {
      return {
        collections,
        resolved: null,
        error: 'No QMD collections yet. Add this vault as a collection in QMD.',
      };
    }

    if (overrideName?.trim()) {
      const selected = collections.find((collection) => collection.name === overrideName.trim());
      if (!selected) {
        return {
          collections,
          resolved: null,
          error: `The collection "${overrideName.trim()}" set in settings doesn't exist in QMD.`,
        };
      }

      if (normalizeFsPath(selected.path) !== normalizedVaultPath) {
        return {
          collections,
          resolved: null,
          error: `The collection "${selected.name}" belongs to another folder.`,
        };
      }

      return { collections, resolved: selected };
    }

    const matched = collections.find((collection) => normalizeFsPath(collection.path) === normalizedVaultPath);
    if (!matched) {
      return {
        collections,
        resolved: null,
        error: 'No QMD collection matches this vault yet. Add this vault as a collection in QMD.',
      };
    }

    return { collections, resolved: matched };
  }

  async keywordSearch(query: string, collectionName: string, limit: number): Promise<QmdSearchResult[]> {
    return this.search('search', query, collectionName, limit);
  }

  async semanticSearch(query: string, collectionName: string, limit: number): Promise<QmdSearchResult[]> {
    return this.search('vsearch', query, collectionName, limit);
  }

  async hybridSearch(query: string, collectionName: string, limit: number): Promise<QmdSearchResult[]> {
    return this.search('query', query, collectionName, limit);
  }

  async structuredSearch(queryDocument: string, collectionName: string, limit: number): Promise<QmdSearchResult[]> {
    return this.search('query', queryDocument, collectionName, limit);
  }

  async runUpdate(): Promise<void> {
    await this.run(buildUpdateArgs());
  }

  async runEmbed(collectionName: string): Promise<void> {
    await this.run(buildEmbedArgs(collectionName));
  }

  async runAutoSync(collectionName: string): Promise<void> {
    await this.runUpdate();
    await this.runEmbed(collectionName);
  }

  private async getCollections(): Promise<QmdCollectionInfo[]> {
    const names = await this.listCollections();
    return Promise.all(names.map((name) => this.showCollection(name)));
  }

  private async search(
    command: 'search' | 'vsearch' | 'query',
    query: string,
    collectionName: string,
    limit: number,
  ): Promise<QmdSearchResult[]> {
    const args = [command, query, '-c', collectionName, '--json', '-n', String(limit)];
    const { stdout } = await this.run(args);
    return parseSearchResults(stdout);
  }

  private async run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const executable = await this.resolveExecutablePath();
    const cwd = this.getWorkingDirectory();

    try {
      return await this.execFileAsync(executable, args, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        cwd,
        env: this.buildEnv(executable, cwd),
      });
    } catch (error) {
      throw this.normalizeError(error, executable);
    }
  }

  // Puts the qmd binary's folder first so a node-backed qmd finds the node installed beside it.
  private buildEnv(executablePath: string, cwd: string): Record<string, string | undefined> {
    const basePath = this.loginShellPath ?? process.env.PATH ?? '';
    const entries = basePath.split(':').filter(Boolean);
    const binDir = executablePath.includes('/') ? path.dirname(executablePath) : null;
    const pathEntries = binDir && !entries.includes(binDir) ? [binDir, ...entries] : entries;
    return { ...process.env, PWD: cwd, PATH: pathEntries.join(':') };
  }

  private async resolveExecutablePath(): Promise<string> {
    if (this.resolvedExecutablePath) {
      return this.resolvedExecutablePath;
    }

    const configured = this.executablePath.trim();
    const commandName = this.isAutoDetectPath(configured) ? 'qmd' : configured;

    // An explicit path is used as-is; a missing file surfaces as ENOENT from execFile.
    if (commandName.includes('/')) {
      this.resolvedExecutablePath = commandName;
      return commandName;
    }

    this.resolvedExecutablePath = (await this.resolveFromLoginShell(commandName)) ?? commandName;
    return this.resolvedExecutablePath;
  }

  private async resolveFromLoginShell(commandName: string): Promise<string | null> {
    const cwd = this.getWorkingDirectory();
    const env = { ...process.env, PWD: cwd };

    for (const shell of SHELLS) {
      try {
        const { stdout } = await this.execFileAsync(
          shell,
          ['-lc', `printf '%s\\n' "$PATH"; command -v ${this.escapeShellArg(commandName)}`],
          { encoding: 'utf8', maxBuffer: 1024 * 1024, cwd, env },
        );

        // Last two lines, since rc files may print their own output first.
        const [loginPath = '', resolved = ''] = stdout.trim().split('\n').slice(-2).map((line) => line.trim());
        if (resolved.startsWith('/')) {
          this.loginShellPath = loginPath || null;
          return resolved;
        }
      } catch {
        // Missing shell (ENOENT) or command not found; try the next shell.
      }
    }

    return null;
  }

  private isAutoDetectPath(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized === '' || normalized === 'qmd' || normalized === 'auto';
  }

  private getWorkingDirectory(): string {
    return this.workingDirectory ?? homedir();
  }

  private escapeShellArg(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private normalizeError(error: unknown, resolvedExecutablePath: string): Error {
    const value = error as Error & { code?: string | number; errno?: number; stderr?: string; stdout?: string };

    if (value?.code === 'ENOENT') {
      const configured = this.executablePath.trim() || 'qmd';
      return new Error(
        `QMD binary not found. Configured: "${configured}", resolved: "${resolvedExecutablePath}". Set an absolute path in QMD settings if needed.`,
      );
    }

    const stderr = typeof value?.stderr === 'string' ? value.stderr.trim() : '';
    const stdout = typeof value?.stdout === 'string' ? value.stdout.trim() : '';
    const message = stderr || stdout || value?.message || String(error);

    return new Error(message);
  }
}
