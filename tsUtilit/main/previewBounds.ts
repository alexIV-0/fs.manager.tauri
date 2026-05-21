import { appStore } from './appStore';

export type PreviewBounds = { width: number; height: number; x?: number; y?: number };
export type PreviewBoundsMap = Record<string, PreviewBounds>;

const PREVIEW_BOUNDS_KEY = 'previewWinBounds';
const DEFAULT_PREVIEW_BOUNDS: PreviewBounds = { width: 800, height: 600 };

// Текущий тип файла, открытого в preview-окне (нормализованный ключ для словаря бунд).
let currentType: string = 'default';

// Если true — preview:resize не должен менять размер/центрировать окно
// (бунды восстановлены из сохранённых либо файл переключен внутри открытого окна).
let boundsLocked = false;

export function normalizePreviewType(t: unknown): string {
	if (typeof t !== 'string' || !t.trim()) return 'default';
	return t.trim().toLowerCase();
}

export function readPreviewBoundsMap(): PreviewBoundsMap {
	const raw = appStore.get(PREVIEW_BOUNDS_KEY, {} as PreviewBoundsMap) as PreviewBoundsMap;
	return raw && typeof raw === 'object' ? raw : {};
}

export function getCurrentPreviewType(): string {
	return currentType;
}

export function setCurrentPreviewType(type: string): void {
	currentType = type;
}

export function getPreviewBoundsForType(type: string): { bounds: PreviewBounds; hasSaved: boolean } {
	const map = readPreviewBoundsMap();
	const saved = map[type];
	if (saved) return { bounds: saved, hasSaved: true };
	if (map.default) return { bounds: map.default, hasSaved: false };
	return { bounds: DEFAULT_PREVIEW_BOUNDS, hasSaved: false };
}

export function savePreviewBounds(type: string, bounds: PreviewBounds): void {
	const map = readPreviewBoundsMap();
	map[type] = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
	appStore.set(PREVIEW_BOUNDS_KEY, map);
}

export function isPreviewBoundsLocked(): boolean {
	return boundsLocked;
}

export function setPreviewBoundsLocked(value: boolean): void {
	boundsLocked = value;
}

// Должен ли следующий preview:resize отцентрировать окно.
// true — при первом создании окна без сохранённых бунд (изначальное появление).
// false — при переключении файла внутри открытого окна (положение сохраняем).
let shouldCenterOnNextResize = false;

export function setShouldCenterOnNextResize(value: boolean): void {
	shouldCenterOnNextResize = value;
}

export function consumeShouldCenter(): boolean {
	const v = shouldCenterOnNextResize;
	shouldCenterOnNextResize = false;
	return v;
}
