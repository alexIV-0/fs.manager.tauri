/**
 * Подготовка картинки к вставке в описание.
 *
 * Картинки лежат ВНУТРИ файла описания как `data:`-URI (контракт §4) — иначе их
 * нечем доставить на сайт: описание едет одним сайдкаром, а подпапку внутри
 * `options/` бэкенд не даёт создать (403 на mkdir). Отсюда обязательное
 * уменьшение: без него sidecar с `ifMatch` начнёт возить мегабайты на каждое
 * сохранение, а base64 добавляет к весу ещё около трети.
 */

import { IMAGE_MAX_SIDE, IMAGE_QUALITY } from './markdownFormat';

export interface PreparedImage {
	/** `data:image/…;base64,…` — то, что уйдёт в файл. */
	dataUrl: string;
	/** Вес получившегося data-URI в байтах (для предупреждения о размере). */
	bytes: number;
	width: number;
	height: number;
}

function readAsDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const fr = new FileReader();
		fr.onload = () => resolve(String(fr.result));
		fr.onerror = () => reject(new Error('Не удалось прочитать файл картинки'));
		fr.readAsDataURL(blob);
	});
}

async function decode(blob: Blob): Promise<{ width: number; height: number; draw: CanvasImageSource }> {
	if (typeof createImageBitmap === 'function') {
		try {
			const bmp = await createImageBitmap(blob);
			return { width: bmp.width, height: bmp.height, draw: bmp };
		} catch {
			// упадём в обычный <img> ниже
		}
	}
	const url = URL.createObjectURL(blob);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(new Error('Не удалось декодировать картинку'));
			el.src = url;
		});
		return { width: img.naturalWidth, height: img.naturalHeight, draw: img };
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Из base64-строки в байты — без выделения самого буфера. */
const base64Bytes = (dataUrl: string): number => {
	const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
	const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
	return Math.floor((b64.length * 3) / 4) - padding;
};

export async function prepareImage(blob: Blob): Promise<PreparedImage> {
	// GIF не пересжимаем: canvas отдаст один кадр, анимация умрёт молча.
	if (blob.type === 'image/gif') {
		const dataUrl = await readAsDataUrl(blob);
		const { width, height } = await decode(blob).catch(() => ({ width: 0, height: 0, draw: null as never }));
		return { dataUrl, bytes: base64Bytes(dataUrl), width, height };
	}

	const { width, height, draw } = await decode(blob);
	const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(width, height));
	const w = Math.max(1, Math.round(width * scale));
	const h = Math.max(1, Math.round(height * scale));

	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas недоступен');
	ctx.drawImage(draw, 0, 0, w, h);

	// webp даёт лучший вес, но в старом WKWebView его может не быть: тогда
	// toDataURL молча возвращает png, и это надо заметить, а не «сжать в png».
	let dataUrl = canvas.toDataURL('image/webp', IMAGE_QUALITY);
	if (!dataUrl.startsWith('data:image/webp')) {
		dataUrl = blob.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.82);
	}

	return { dataUrl, bytes: base64Bytes(dataUrl), width: w, height: h };
}

/** Достать картинку из события вставки или перетаскивания. */
export function imageFromTransfer(dt: DataTransfer | null): File | null {
	if (!dt) return null;
	const files = Array.from(dt.files ?? []);
	const file = files.find((f) => f.type.startsWith('image/'));
	if (file) return file;
	const item = Array.from(dt.items ?? []).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
	return item ? item.getAsFile() : null;
}
