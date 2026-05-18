export type ItemType = 'video' | 'audio' | 'image' | 'text' | 'subtitle' | 'xlsx' | 'folder' | 'unknown';

export type CostUnit = 'HH' | 'MM' | 'ss' | 'run' | 'fromSite';

export type ItemStatus = 'registered' | 'running' | 'done' | 'error' | 'aborted';
export type PluginStatus = 'queued' | 'running' | 'done' | 'error' | 'aborted';

export interface OriginalItem {
	name: string;
	isFolder: boolean;
	sizeBytes: number;
	type: ItemType;
	meta: null | Record<string, unknown>;
}

export interface FinalItem {
	name: string;
	sizeBytes: number;
	type: ItemType;
	savedAt: string;
	mediaDurationSec?: number;
	meta: null | Record<string, unknown>;
}

export interface PluginRecord {
	name: string;
	version: string;
	stepId: string;
	status: PluginStatus;
	startedAt: string | null;
	endedAt: string | null;
	durationSec: number | null;
	cost: string;
	costUnit: CostUnit;
	finalCost: number | null;
	errorCount: number;
}

export interface ItemRecord {
	itemId: string;

	registeredAt: string;
	startedAt: string | null;
	endedAt: string | null;
	durationSec: number | null;

	status: ItemStatus;

	projectName: string;
	mainFolderName: string;
	projectPathGD: string;
	contact: string[];
	description: string;
	tags: string[];
	year: string;
	month: string;
	findTime: string;

	totalCost: number;

	originalItem: OriginalItem;
	finalItems: FinalItem[];
	plugins: PluginRecord[];
}

export interface RegisterFoundPayload {
	description: {
		curItem: string;
		isFolder: boolean;
		size: number;
		projectName: string;
		mainFolderName: string;
		projectPathGD: string;
		contact: string[];
		description: string;
		tags: string[];
		year: string;
		findTime: string;
	};
	plugins: Array<{
		stepId: string;
		pluginId: string;
		pluginVersion: string;
		cost?: string;
		costUnit?: CostUnit;
		isTerminal?: boolean;
	}>;
}
