import path from 'path';
import { sendToMW } from '../_template/pluginSender';
import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { getFileTypeByExt } from '../../electron/main/utilits/getFileTypeByExt';

export { onLoad } from '../_template/pluginSender';

// ── Filename helpers ──────────────────────────────────────────────────────────

const removeEmoji = (str: string): string =>
	str.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s{2,}/g, ' ').trim();

const textInSquare = (str: string): string =>
	(str.match(/\[([^\]]*)\]/g) ?? []).map((m) => m.slice(1, -1).trim()).filter(Boolean).join(' ');

const textInRound = (str: string): string =>
	(str.match(/\(([^)]*)\)/g) ?? []).map((m) => m.slice(1, -1).trim()).filter(Boolean).join(' ');

const withoutRound = (str: string): string =>
	str.replace(/\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim();

const withoutSquare = (str: string): string =>
	str.replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();

const withoutBoth = (str: string): string =>
	str.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();

// ── Frame format ──────────────────────────────────────────────────────────────

const frameFormat = (w: number, h: number): string => {
	if (w > h) return 'horizontal';
	if (h > w) return 'vertical';
	return 'square';
};

// ── Main function ─────────────────────────────────────────────────────────────

export async function fileInfoFunc(_item: any, _description: any) {
	sendToMW('statusbar', `${_description.infoText}: [File Info]\n`);

	const extractType: string = _item.getInfo ?? 'frameFormat';
	const inputValues: string[] = _item.import?.inputFile ?? [];

	if (inputValues.length === 0) return '';

	const input = inputValues[0];

	// Определяем тип входящего значения
	const ext = path.extname(input);
	const isPlainString = ext === '' && !input.includes('/') && !input.includes('\\');
	const fileType = isPlainString ? 'string' : getFileTypeByExt(input, _description.typeOfFile);

	// Базовое имя для операций с текстом: для файлов — имя без расширения, для строк — сама строка
	const baseName = isPlainString ? input : path.basename(input, ext);
	const cleanName = removeEmoji(baseName);

	let result = '';

	switch (extractType) {
		// ── Имя файла / текст ────────────────────────────────────────────────
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

		// ── Видео + картинка ─────────────────────────────────────────────────
		case 'frameFormat':
		case 'width':
		case 'height': {
			if (!['video', 'image'].includes(fileType)) return '';
			const info = await getFullInfoFromVideoFile(input, _description);
			if (extractType === 'frameFormat') result = frameFormat(info.width, info.height);
			else if (extractType === 'width') result = String(info.width);
			else result = String(info.height);
			break;
		}

		// ── Только видео ─────────────────────────────────────────────────────
		case 'duration In Seconds':
		case 'duration in Timecode':
		case 'frame Rate': {
			if (fileType !== 'video') return '';
			const info = await getFullInfoFromVideoFile(input, _description);
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
