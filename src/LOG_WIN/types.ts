// Типы лог-окна. Должны соответствовать payload-ам, которые шлёт Rust-сторона
// (см. src-tauri/src/commands/window_commands.rs → log_window_emit_*).

export interface LogEntry {
	id: string;
	timestamp: string;
	level: 'info' | 'warn' | 'error' | 'debug';
	message: string;
	meta?: any;
	source: 'main' | 'renderer';
	itemId?: string;
	stepId?: string;
}

export interface StepInfo {
	stepId: string;
	label: string;
	pluginId?: string;
	nodeType: string;
	status: 'queued' | 'running' | 'done' | 'error';
	startTime?: string;
	endTime?: string;
	logs: LogEntry[];
	errorCount: number;
	cost?: string;
	costUnit?: 'HH' | 'MM' | 'ss' | 'run' | 'fromSite';
	finalCost?: number;
}

export interface ProcessingItemGroup {
	itemId: string;
	itemName: string;
	mainFolderName: string;
	projectName: string;
	status: 'queued' | 'running' | 'done' | 'error' | 'aborted';
	startTime: string;
	endTime?: string;
	steps: StepInfo[];
	errorCount: number;
	warnCount: number;
	// логи без stepId (orphan внутри item)
	itemLogs: LogEntry[];
	totalCost?: number;
}

export interface ArchiveDay {
	date: string;
	items: number;
	bytes: number;
}

export type SourceFilter = 'all' | 'main' | 'renderer';
export type TabKey = 'live' | 'archive';
