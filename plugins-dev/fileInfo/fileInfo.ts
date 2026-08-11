// fileInfo — извлекает информацию о медиафайле (size, duration, fps) или текст
// из имени файла (содержимое скобок). Tauri-port: ffprobe вызывается через
// Rust-команду ffprobe_get_info из @plugin-api/tauri helper.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { getFileTypeByExt } from '../../src/Utils/getFileTypeByExt';
import { convertSecondsToTimecode } from '../../src/Utils/convertSecondsToTimecode';

// host-сервисы приходят в ctx (третий аргумент точки входа) и протаскиваются
// параметром в хелперы — у модуля не остаётся состояния, загрузчик его кэширует.

// ── Filename helpers ─────────────────────────────────────────────────────────

const removeEmoji = (str: string): string =>
	str
		.replace(/\p{Extended_Pictographic}/gu, '')
		.replace(/\s{2,}/g, ' ')
		.trim();

const textInSquare = (str: string): string =>
	(str.match(/\[([^\]]*)\]/g) ?? [])
		.map((m) => m.slice(1, -1).trim())
		.filter(Boolean)
		.join(' ');

const textInRound = (str: string): string =>
	(str.match(/\(([^)]*)\)/g) ?? [])
		.map((m) => m.slice(1, -1).trim())
		.filter(Boolean)
		.join(' ');

const withoutRound = (str: string): string =>
	str
		.replace(/\([^)]*\)/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim();

const withoutSquare = (str: string): string =>
	str
		.replace(/\[[^\]]*\]/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim();

const withoutBoth = (str: string): string =>
	str
		.replace(/\([^)]*\)/g, '')
		.replace(/\[[^\]]*\]/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim();

const frameFormat = (w: number, h: number): string => (w > h ? 'horizontal' : h > w ? 'vertical' : 'square');

// ── ffprobe → video info ─────────────────────────────────────────────────────

interface VideoInfo {
	width: number;
	height: number;
	durationInSeconds: number;
	durationInTimcode: string;
	fps: number;
}

/**
 * Раньше здесь лежала своя копия разбора ffprobe — вместе с двумя дефектами,
 * которые уже исправлены в `host.ts`: деление на ноль при `time_base: "0/0"`
 * (давало NaN в длительности) и `fps.toFixed` без проверки на конечность.
 *
 * Теперь считает `ffmpeg.getInfo`, а локальным остался только таймкод: host-версия
 * при неизвестном fps честно отдаёт миллисекунды, а здесь исторически всегда кадры
 * по `fps || 25`. Это поле видно пользователю, поэтому формат не меняем.
 */
async function getVideoInfo(filePath: string, ffmpeg: PluginContext['ffmpeg']): Promise<VideoInfo> {
	const info = await ffmpeg.getInfo(filePath);
	return {
		width: info.width,
		height: info.height,
		fps: info.fps,
		durationInSeconds: info.durationInSeconds,
		durationInTimcode: convertSecondsToTimecode(info.durationInSeconds, info.fps || 25),
	};
}

// ── Main function ────────────────────────────────────────────────────────────

export async function fileInfoFunc(_item: any, _description: any, ctx: PluginContext): Promise<string> {
	const { ffmpeg, sendToMW } = ctx;
	sendToMW('statusbar', { text: `${_description.infoText ?? ''}: [File Info]` });

	const extractType: string = _item.getInfo ?? 'frameFormat';
	const inputValues: string[] = _item.import?.inputFile ?? [];
	if (inputValues.length === 0) return '';

	const input = inputValues[0];
	const ext = path.extname(input);
	const isPlainString = ext === '' && !input.includes('/') && !input.includes('\\');
	const fileType = isPlainString ? 'string' : getFileTypeByExt(input, _description.typeOfFile);

	const baseName = isPlainString ? input : path.basename(input, ext);
	const cleanName = removeEmoji(baseName);

	let result = '';

	switch (extractType) {
		case 'text in []':
			result = textInSquare(cleanName);
			break;
		case 'text in ()':
			result = textInRound(cleanName);
			break;
		case 'text without ()':
			result = withoutRound(cleanName);
			break;
		case 'text without []':
			result = withoutSquare(cleanName);
			break;
		case 'text without ()[]':
			result = withoutBoth(cleanName);
			break;

		case 'frameFormat':
		case 'width':
		case 'height': {
			if (!['video', 'image'].includes(fileType)) return '';
			const info = await getVideoInfo(input, ffmpeg);
			if (extractType === 'frameFormat') result = frameFormat(info.width, info.height);
			else if (extractType === 'width') result = String(info.width);
			else result = String(info.height);
			break;
		}

		case 'duration In Seconds':
		case 'duration in Timecode':
		case 'frame Rate': {
			if (fileType !== 'video') return '';
			const info = await getVideoInfo(input, ffmpeg);
			if (extractType === 'duration In Seconds') result = String(info.durationInSeconds);
			else if (extractType === 'duration in Timecode') result = info.durationInTimcode;
			else result = String(info.fps);
			break;
		}

		default:
			return '';
	}

	sendToMW('log', { level: 'info', text: `fileInfo [${extractType}] → "${result}"` });
	return result;
}
