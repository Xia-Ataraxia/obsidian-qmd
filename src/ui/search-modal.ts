import { type HoverPopover, Menu, Modal, Platform, setIcon, setTooltip } from 'obsidian';
import type QmdPlugin from '../main';
import { SEARCH_MODE_DESCRIPTIONS, SEARCH_MODE_LABELS } from '../domain/settings';
import { validateStructuredQueryDocument } from '../utils/parser';
import type { QmdOpenTarget, QmdSearchMode, QmdSearchResult } from '../types';
import { renderResultItem } from './result-renderer';
import { insertResultLink } from './result-actions';

const AUTO_SEARCH_DEBOUNCE_MS = 180;
const SEARCH_MODE_ORDER: QmdSearchMode[] = ['keyword', 'semantic', 'hybrid', 'advanced'];
const SEARCH_MODE_ICONS: Record<QmdSearchMode, string> = {
	keyword: 'whole-word',
	semantic: 'sparkles',
	hybrid: 'combine',
	advanced: 'braces',
};
const STRUCTURED_LINE_RE = /^\s*(lex|vec|hyde|intent):/im;
const MOD_KEY = Platform.isMacOS ? '\u2318' : 'ctrl';
const ALT_KEY = Platform.isMacOS ? '\u2325' : 'alt';
const SHIFT_KEY = Platform.isMacOS ? '\u21e7' : 'shift';

interface EmptyStateOptions {
	icon?: string;
	detail?: string;
	action?: { label: string; onClick: () => void };
}

export class QmdSearchModal extends Modal {
	hoverPopover: HoverPopover | null = null;

	private static activeModal: QmdSearchModal | null = null;

	private readonly advancedChips: Array<{ label: string; value: string }> = [
		{ label: 'lex:', value: 'lex: ' },
		{ label: 'vec:', value: 'vec: ' },
		{ label: 'hyde:', value: 'hyde: ' },
		{ label: 'intent:', value: 'intent: ' },
	];

	private mode: QmdSearchMode;
	private queryInputEl!: HTMLInputElement;
	private clearBtnEl!: HTMLButtonElement;
	private modeIndicatorEl!: HTMLButtonElement;
	private advancedInputEl!: HTMLTextAreaElement;
	private advancedPanelEl!: HTMLDivElement;
	private metaEl!: HTMLDivElement;
	private resultsEl!: HTMLDivElement;
	private resultEls: HTMLElement[] = [];
	private results: QmdSearchResult[] = [];
	private selectedIndex = 0;
	private instructionsEl!: HTMLDivElement;
	private lastQueryText = '';
	private dirty = false;
	private searchTimer: number | null = null;
	private searchInFlight = false;
	private queuedRequest: { mode: QmdSearchMode; query: string; ticket: number } | null = null;
	private latestTicket = 0;

	constructor(
		app: QmdPlugin['app'],
		private readonly plugin: QmdPlugin,
		private readonly initialQuery = '',
	) {
		super(app);
		this.mode = this.plugin.getInitialSearchMode();
	}

	static open(plugin: QmdPlugin, initialQuery = ''): void {
		this.activeModal?.close();
		const modal = new QmdSearchModal(plugin.app, plugin, initialQuery);
		this.activeModal = modal;
		modal.open();
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass('qmd-search-modal', 'prompt');
		modalEl.removeClass('modal');
		modalEl.tabIndex = -1;
		modalEl.querySelector('.modal-header')?.remove();
		modalEl.querySelector('.modal-close-button')?.remove();

		contentEl.empty();
		contentEl.classList.add('qmd-search-shell');

		const inputRow = contentEl.createDiv({ cls: 'qmd-search-input-row' });
		const iconEl = inputRow.createDiv({ cls: 'qmd-search-icon' });
		setIcon(iconEl, 'search');

		this.queryInputEl = inputRow.createEl('input', {
			type: 'text',
			cls: 'qmd-search-input',
			attr: { placeholder: 'Search your vault\u2026' },
		});

		inputRow.createSpan({ cls: 'qmd-advanced-hint', text: 'Structured query' });

		this.modeIndicatorEl = inputRow.createEl('button', {
			cls: 'qmd-mode-indicator',
			attr: { type: 'button', 'aria-label': 'Change search mode' },
		});
		this.modeIndicatorEl.createSpan({ cls: 'qmd-mode-label', text: SEARCH_MODE_LABELS[this.mode] });
		const chevronEl = this.modeIndicatorEl.createSpan({ cls: 'qmd-mode-chevron' });
		setIcon(chevronEl, 'chevron-down');
		this.modeIndicatorEl.addEventListener('click', () => this.showModeMenu());

		if (!this.plugin.settings.showModeSelector) {
			this.modeIndicatorEl.classList.add('is-hidden');
		}

		this.clearBtnEl = inputRow.createEl('button', {
			cls: 'qmd-search-clear clickable-icon',
			attr: { type: 'button' },
		});
		setIcon(this.clearBtnEl, 'x');
		setTooltip(this.clearBtnEl, 'Clear search');
		this.clearBtnEl.addEventListener('click', () => {
			const input = this.activeInput();
			input.value = '';
			this.dirty = true;
			this.results = [];
			this.metaEl.empty();
			this.renderIdleState();
			this.updateClearButton();
			input.focus();
		});

		this.advancedPanelEl = contentEl.createDiv({ cls: 'qmd-advanced-panel' });
		const chipRow = this.advancedPanelEl.createDiv({ cls: 'qmd-advanced-chip-row' });
		for (const chip of this.advancedChips) {
			const button = chipRow.createEl('button', {
				cls: 'qmd-advanced-chip',
				text: chip.label,
			});
			button.type = 'button';
			button.addEventListener('click', () => this.insertAdvancedToken(chip.value));
		}

		this.advancedInputEl = this.advancedPanelEl.createEl('textarea', {
			cls: 'qmd-advanced-input',
			attr: {
				placeholder: 'Intent: what you want\nlex: exact words\nvec: semantic intent',
			},
		});

		const footer = this.advancedPanelEl.createDiv({ cls: 'qmd-advanced-footer' });
		footer.createSpan({ cls: 'qmd-advanced-footer-hint', text: `${MOD_KEY} \u21b5 to run` });
		const runBtn = footer.createEl('button', { cls: 'mod-cta', text: 'Run query', attr: { type: 'button' } });
		runBtn.addEventListener('click', () => { void this.submitCurrentQuery(); });

		this.metaEl = contentEl.createDiv({ cls: 'qmd-search-meta' });
		this.resultsEl = contentEl.createDiv({ cls: 'qmd-search-results' });

		this.instructionsEl = contentEl.createDiv({ cls: 'prompt-instructions qmd-search-instructions' });
		this.renderInstructions();

		this.queryInputEl.addEventListener('input', () => {
			this.dirty = true;
			this.updateClearButton();
			this.scheduleSearch();
		});
		this.queryInputEl.addEventListener('keydown', (event) => this.handleQueryKeydown(event));

		this.advancedInputEl.addEventListener('input', () => {
			this.dirty = true;
			this.updateClearButton();
		});
		this.advancedInputEl.addEventListener('keydown', (event) => this.handleAdvancedKeydown(event));

		if (this.initialQuery && this.mode !== 'advanced') {
			this.queryInputEl.value = this.initialQuery;
			this.dirty = true;
		}

		this.setMode(this.mode);
		this.updateClearButton();

		if (this.initialQuery && this.mode !== 'advanced') {
			this.scheduleSearch();
		} else {
			this.renderIdleState();
		}
	}

	onClose(): void {
		if (this.searchTimer) {
			window.clearTimeout(this.searchTimer);
			this.searchTimer = null;
		}

		if (QmdSearchModal.activeModal === this) {
			QmdSearchModal.activeModal = null;
		}
	}

	private setMode(mode: QmdSearchMode): void {
		this.mode = mode;
		this.modalEl.dataset.qmdSearchMode = mode;

		const labelEl = this.modeIndicatorEl.querySelector('.qmd-mode-label');
		if (labelEl) {
			labelEl.textContent = SEARCH_MODE_LABELS[mode];
		}
		setTooltip(this.modeIndicatorEl, `${SEARCH_MODE_DESCRIPTIONS[mode]} Tab to switch.`);

		this.advancedPanelEl.classList.toggle('is-visible', mode === 'advanced');
		this.queryInputEl.classList.toggle('is-hidden', mode === 'advanced');

		this.plugin.rememberSearchMode(mode);
		this.renderInstructions();
		this.updateClearButton();

		const input = this.activeInput();
		input.focus();
		// Results from another mode would answer a different query, so start fresh.
		if (mode !== 'advanced' && input.value.trim()) {
			this.scheduleSearch();
			return;
		}
		this.dirty = true;
		this.results = [];
		this.metaEl.empty();
		this.renderIdleState();
	}

	private cycleMode(delta: number): void {
		const currentIndex = SEARCH_MODE_ORDER.indexOf(this.mode);
		const nextIndex = (currentIndex + delta + SEARCH_MODE_ORDER.length) % SEARCH_MODE_ORDER.length;
		this.setMode(SEARCH_MODE_ORDER[nextIndex]!);
	}

	private showModeMenu(): void {
		const menu = new Menu();
		for (const mode of SEARCH_MODE_ORDER) {
			menu.addItem((item) => {
				item.setTitle(SEARCH_MODE_LABELS[mode]);
				item.setIcon(SEARCH_MODE_ICONS[mode]);
				item.setChecked(this.mode === mode);
				item.onClick(() => this.setMode(mode));
			});
		}
		const rect = this.modeIndicatorEl.getBoundingClientRect();
		menu.showAtPosition({ x: rect.right, y: rect.bottom + 4, left: true });
	}

	private activeInput(): HTMLInputElement | HTMLTextAreaElement {
		return this.mode === 'advanced' ? this.advancedInputEl : this.queryInputEl;
	}

	private updateClearButton(): void {
		this.clearBtnEl.classList.toggle('is-visible', this.activeInput().value.length > 0);
	}

	private scheduleSearch(): void {
		if (this.mode === 'advanced') {
			return;
		}

		if (this.searchTimer) {
			window.clearTimeout(this.searchTimer);
		}

		this.searchTimer = window.setTimeout(() => {
			void this.submitCurrentQuery();
		}, AUTO_SEARCH_DEBOUNCE_MS);
	}

	private handleQueryKeydown(event: KeyboardEvent): void {
		if (event.key === 'Tab') {
			event.preventDefault();
			this.cycleMode(event.shiftKey ? -1 : 1);
			return;
		}

		// macOS reports Option+O as key 'ø', so match the physical key too.
		if (event.altKey && (event.key.toLowerCase() === 'o' || event.code === 'KeyO') && this.canOpenSelectedResult()) {
			event.preventDefault();
			void this.openSelectedResult('current', true);
			return;
		}

		if (this.handleNavigationShortcut(event)) {
			return;
		}

		if (event.key === 'Enter' && event.shiftKey && this.canOpenSelectedResult()) {
			event.preventDefault();
			this.insertWikilinkForSelectedResult();
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			const target = this.getOpenTargetFromEvent(event);
			if (target && this.canOpenSelectedResult()) {
				void this.openSelectedResult(target);
				return;
			}

			void this.submitCurrentQuery();
		}
	}

	private handleAdvancedKeydown(event: KeyboardEvent): void {
		if (event.key === 'Tab') {
			event.preventDefault();
			this.cycleMode(event.shiftKey ? -1 : 1);
			return;
		}

		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			void this.submitCurrentQuery();
			return;
		}

		if (event.altKey && event.key === 'Enter' && this.canOpenSelectedResult()) {
			event.preventDefault();
			void this.openSelectedResult('split');
		}
	}

	private handleNavigationShortcut(event: KeyboardEvent): boolean {
		if (event.key === 'ArrowDown' || ((event.metaKey || event.ctrlKey) && ['j', 'J', 'n', 'N'].includes(event.key))) {
			event.preventDefault();
			this.moveSelection(1);
			return true;
		}

		if (event.key === 'ArrowUp' || ((event.metaKey || event.ctrlKey) && ['k', 'K', 'p', 'P'].includes(event.key))) {
			event.preventDefault();
			this.moveSelection(-1);
			return true;
		}

		return false;
	}

	private getOpenTargetFromEvent(event: KeyboardEvent): QmdOpenTarget | null {
		if (event.altKey) {
			return 'split';
		}

		if (event.metaKey || event.ctrlKey) {
			return 'tab';
		}

		return this.canOpenSelectedResult() ? 'current' : null;
	}

	private canOpenSelectedResult(): boolean {
		return !this.dirty && this.results.length > 0;
	}

	private moveSelection(delta: number): void {
		if (this.resultEls.length === 0) {
			return;
		}

		this.selectedIndex = (this.selectedIndex + delta + this.resultEls.length) % this.resultEls.length;
		this.refreshSelection();
	}

	private refreshSelection(): void {
		this.resultEls.forEach((el, index) => {
			const selected = index === this.selectedIndex;
			el.classList.toggle('is-selected', selected);
			if (selected) {
				el.scrollIntoView({ block: 'nearest' });
			}
		});
	}

	private submitCurrentQuery(): void {
		const setupMessage = this.plugin.getSetupMessage();
		if (setupMessage) {
			this.renderSetupState(setupMessage);
			return;
		}

		const rawQuery = this.activeInput().value;
		const query = rawQuery.trim();
		if (!query) {
			this.results = [];
			this.renderIdleState();
			return;
		}

		if (this.searchTimer) {
			window.clearTimeout(this.searchTimer);
			this.searchTimer = null;
		}

		this.lastQueryText = query;

		let mode = this.mode;
		let normalizedQuery = query;
		if (mode === 'advanced') {
			if (!STRUCTURED_LINE_RE.test(query)) {
				// Plain text in the custom box is still a search; don't make the user learn the syntax first.
				mode = 'hybrid';
				normalizedQuery = query.replace(/\s+/g, ' ');
			} else {
				const validation = validateStructuredQueryDocument(query);
				if (!validation.valid || !validation.normalized) {
					this.metaEl.empty();
					this.renderEmptyState(validation.error ?? 'Invalid query document.', {
						icon: 'alert-circle',
						detail: 'Or drop the prefixes to search plain text.',
					});
					return;
				}
				normalizedQuery = validation.normalized;
			}
		}

		this.latestTicket += 1;
		this.queueSearchRequest({
			mode,
			query: normalizedQuery,
			ticket: this.latestTicket,
		});
	}

	private queueSearchRequest(request: { mode: QmdSearchMode; query: string; ticket: number }): void {
		this.queuedRequest = request;
		this.metaEl.textContent = `Searching ${SEARCH_MODE_LABELS[request.mode].toLowerCase()}\u2026`;
		this.renderLoading();

		if (this.searchInFlight) {
			return;
		}

		void this.runNextSearchRequest();
	}

	private async runNextSearchRequest(): Promise<void> {
		if (!this.queuedRequest) {
			return;
		}

		const request = this.queuedRequest;
		this.queuedRequest = null;
		this.searchInFlight = true;

		try {
			const startedAt = performance.now();
			let note = '';
			let results: QmdSearchResult[];
			try {
				results = await this.plugin.search(request.mode, request.query);
			} catch (error) {
				if (request.mode !== 'semantic' && request.mode !== 'hybrid') throw error;
				// Embeddings may be missing or stale; exact match still answers the question.
				this.plugin.logger.warn(`${request.mode} search failed, falling back to keyword`, { error: String(error) });
				results = await this.plugin.search('keyword', request.query);
				note = `${SEARCH_MODE_LABELS[request.mode]} unavailable, showing exact matches`;
			}

			if (request.ticket !== this.latestTicket) {
				return;
			}

			this.dirty = false;
			this.results = results;
			this.selectedIndex = 0;
			const elapsedMs = Math.round(performance.now() - startedAt);
			this.renderResults(results, elapsedMs, note);
		} catch (error) {
			if (request.ticket !== this.latestTicket) {
				return;
			}

			const message = error instanceof Error ? error.message : String(error);
			this.plugin.logger.error('Search failed', { error: message });
			this.metaEl.empty();
			this.results = [];
			this.renderEmptyState('Search failed.', {
				icon: 'alert-circle',
				detail: /locked|busy/i.test(message)
					? 'Search is busy. Try again in a moment.'
					: "Couldn't reach the search index. Try again.",
				action: { label: 'Try again', onClick: () => this.submitCurrentQuery() },
			});
		} finally {
			this.searchInFlight = false;
			if (this.queuedRequest) {
				void this.runNextSearchRequest();
			}
		}
	}

	private renderResults(results: QmdSearchResult[], elapsedMs: number, note = ''): void {
		this.resultsEl.empty();
		this.resultsEl.removeClass('is-loading');
		this.resultEls = [];
		const suffix = note ? ` \u00b7 ${note}` : '';

		if (results.length === 0) {
			this.metaEl.textContent = `No results \u00b7 ${elapsedMs}ms${suffix}`;
			const canWiden = this.mode === 'keyword' || this.mode === 'semantic';
			this.renderEmptyState('No matching notes.', {
				icon: 'search-x',
				action: canWiden ? { label: 'Try best of both', onClick: () => this.setMode('hybrid') } : undefined,
			});
			return;
		}

		// Keyword hits have no score; drop the empty column rather than indent every title.
		this.resultsEl.toggleClass('is-unscored', results.every((result) => result.score <= 0));
		this.metaEl.textContent = `${results.length} result${results.length === 1 ? '' : 's'} \u00b7 ${elapsedMs}ms${suffix}`;

		for (const [index, result] of results.entries()) {
			const el = renderResultItem({
				plugin: this.plugin,
				result,
				index,
				container: this.resultsEl,
				sourceId: 'qmd-search-modal',
				hoverParent: this,
				queryText: this.lastQueryText,
				onSelect: (i) => {
					this.selectedIndex = i;
					this.refreshSelection();
				},
				onOpen: (i, target) => {
					this.selectedIndex = i;
					void this.openSelectedResult(target);
				},
			});
			this.resultEls.push(el);
		}

		this.refreshSelection();
	}

	private renderLoading(): void {
		// Keep stale results in place but dimmed so the list doesn't jump while typing.
		if (this.resultEls.length > 0) {
			this.resultsEl.addClass('is-loading');
			return;
		}
		this.resultsEl.empty();
		const skeletonEl = this.resultsEl.createDiv({ cls: 'qmd-skeleton-container' });
		for (let i = 0; i < 4; i++) {
			const row = skeletonEl.createDiv({ cls: 'qmd-skeleton-row' });
			row.createDiv({ cls: 'qmd-skeleton-score' });
			const body = row.createDiv({ cls: 'qmd-skeleton-body' });
			body.createDiv({ cls: 'qmd-skeleton-title' });
			body.createDiv({ cls: 'qmd-skeleton-snippet' });
		}
	}

	private renderIdleState(): void {
		const setupMessage = this.plugin.getSetupMessage();
		if (setupMessage) {
			this.renderSetupState(setupMessage);
			return;
		}
		this.renderEmptyState(SEARCH_MODE_DESCRIPTIONS[this.mode], { icon: SEARCH_MODE_ICONS[this.mode] });
	}

	private renderSetupState(message: string): void {
		this.metaEl.empty();
		this.results = [];
		this.renderEmptyState(message, {
			icon: 'alert-circle',
			action: { label: 'Open settings', onClick: () => this.plugin.openSettings() },
		});
	}

	private renderEmptyState(message: string, opts: EmptyStateOptions = {}): void {
		this.resultsEl.empty();
		this.resultsEl.removeClass('is-loading');
		this.resultEls = [];
		const stateEl = this.resultsEl.createDiv({ cls: 'qmd-state' });
		const iconEl = stateEl.createDiv({ cls: 'qmd-state-icon' });
		setIcon(iconEl, opts.icon ?? 'search');
		stateEl.createEl('p', { cls: 'qmd-state-text', text: message });
		if (opts.detail) {
			stateEl.createEl('p', { cls: 'qmd-state-detail', text: opts.detail });
		}
		if (opts.action) {
			const { label, onClick } = opts.action;
			stateEl.createEl('button', { text: label, attr: { type: 'button' } }).addEventListener('click', onClick);
		}
	}

	private async openSelectedResult(target: QmdOpenTarget = 'current', keepOpen = false): Promise<void> {
		const result = this.results[this.selectedIndex];
		if (!result) {
			return;
		}

		const opened = await this.plugin.openSearchResult(result, target);
		if (opened && !keepOpen) {
			// Restoring focus to the previous editor would steal it back from a newly opened split.
			this.shouldRestoreSelection = false;
			this.close();
		}
	}

	private insertAdvancedToken(value: string): void {
		const { selectionStart, selectionEnd } = this.advancedInputEl;
		const start = selectionStart ?? this.advancedInputEl.value.length;
		const end = selectionEnd ?? this.advancedInputEl.value.length;
		const current = this.advancedInputEl.value;

		this.advancedInputEl.value = `${current.slice(0, start)}${value}${current.slice(end)}`;
		this.advancedInputEl.focus();
		const cursor = start + value.length;
		this.advancedInputEl.setSelectionRange(cursor, cursor);
		this.dirty = true;
	}

	private insertWikilinkForSelectedResult(): void {
		const result = this.results[this.selectedIndex];
		if (result) insertResultLink(this.plugin, result);
	}

	private renderInstructions(): void {
		this.instructionsEl.empty();

		this.createInstruction(this.instructionsEl, '\u2191\u2193', 'navigate');
		this.createInstruction(this.instructionsEl, 'tab', 'switch mode');

		if (this.mode === 'advanced') {
			this.createInstruction(this.instructionsEl, `${MOD_KEY} \u21b5`, 'run query');
		} else {
			this.createInstruction(this.instructionsEl, '\u21b5', 'open');
			this.createInstruction(this.instructionsEl, `${MOD_KEY} \u21b5`, 'new tab');
		}

		this.createInstruction(this.instructionsEl, `${ALT_KEY} \u21b5`, 'split');
		this.createInstruction(this.instructionsEl, `${ALT_KEY} O`, 'open, keep modal');
		this.createInstruction(this.instructionsEl, `${SHIFT_KEY} \u21b5`, 'insert link');
	}

	private createInstruction(container: HTMLDivElement, key: string, text: string): void {
		const item = container.createDiv({ cls: 'prompt-instruction' });
		item.createSpan({ cls: 'prompt-instruction-command', text: key });
		item.createSpan({ text });
	}
}
