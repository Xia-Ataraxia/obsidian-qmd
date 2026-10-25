import type { SyncPhase } from '../types';

interface AutoSyncCallbacks {
	shouldRun: () => boolean;
	runUpdate: () => Promise<void>;
	runEmbed: () => Promise<void>;
	onPhaseChange?: (phase: SyncPhase, message: string, error?: string) => void;
	onComplete?: () => void;
}

export class AutoSyncController {
	private debounceMs: number;
	private timer: number | null = null;
	private running = false;
	private dirty = false;
	private rerun = false;
	private disposed = false;

	constructor(debounceMs: number, private readonly callbacks: AutoSyncCallbacks) {
		this.debounceMs = debounceMs;
	}

	setDebounceMs(value: number): void {
		this.debounceMs = value;
	}

	markDirty(): void {
		if (this.disposed) return;

		this.dirty = true;
		if (this.running) {
			this.rerun = true;
			return;
		}

		this.schedule();
	}

	dispose(): void {
		this.disposed = true;
		this.clearTimer();
	}

	private schedule(): void {
		this.clearTimer();
		this.timer = window.setTimeout(() => {
			void this.runIfNeeded();
		}, this.debounceMs);
	}

	private clearTimer(): void {
		if (!this.timer) return;
		window.clearTimeout(this.timer);
		this.timer = null;
	}

	private async runIfNeeded(): Promise<void> {
		if (this.disposed || this.running || !this.dirty) {
			return;
		}

		if (!this.callbacks.shouldRun()) {
			this.dirty = false;
			return;
		}

		this.running = true;
		this.dirty = false;
		this.rerun = false;

		try {
			this.callbacks.onPhaseChange?.('syncing', 'Running qmd update...');
			await this.callbacks.runUpdate();
			this.callbacks.onPhaseChange?.('embedding', 'Running qmd embed...');
			await this.callbacks.runEmbed();
			this.callbacks.onPhaseChange?.('idle', 'QMD ready');
			this.callbacks.onComplete?.();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.callbacks.onPhaseChange?.('error', 'QMD sync failed', message);
		} finally {
			this.running = false;
			if ((this.rerun || this.dirty) && !this.disposed) {
				this.rerun = false;
				this.dirty = true;
				void this.runIfNeeded();
			}
		}
	}
}
