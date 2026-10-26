import { execFile } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
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

type ExecFileAsync = (
  file: string,
  args: string[],
  options: { encoding: 'utf8'; maxBuffer: number; cwd?: string; env?: Record<string, string | undefined> },
) => Promise<{ stdout: string; stderr: string }>;

const defaultExecFile = promisify(execFile) as ExecFileAsync;
const SHELLS = ['/bin/zsh', '/bin/bash'];
const QMD_PACKAGE_SUBPATH = path.join('@tobilu', 'qmd', 'dist', 'qmd.js');

export class QmdProcessAdapter {
  private resolvedExecutablePath: string | null = null;
  private resolvedNodePath: string | null = null;
  private workingDirectory: string | null = null;

  constructor(
    private executablePath: string,
    private readonly execFileAsync: ExecFileAsync = defaultExecFile,
  ) {}

  setExecutablePath(value: string): void {
    this.executablePath = value;
    this.resolvedExecutablePath = null;
    this.resolvedNodePath = null;
  }

  setWorkingDirectory(value: string | null): void {
    this.workingDirectory = value?.trim() ? normalizeFsPath(value) : null;
  }

  getResolvedExecutablePath(): string | null {
    return this.resolvedExecutablePath;
  }

  getResolvedNodePath(): string | null {
    return this.resolvedNodePath;
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
    await this.run(['update']);
  }

  async runEmbed(): Promise<void> {
    await this.run(['embed']);
  }

  async runAutoSync(): Promise<void> {
    await this.runUpdate();
    await this.runEmbed();
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
    const invocation = await this.resolveInvocation(executable, args);
    const cwd = this.getWorkingDirectory();

    try {
      return await this.execFileAsync(invocation.file, invocation.args, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        cwd,
        env: await this.buildEnvWithNode(executable, cwd),
      });
    } catch (error) {
      throw this.normalizeError(error, executable, invocation.file);
    }
  }

  private async buildEnvWithNode(
    executablePath: string,
    cwd: string,
  ): Promise<Record<string, string | undefined>> {
    const env = { ...process.env, PWD: cwd };

    try {
      const nodePath = await this.resolveNodeRuntime(executablePath);
      const nodeBinDir = path.dirname(nodePath);
      const currentPath = process.env.PATH ?? '';
      if (currentPath.split(':').includes(nodeBinDir)) return env;
      return { ...env, PATH: `${nodeBinDir}:${currentPath}` };
    } catch {
      return env;
    }
  }

  private async resolveExecutablePath(): Promise<string> {
    if (this.resolvedExecutablePath) {
      return this.resolvedExecutablePath;
    }

    const configured = this.executablePath.trim();
    const commandName = this.isAutoDetectPath(configured) ? 'qmd' : configured;

    if (!commandName) {
      this.resolvedExecutablePath = 'qmd';
      return this.resolvedExecutablePath;
    }

    if (commandName.includes('/') || path.isAbsolute(commandName)) {
      this.resolvedExecutablePath = commandName;
      return commandName;
    }

    const shellResolved = await this.resolveFromLoginShell(commandName);
    if (shellResolved) {
      this.resolvedExecutablePath = shellResolved;
      return shellResolved;
    }

    const guessed = this.findCommonBinaryPath(commandName);
    if (guessed) {
      this.resolvedExecutablePath = guessed;
      return guessed;
    }

    const packageScript = commandName === 'qmd' ? this.findInstalledQmdScript() : null;
    if (packageScript) {
      this.resolvedExecutablePath = packageScript;
      return packageScript;
    }

    this.resolvedExecutablePath = commandName;
    return commandName;
  }

  private async resolveInvocation(
    executablePath: string,
    args: string[],
  ): Promise<{ file: string; args: string[] }> {
    if (!this.requiresNodeRuntime(executablePath)) {
      return { file: executablePath, args };
    }

    const nodePath = await this.resolveNodeRuntime(executablePath);
    return {
      file: nodePath,
      args: [executablePath, ...args],
    };
  }

  private async resolveFromLoginShell(commandName: string): Promise<string | null> {
    const cwd = this.getWorkingDirectory();
    const env = { ...process.env, PWD: cwd };

    for (const shell of SHELLS) {
      if (!existsSync(shell)) {
        continue;
      }

      try {
        const { stdout } = await this.execFileAsync(
          shell,
          ['-lc', `command -v ${this.escapeShellArg(commandName)}`],
          {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
            cwd,
            env,
          },
        );

        const resolved = stdout.trim();
        if (resolved && existsSync(resolved)) {
          return resolved;
        }
      } catch {
        // Fall through to other lookup strategies.
      }
    }

    return null;
  }

  private requiresNodeRuntime(executablePath: string): boolean {
    try {
      const header = readFileSync(executablePath, 'utf8').slice(0, 120);
      return header.startsWith('#!/usr/bin/env node') || header.startsWith('#!/usr/bin/node');
    } catch {
      return false;
    }
  }

  private async resolveNodeRuntime(executablePath: string): Promise<string> {
    if (this.resolvedNodePath && existsSync(this.resolvedNodePath)) {
      return this.resolvedNodePath;
    }

    const siblingNode = path.join(path.dirname(executablePath), 'node');
    if (existsSync(siblingNode)) {
      this.resolvedNodePath = siblingNode;
      return siblingNode;
    }

    const shellResolved = await this.resolveFromLoginShell('node');
    if (shellResolved) {
      this.resolvedNodePath = shellResolved;
      return shellResolved;
    }

    const guessed = this.findCommonBinaryPath('node');
    if (guessed) {
      this.resolvedNodePath = guessed;
      return guessed;
    }

    throw new Error(
      `QMD requires Node.js, but no node runtime was found for "${executablePath}". Set QMD executable path to an absolute qmd binary from your Node install.`,
    );
  }

  private findCommonBinaryPath(commandName: string): string | null {
    const candidates = [
      path.join('/opt/homebrew/bin', commandName),
      path.join('/usr/local/bin', commandName),
      path.join(homedir(), '.bun', 'bin', commandName),
      path.join(homedir(), 'bin', commandName),
    ];

    const nvmVersionsDir = path.join(homedir(), '.nvm', 'versions', 'node');
    if (existsSync(nvmVersionsDir)) {
      const versions = readdirSync(nvmVersionsDir).sort().reverse();
      for (const version of versions) {
        candidates.push(path.join(nvmVersionsDir, version, 'bin', commandName));
      }
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private findInstalledQmdScript(): string | null {
    const candidateRoots = [
      path.join('/opt/homebrew', 'lib', 'node_modules'),
      path.join('/usr/local', 'lib', 'node_modules'),
      path.join(homedir(), '.bun', 'install', 'global', 'node_modules'),
    ];

    const nvmVersionsDir = path.join(homedir(), '.nvm', 'versions', 'node');
    if (existsSync(nvmVersionsDir)) {
      const versions = readdirSync(nvmVersionsDir).sort().reverse();
      for (const version of versions) {
        candidateRoots.push(path.join(nvmVersionsDir, version, 'lib', 'node_modules'));
      }
    }

    for (const root of candidateRoots) {
      const candidate = path.join(root, QMD_PACKAGE_SUBPATH);
      if (existsSync(candidate)) {
        return candidate;
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

  private normalizeError(error: unknown, resolvedExecutablePath: string, launchedFile: string): Error {
    const value = error as Error & { code?: string | number; errno?: number; stderr?: string; stdout?: string };

    if (value?.code === 'ENOENT') {
      const configured = this.executablePath.trim() || 'qmd';
      return new Error(
        `QMD binary not found. Configured: "${configured}", resolved: "${resolvedExecutablePath}", launched: "${launchedFile}". Set an absolute path in QMD settings if needed.`,
      );
    }

    const stderr = typeof value?.stderr === 'string' ? value.stderr.trim() : '';
    const stdout = typeof value?.stdout === 'string' ? value.stdout.trim() : '';
    const message = stderr || stdout || value?.message || String(error);

    return new Error(message);
  }
}
