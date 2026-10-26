import { ButtonComponent, type HoverPopover, ItemView, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type QmdPlugin from '../main';
import type { CachedRelatedResult, QmdSearchResult } from '../types';
import { renderResultItem } from './result-renderer';

export const QMD_RELATED_VIEW_TYPE = 'qmd-related-view';

const CACHE_MAX_SIZE = 20;
const CACHE_TTL_MS = 60_000;
const FILE_OPEN_DEBOUNCE_MS = 300;

export class QmdRelatedView extends ItemView {
	hoverPopover: HoverPopover | null = null;
	private container!: HTMLDivElement;
	private requestTicket = 0;
	private fileOpenTimer: number | null = null;
	private readonly cache = new Map<string, CachedRelatedResult>();
	private showingCached = false;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: QmdPlugin) {
		super(leaf);
		this.navigation = false;
	}

	static getView(workspace: QmdPlugin['app']['workspace']): QmdRelatedView | null {
		const leaf = workspace.getLeavesOfType(QMD_RELATED_VIEW_TYPE)[0];
		return leaf?.view instanceof QmdRelatedView ? leaf.view : null;
	}

	static async open(workspace: QmdPlugin['app']['workspace']): Promise<void> {
		const existing = QmdRelatedView.getView(workspace);
		if (existing) {
			await existing.renderView();
			await workspace.revealLeaf(existing.leaf);
			return;
		}

		const leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(false);
		await leaf.setViewState({ type: QMD_RELATED_VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}

	getViewType(): string {
		return QMD_RELATED_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Related notes';
	}

	getIcon(): string {
		return 'network';
	}

	async onOpen(): Promise<void> {
		this.containerEl.children[1]!.empty();
		this.container = this.containerEl.children[1] as HTMLDivElement;
		this.container.classList.add('qmd-related-view');

		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				this.debouncedRenderView();
			}),
		);

		await this.renderView();
	}

	onClose(): Promise<void> {
		if (this.fileOpenTimer) {
			window.clearTimeout(this.fileOpenTimer);
			this.fileOpenTimer = null;
		}
		this.container?.empty();
		return Promise.resolve();
	}

	async renderView(force = false): Promise<void> {
		if (!this.container) {
			return;
		}

		const activeFile = this.app.workspace.getActiveFile();
		const ticket = ++this.requestTicket;
		this.showingCached = false;
		this.renderShell(activeFile);

		if (!(activeFile instanceof TFile) || activeFile.extension !== 'md') {
			this.renderEmpty('Open a markdown note to see related results.', 'file-text');
			return;
		}

		const setupMessage = this.plugin.getSetupMessage();
		if (setupMessage) {
			this.renderEmpty(setupMessage, 'alert-circle', {
				label: 'Open settings',
				onClick: () => this.plugin.openSettings(),
			});
			return;
		}

		// Backend still resolving (e.g. right after load); refreshBackendState re-renders when done.
		if (!this.plugin.activeCollection) {
			this.renderSkeleton();
			return;
		}

		if (!force) {
			const cached = this.getCached(activeFile);
			if (cached) {
				this.showingCached = true;
				this.renderShell(activeFile);
				this.renderResults(activeFile, cached.results);
				return;
			}
		}

		this.renderSkeleton();

		try {
			const results = await this.plugin.findRelatedNotes(activeFile);
			if (ticket !== this.requestTicket) {
				return;
			}

			this.setCache(activeFile, results);
			this.renderShell(activeFile);
			this.renderResults(activeFile, results);
		} catch (error) {
			if (ticket !== this.requestTicket) {
				return;
			}

			this.plugin.logger.error('Failed to find related notes', error);
			this.renderShell(activeFile);
			this.renderEmpty('Could not find related notes.', 'alert-circle', {
				label: 'Try again',
				onClick: () => { void this.renderView(true); },
			});
		}
	}

	private debouncedRenderView(): void {
		if (this.fileOpenTimer) {
			window.clearTimeout(this.fileOpenTimer);
		}

		this.fileOpenTimer = window.setTimeout(() => {
			this.fileOpenTimer = null;
			void this.renderView();
		}, FILE_OPEN_DEBOUNCE_MS);
	}

	private getCacheKey(file: TFile): string {
		return `${file.path}:${file.stat.mtime}`;
	}

	private getCached(file: TFile): CachedRelatedResult | null {
		const key = this.getCacheKey(file);
		const entry = this.cache.get(key);
		if (!entry) {
			return null;
		}

		if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
			this.cache.delete(key);
			return null;
		}

		return entry;
	}

	private setCache(file: TFile, results: QmdSearchResult[]): void {
		const key = this.getCacheKey(file);
		this.cache.set(key, { results, timestamp: Date.now() });

		if (this.cache.size > CACHE_MAX_SIZE) {
			let oldestKey: string | null = null;
			let oldestTime = Infinity;
			for (const [k, v] of this.cache) {
				if (v.timestamp < oldestTime) {
					oldestTime = v.timestamp;
					oldestKey = k;
				}
			}
			if (oldestKey) {
				this.cache.delete(oldestKey);
			}
		}
	}

	private renderShell(file: TFile | null): void {
		this.container.empty();

		const header = this.container.createDiv({ cls: 'qmd-related-header' });
		header.createSpan({
			cls: 'qmd-related-filename',
			text: file?.basename ?? 'No active note',
		});

		const actions = header.createDiv({ cls: 'qmd-related-actions' });

		if (this.showingCached) {
			const cachedEl = actions.createSpan({ cls: 'qmd-related-cached' });
			const iconEl = cachedEl.createSpan();
			setIcon(iconEl, 'clock');
			cachedEl.createSpan({ text: 'cached' });
		}

		const refreshBtn = actions.createEl('button', {
			cls: 'clickable-icon',
			attr: { 'aria-label': 'Refresh related notes', type: 'button' },
		});
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.addEventListener('click', () => {
			void this.renderView(true);
		});
	}

	private renderSkeleton(): void {
		const skeletonEl = this.container.createDiv({ cls: 'qmd-skeleton-container' });
		for (let i = 0; i < 4; i++) {
			const row = skeletonEl.createDiv({ cls: 'qmd-skeleton-row' });
			row.createDiv({ cls: 'qmd-skeleton-score' });
			const body = row.createDiv({ cls: 'qmd-skeleton-body' });
			body.createDiv({ cls: 'qmd-skeleton-title' });
			body.createDiv({ cls: 'qmd-skeleton-snippet' });
		}
	}

	private renderEmpty(
		message: string,
		icon: string,
		action?: { label: string; onClick: () => void },
	): void {
		const stateEl = this.container.createDiv({ cls: 'qmd-state' });
		const iconEl = stateEl.createDiv({ cls: 'qmd-state-icon' });
		setIcon(iconEl, icon);
		stateEl.createEl('p', { cls: 'qmd-state-text', text: message });
		if (action) {
			new ButtonComponent(stateEl)
				.setButtonText(action.label)
				.setCta()
				.onClick(action.onClick);
		}
	}

	private renderResults(file: TFile, results: QmdSearchResult[]): void {
		if (results.length === 0) {
			this.renderEmpty(`No related notes for ${file.basename}.`, 'search-x', {
				label: 'Refresh',
				onClick: () => { void this.renderView(true); },
			});
			return;
		}

		const countEl = this.container.querySelector('.qmd-related-filename');
		if (countEl) {
			countEl.textContent = `${file.basename} (${results.length})`;
		}

		const list = this.container.createDiv({
			cls: 'qmd-related-results',
			attr: { role: 'list' },
		});

		for (const [index, result] of results.entries()) {
			renderResultItem({
				plugin: this.plugin,
				result,
				index,
				container: list,
				sourceId: QMD_RELATED_VIEW_TYPE,
				hoverParent: this,
				onOpen: (_i, target) => {
					void this.plugin.openSearchResult(result, target);
				},
			});
		}
	}
}
