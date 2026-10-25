import { type HoverPopover, MarkdownView, Menu, Modal, setIcon } from 'obsidian';
import type QmdPlugin from '../main';
import { SEARCH_MODE_DESCRIPTIONS, SEARCH_MODE_LABELS } from '../domain/settings';
import { validateStructuredQueryDocument } from '../utils/parser';
import type { QmdOpenTarget, QmdSearchMode, QmdSearchResult } from '../types';
import { renderResultItem } from './result-renderer';

const AUTO_SEARCH_DEBOUNCE_MS = 180;
const SEARCH_MODE_ORDER: QmdSearchMode[] = ['keyword', 'semantic', 'hybrid', 'advanced'];

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
			attr: { placeholder: 'Search your vault...' },
		});

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
			attr: { 'aria-label': 'Clear search', type: 'button' },
		});
		setIcon(this.clearBtnEl, 'x');
		this.clearBtnEl.addEventListener('click', () => {
			this.queryInputEl.value = '';
			this.dirty = true;
			this.results = [];
			this.renderEmptyState('Type to search your vault...');
			this.updateClearButton();
			this.queryInputEl.focus();
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
			this.renderEmptyState('Type to search your vault...');
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

		this.advancedPanelEl.classList.toggle('is-visible', mode === 'advanced');
		this.queryInputEl.classList.toggle('is-hidden', mode === 'advanced');

		this.plugin.rememberSearchMode(mode);
		this.renderInstructions();

		if (mode === 'advanced') {
			this.advancedInputEl.focus();
			return;
		}

		this.queryInputEl.focus();
		if (this.queryInputEl.value.trim()) {
			this.scheduleSearch();
		}
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
				item.setTitle(`${SEARCH_MODE_LABELS[mode]}  —  ${SEARCH_MODE_DESCRIPTIONS[mode]}`);
				item.setChecked(this.mode === mode);
				item.onClick(() => this.setMode(mode));
			});
		}
		const rect = this.modeIndicatorEl.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private updateClearButton(): void {
		this.clearBtnEl.classList.toggle('is-visible', this.queryInputEl.value.length > 0);
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
			this.plugin.notices.show('setup_error', { message: setupMessage });
			this.metaEl.textContent = setupMessage;
			return;
		}

		const rawQuery = this.mode === 'advanced' ? this.advancedInputEl.value : this.queryInputEl.value;
		const query = rawQuery.trim();
		if (!query) {
			this.results = [];
			this.renderEmptyState('Type to search your vault...');
			return;
		}

		if (this.searchTimer) {
			window.clearTimeout(this.searchTimer);
			this.searchTimer = null;
		}

		this.lastQueryText = query;

		let normalizedQuery = query;
		if (this.mode === 'advanced') {
			const validation = validateStructuredQueryDocument(query);
			if (!validation.valid || !validation.normalized) {
				this.metaEl.textContent = validation.error ?? 'Invalid query document.';
				this.renderEmptyState('Fix the structured query and run it again.');
				return;
			}
			normalizedQuery = validation.normalized;
		}

		this.latestTicket += 1;
		this.queueSearchRequest({
			mode: this.mode,
			query: normalizedQuery,
			ticket: this.latestTicket,
		});
	}

	private queueSearchRequest(request: { mode: QmdSearchMode; query: string; ticket: number }): void {
		this.queuedRequest = request;
		this.metaEl.textContent = `Searching ${SEARCH_MODE_LABELS[request.mode].toLowerCase()} results...`;

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
			const results = await this.plugin.search(request.mode, request.query);

			if (request.ticket !== this.latestTicket) {
				return;
			}

			this.dirty = false;
			this.results = results;
			this.selectedIndex = 0;
			const elapsedMs = Math.round(performance.now() - startedAt);
			this.renderResults(results, elapsedMs);
		} catch (error) {
			if (request.ticket !== this.latestTicket) {
				return;
			}

			const message = error instanceof Error ? error.message : String(error);
			this.metaEl.textContent = message;
			this.renderEmptyState('Search failed.');
		} finally {
			this.searchInFlight = false;
			if (this.queuedRequest) {
				void this.runNextSearchRequest();
			}
		}
	}

	private renderResults(results: QmdSearchResult[], elapsedMs: number): void {
		this.resultsEl.empty();
		this.resultEls = [];

		if (results.length === 0) {
			this.metaEl.textContent = `No results in ${elapsedMs}ms.`;
			this.renderEmptyState('No matching notes.');
			return;
		}

		this.metaEl.textContent = `${results.length} result${results.length === 1 ? '' : 's'} \u00b7 ${elapsedMs}ms`;

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

	private renderEmptyState(message: string): void {
		this.resultsEl.empty();
		this.resultEls = [];
		const stateEl = this.resultsEl.createDiv({ cls: 'qmd-state' });
		const iconEl = stateEl.createDiv({ cls: 'qmd-state-icon' });
		setIcon(iconEl, 'search');
		stateEl.createEl('p', { cls: 'qmd-state-text', text: message });
	}

	private async openSelectedResult(target: QmdOpenTarget = 'current', keepOpen = false): Promise<void> {
		const result = this.results[this.selectedIndex];
		if (!result) {
			return;
		}

		await this.plugin.openSearchResult(result, target);
		if (!keepOpen) {
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
		if (!result) {
			return;
		}

		const relativePath = this.plugin.toVaultRelativePath(result.file);
		if (!relativePath) {
			this.plugin.notices.show('vault_map_error');
			return;
		}

		const wikilink = `[[${relativePath.replace(/\.md$/, '')}]]`;
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView) {
			this.plugin.notices.show('no_active_editor');
			return;
		}

		markdownView.editor.replaceSelection(wikilink);
		this.plugin.notices.show('wikilink_inserted', { wikilink });
	}

	private renderInstructions(): void {
		this.instructionsEl.empty();

		this.createInstruction(this.instructionsEl, '\u2191\u2193', 'navigate');

		if (this.mode === 'advanced') {
			this.createInstruction(this.instructionsEl, 'cmd/ctrl+enter', 'run query');
		} else {
			this.createInstruction(this.instructionsEl, 'enter', 'open');
			this.createInstruction(this.instructionsEl, 'cmd/ctrl+enter', 'new tab');
		}

		this.createInstruction(this.instructionsEl, 'alt+enter', 'split');
		this.createInstruction(this.instructionsEl, 'alt+o', 'open, keep modal');
		this.createInstruction(this.instructionsEl, 'shift+enter', 'insert link');
	}

	private createInstruction(container: HTMLDivElement, key: string, text: string): void {
		const item = container.createDiv({ cls: 'prompt-instruction' });
		item.createSpan({ cls: 'prompt-instruction-command', text: key });
		item.createSpan({ text });
	}
}
