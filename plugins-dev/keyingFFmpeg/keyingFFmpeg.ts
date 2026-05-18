// plugins-dev/keyingFFmpeg/keyingFFmpeg.ts

import path from 'path';
import { getFileTypeByExt } from '../../electron/main/utilits/getFileTypeByExt';
import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { spawnFFmpegCommand } from '../../electron/main/processing/ffmpeg/spawnFFmpegCommand';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';

export { onLoad } from '../_template/pluginSender';

// ── Типы KeyingSettings (дублируем здесь, чтобы не тащить renderer-код в main) ─

interface ChromakeySettings {
	enabled: boolean;
	color: string;
	similarity: number;
	blend: number;
	yuv: boolean;
}
interface ColorkeySettings {
	enabled: boolean;
	color: string;
	similarity: number;
	blend: number;
}
interface LumakeySettings {
	enabled: boolean;
	threshold: number;
	tolerance: number;
	softness: number;
}
interface DespillSettings {
	enabled: boolean;
	color: string;
	mix: number;
	expand: number;
	brightness: number;
}
interface EdgeSettings {
	erosion: number;
	dilation: number;
	blur: number;
}

interface KeyingSettings {
	chromakey: ChromakeySettings;
	colorkey: ColorkeySettings;
	lumakey: LumakeySettings;
	despill: DespillSettings;
	edge: EdgeSettings;
}

// ── Вспомогательные ───────────────────────────────────────────────────────────

function isImageFile(filePath: string, typeOfFile: Record<string, string[]>): boolean {
	return getFileTypeByExt(filePath, typeOfFile) === 'image';
}

function despillTypeFromColor(hex: string): number {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return b > g && b > r ? 1 : 0;
}

function rgbHexToYuvHex(hex: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
	const y = clamp(0.299 * r + 0.587 * g + 0.114 * b);
	const cb = clamp(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
	const cr = clamp(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
	return `0x${y.toString(16).padStart(2, '0')}${cb.toString(16).padStart(2, '0')}${cr.toString(16).padStart(2, '0')}`;
}

/**
 * Строит строку ffmpeg -vf из настроек кеинга.
 * Всегда заканчивается format=rgba чтобы гарантировать альфа-канал на выходе.
 */
function buildKeyingFilterString(s: KeyingSettings): string {
	const filters: string[] = [];

	if (s.chromakey.enabled) {
		const hex = s.chromakey.yuv ? rgbHexToYuvHex(s.chromakey.color) : s.chromakey.color.replace('#', '0x');
		let f = `chromakey=${hex}:${s.chromakey.similarity}:${s.chromakey.blend}`;
		if (s.chromakey.yuv) f += ':yuv=1';
		filters.push(f);
	}

	if (s.colorkey.enabled) {
		const hex = s.colorkey.color.replace('#', '0x');
		filters.push(`colorkey=${hex}:${s.colorkey.similarity}:${s.colorkey.blend}`);
	}

	if (s.lumakey.enabled) {
		filters.push(`lumakey=threshold=${s.lumakey.threshold}:tolerance=${s.lumakey.tolerance}:softness=${s.lumakey.softness}`);
	}

	if (s.despill.enabled) {
		const t = despillTypeFromColor(s.despill.color);
		const parts = [`type=${t}`, `mix=${s.despill.mix}`];
		if (s.despill.expand > 0) parts.push(`expand=${s.despill.expand}`);
		if (s.despill.brightness > 0) parts.push(`brightness=${s.despill.brightness}`);
		filters.push(`despill=${parts.join(':')}`);
	}

	if (s.edge.erosion > 0) {
		const v = s.edge.erosion;
		filters.push(`erosion=${v}:${v}:${v}:${v}`);
	}
	if (s.edge.dilation > 0) {
		const v = s.edge.dilation;
		filters.push(`dilation=${v}:${v}:${v}:${v}`);
	}

	// Размытие только альфа-канала: split → alphaextract → boxblur → alphamerge
	if (s.edge.blur > 0) {
		const b = s.edge.blur;
		filters.push('format=rgba');
		filters.push('split[rgb][a]');
		filters.push(`[a]alphaextract,boxblur=${b}:${b}[blurA]`);
		filters.push('[rgb][blurA]alphamerge');
	}

	// Гарантируем RGBA на выходе (нужно для PNG и Hap Q)
	filters.push('format=rgba');

	return filters.join(',');
}

// ── Обработка одного файла ────────────────────────────────────────────────────

async function processFile(
	fileFrom: string,
	fileTo: string,
	settings: KeyingSettings,
	index: number,
	total: number,
	_description: any,
): Promise<string> {
	const label = `${_description.infoText}: [keying ${index}/${total}]`;
	const baseName = path.basename(fileFrom);

	sendToMW('statusbar', { text: `${label}\n${baseName}` });

	const filterString = buildKeyingFilterString(settings);
	const isImage = isImageFile(fileFrom, _description.typeOfFile);

	testAndCreateFolder(path.dirname(fileTo));

	if (isImage) {
		// ── Картинка → PNG с альфа-каналом ───────────────────────────────────────

		const ffmpegArgs: string[] = [
			'-y',
			'-i',
			fileFrom,
			'-vf',
			filterString,
			'-frames:v',
			'1', // один кадр — для случая если это анимированный gif и т.п.
			fileTo,
		];

		await spawnFFmpegCommand({ text: label, duration: 1, command: ffmpegArgs }, _description, sendToMW);
	} else {
		// ── Видео → MOV / Hap Q ───────────────────────────────────────────────────

		const info = await getFullInfoFromVideoFile(fileFrom, _description);

		// Аудио: если есть дорожка — копируем, иначе -an
		const audioArgs: string[] = info.hasAudio ? ['-c:a', 'copy'] : ['-an'];

		const ffmpegArgs: string[] = [
			'-y',
			'-i',
			fileFrom,
			'-vf',
			filterString,
			'-c:v',
			'hap',
			'-format',
			'hap_q',
			'-compressor',
			'snappy', // lossless-сжатие, баланс размер/скорость чтения
			...audioArgs,
			fileTo,
		];

		await spawnFFmpegCommand({ text: label, duration: info.durationInSeconds || 10, command: ffmpegArgs }, _description, sendToMW);
	}

	return fileTo;
}

// ── Точка входа плагина ───────────────────────────────────────────────────────

export async function keyingFFmpegFunc(_item: any, _description: any) {
	const finalFiles: string[] = [];

	// ── 1. Парсим настройки кеинга ─────────────────────────────────────────────

	if (!_item.keyingFFmpeg) {
		sendToMW('statusbar', { text: `${_description.infoText}: [keying] ERROR: keying settings not configured` });
		return finalFiles;
	}

	let settings: KeyingSettings;
	try {
		settings = JSON.parse(_item.keyingFFmpeg) as KeyingSettings;
	} catch {
		sendToMW('statusbar', { text: `${_description.infoText}: [keying] ERROR: failed to parse keying settings` });
		return finalFiles;
	}

	// ── 2. Входные файлы ───────────────────────────────────────────────────────
	const inputFiles: string[] = (_item.import?.keyingFFmpeg ?? []).filter(Boolean);

	if (inputFiles.length === 0) {
		sendToMW('statusbar', { text: `${_description.infoText}: [keying] no input files, skipping` });
		return finalFiles;
	}

	// ── 3. Итерируем файлы ────────────────────────────────────────────────────

	for (let i = 0; i < inputFiles.length; i++) {
		const fileFrom = inputFiles[i];

		// Путь назначения
		let curPath: string[] = _item.targetPath?.length === 0 ? ['$clearName ($random(3))'] : [...(_item.targetPath ?? [])];

		if (_item.import?.targetPath) {
			curPath.unshift(..._item.import.targetPath);
		} else {
			curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
		}

		const basePath = createPathForFileByPattern(curPath, _description, fileFrom);
		const ext = isImageFile(fileFrom, _description.typeOfFile) ? '.png' : '.mov';
		const fileTo = path.join(path.dirname(basePath), path.basename(basePath, path.extname(basePath)) + ext);

		const result = await processFile(fileFrom, fileTo, settings, i + 1, inputFiles.length, _description);
		finalFiles.push(result);
	}
	sendToMW('log', { level: 'info', text: `Result:\n${finalFiles}` });
	return finalFiles;
}
