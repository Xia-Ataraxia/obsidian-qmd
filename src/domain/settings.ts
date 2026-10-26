import type { QmdPluginSettings, QmdSearchMode } from '../types';

export const SEARCH_MODE_LABELS: Record<QmdSearchMode, string> = {
	keyword: 'Exact match',
	semantic: 'Meaning-based',
	hybrid: 'Best of both',
	advanced: 'Custom query',
};

export const SEARCH_MODE_DESCRIPTIONS: Record<QmdSearchMode, string> = {
	keyword: 'Finds the exact words you type.',
	semantic: 'Finds notes with a similar meaning.',
	hybrid: 'Matches exact words and meaning together.',
	advanced: 'Type plain text, or lex, vec, and hyde lines.',
};

export const DEFAULT_SETTINGS: QmdPluginSettings = {
	qmdExecutablePath: 'auto',
	collectionOverride: '',
	defaultSearchMode: 'hybrid',
	lastSearchMode: 'hybrid',
	previewResultLimit: 8,
	relatedResultLimit: 8,
	autoSyncEnabled: true,
	autoSyncDebounceMs: 7000,
	persistLastMode: true,
	showModeSelector: true,
	showSyncStatusBar: true,
	plugin_notices: { muted: {} },
};
