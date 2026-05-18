import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import { nanoid } from 'nanoid';
import type {
	ItemRecord,
	ItemStatus,
	ItemType,
	FinalItem,
	PluginRecord,
	RegisterFoundPayload,
} from './dbExporter.types';
import type { SaveContext, TemplateError } from './templates.types';
import { SaveEvent } from './templates.types';
import { ALL_TEMPLATES } from './templates/registry';
import { readAppSettings } from './settings/appSettings';
import { getStoreState } from './storeCache';

const execFileAsync = promisify(execFile);

function getFfprobePath(): string | null {
	const progObj = getStoreState<any[]>('progPath');
	if (!progObj) return null;
	for (const prog of progObj) {
		if (prog.name === 'ffprobe') {
			const p = prog.path;
			return Array.isArray(p) ? String(p[0] ?? '') : String(p ?? '');
		}
	}
	return null;
}

async function probeMediaDuration(ffprobe: string, filePath: string): Promise<number | undefined> {
	try {
		const { stdout } = await execFileAsync(
			ffprobe,
			['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath],
			{ timeout: 10000 },
		);
		const parsed = JSON.parse(stdout);
		const dur = parseFloat(parsed?.format?.duration);
		return isFinite(dur) && dur > 0 ? dur : undefined;
	} catch {
		return undefined;
	}
}

const EXT_TO_TYPE: Record<string, ItemType> = {
	mp4: 'video', mov: 'video', mkv: 'video', avi: 'video', webm: 'video', m4v: 'video',
	mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio', m4a: 'audio',
	jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image', tiff: 'image',
	txt: 'text', md: 'text', csv: 'text', json: 'text',
	srt: 'subtitle', vtt: 'subtitle', ass: 'subtitle', ssa: 'subtitle',
	xlsx: 'xlsx', xls: 'xlsx',
};

function detectItemType(name: string, isFolder: boolean): ItemType {
	if (isFolder) return 'folder';
	const ext = path.extname(name).slice(1).toLowerCase();
	return EXT_TO_TYPE[ext] ?? 'unknown';
}

function diffSec(startIso: string | null, endIso: string | null): number | null {
	if (!startIso || !endIso) return null;
	return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000;
}

export class DbExporter {
	private items = new Map<string, ItemRecord>();
	private logFile: string;
	private templateErrors: TemplateError[] = [];

	constructor() {
		const logsDir = path.join(app.getPath('userData'), 'logs');
		if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
		this.logFile = path.join(logsDir, 'db-export.jsonl');
	}

	getLogFile(): string {
		return this.logFile;
	}

	getTemplateErrors(): TemplateError[] {
		return this.templateErrors;
	}

	clearTemplateErrors(): void {
		this.templateErrors = [];
	}

	registerFound(payload: RegisterFoundPayload): string {
		const itemId = nanoid();
		const now = new Date();
		const registeredAt = now.toISOString();
		const month = String(now.getUTCMonth() + 1).padStart(2, '0');

		const plugins: PluginRecord[] = payload.plugins.map((p) => ({
			name: p.pluginId,
			version: p.pluginVersion,
			stepId: p.stepId,
			status: 'queued',
			startedAt: null,
			endedAt: null,
			durationSec: null,
			cost: p.cost ?? '0',
			costUnit: p.costUnit ?? 'run',
			finalCost: null,
			errorCount: 0,
		}));

		const record: ItemRecord = {
			itemId,
			registeredAt,
			startedAt: null,
			endedAt: null,
			durationSec: null,
			status: 'registered',
			projectName: payload.description.projectName,
			mainFolderName: payload.description.mainFolderName,
			projectPathGD: payload.description.projectPathGD,
			contact: payload.description.contact,
			description: payload.description.description,
			tags: payload.description.tags,
			year: payload.description.year,
			month,
			findTime: payload.description.findTime,
			totalCost: 0,
			originalItem: {
				name: payload.description.curItem,
				isFolder: payload.description.isFolder,
				sizeBytes: payload.description.size,
				type: detectItemType(payload.description.curItem, payload.description.isFolder),
				meta: null,
			},
			finalItems: [],
			plugins,
		};

		this.items.set(itemId, record);
		this.dump(record);
		this.runTemplates({ event: SaveEvent.RegisterFound, record }).catch(() => {});
		return itemId;
	}

	itemStart(itemId: string) {
		const r = this.items.get(itemId);
		if (!r) return;
		r.status = 'running';
		r.startedAt = new Date().toISOString();
		this.dump(r);
		this.runTemplates({ event: SaveEvent.ItemStart, record: r }).catch(() => {});
	}

	itemEnd(itemId: string, status: Extract<ItemStatus, 'done' | 'error' | 'aborted'>, totalCost: number) {
		const r = this.items.get(itemId);
		if (!r) return;
		r.status = status;
		r.endedAt = new Date().toISOString();
		r.durationSec = diffSec(r.startedAt, r.endedAt);
		r.totalCost = totalCost;
		this.dump(r);
		// Запускаем шаблоны сохранения (локальный архив, БД и т.д.)
		this.runTemplates({ event: SaveEvent.ItemEnd, record: r }).catch(() => {});
	}

	nodeStart(itemId: string, stepId: string) {
		const r = this.items.get(itemId);
		if (!r) return;
		const p = r.plugins.find((x) => x.stepId === stepId);
		if (!p) return;
		p.status = 'running';
		p.startedAt = new Date().toISOString();
		this.dump(r);
		this.runTemplates({ event: SaveEvent.NodeStart, record: r }).catch(() => {});
	}

	async nodeDone(
		itemId: string,
		stepId: string,
		finalCost: number | undefined,
		output: unknown,
		isTerminal: boolean,
	): Promise<void> {
		const r = this.items.get(itemId);
		if (!r) return;
		const p = r.plugins.find((x) => x.stepId === stepId);
		if (!p) return;
		p.status = 'done';
		p.endedAt = new Date().toISOString();
		p.durationSec = diffSec(p.startedAt, p.endedAt);
		p.finalCost = finalCost ?? null;

		if (isTerminal) await this.appendFinalItems(r, stepId, output);
		this.dump(r);
		this.runTemplates({ event: SaveEvent.NodeDone, record: r }).catch(() => {});
	}

	nodeError(itemId: string, stepId: string, finalCost: number | undefined) {
		const r = this.items.get(itemId);
		if (!r) return;
		const p = r.plugins.find((x) => x.stepId === stepId);
		if (!p) return;
		p.status = 'error';
		p.endedAt = new Date().toISOString();
		p.durationSec = diffSec(p.startedAt, p.endedAt);
		p.finalCost = finalCost ?? null;
		p.errorCount++;
		this.dump(r);
		this.runTemplates({ event: SaveEvent.NodeError, record: r }).catch(() => {});
	}

	private async appendFinalItems(r: ItemRecord, _stepId: string, output: unknown): Promise<void> {
		const paths: string[] = Array.isArray(output)
			? output.filter((x): x is string => typeof x === 'string')
			: typeof output === 'string'
				? [output]
				: [];

		const ffprobe = getFfprobePath();
		const savedAt = new Date().toISOString();
		for (const p of paths) {
			const name = path.basename(p);
			let sizeBytes = 0;
			try {
				const st = fs.statSync(p);
				sizeBytes = st.isFile() ? st.size : 0;
			} catch {
				// file not accessible — leave 0
			}
			const itemType = detectItemType(name, false);
			let mediaDurationSec: number | undefined;
			if (ffprobe && (itemType === 'video' || itemType === 'audio')) {
				mediaDurationSec = await probeMediaDuration(ffprobe, p);
			}
			const fi: FinalItem = {
				name,
				sizeBytes,
				type: itemType,
				savedAt,
				mediaDurationSec,
				meta: null,
			};
			r.finalItems.push(fi);
		}
	}

	private async runTemplates(context: SaveContext): Promise<void> {
		const settings = readAppSettings();
		const promises: Promise<void>[] = [];

		for (const template of ALL_TEMPLATES) {
			if (!template.canHandle(context)) continue;

			const configs = template.getConfigs(settings.storage);
			if (!configs.length) continue;

			for (const config of configs) {
				promises.push(
					(async () => {
						try {
							(template as any)._config = config;
							const transformed = template.transform(context.record);
							await template.write(transformed, context, config);
						} catch (error) {
							const err = error instanceof Error ? error : new Error(String(error));
							this.templateErrors.push({
								templateId: template.id,
								templateLabel: template.label,
								event: context.event,
								error: err,
								timestamp: new Date().toISOString(),
							});
							console.warn(`[dbExporter] Template "${template.label}" error:`, err.message);
						}
					})()
				);
			}
		}

		await Promise.allSettled(promises);
	}

	private dump(record: ItemRecord) {
		try {
			fs.appendFileSync(this.logFile, JSON.stringify(record) + '\n', 'utf-8');
		} catch (e) {
			console.warn('[dbExporter] failed to append jsonl:', e);
		}
		console.log('[dbExporter]', record.status, record.itemId, record.originalItem.name, `$${record.totalCost.toFixed(3)}`);
	}
}

let instance: DbExporter | null = null;
export function getDbExporter(): DbExporter {
	if (!instance) instance = new DbExporter();
	return instance;
}
