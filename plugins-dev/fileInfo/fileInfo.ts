// fileInfo — извлекает информацию о медиафайле (size, duration, fps) или текст
// из имени файла (содержимое скобок). Tauri-port: ffprobe вызывается через
// Rust-команду ffprobe_get_info из @plugin-api/tauri helper.

import path from 'path';
import { ffmpeg, sendToMW } from '../_template/tauri';
import { getFileTypeByExt } from '../../src/Utils/getFileTypeByExt';
import { convertSecondsToTimecode } from '../../src/Utils/convertSecondsToTimecode';

export { onLoad } from '../_template/tauri';

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

async function getVideoInfo(filePath: string): Promise<VideoInfo> {
	const streams = await ffmpeg.probe(filePath);
	const video = ffmpeg.pickVideo(streams);
	const audio = ffmpeg.pickAudio(streams);
	if (!video && !audio) throw new Error(`No video/audio streams found in file: ${filePath}`);

	const parseFps = (str?: string): number => {
		if (!str || str === '0/0') return 0;
		const [n, d] = str.split('/').map(Number);
		return d ? n / d : 0;
	};

	let fps = parseFps(video?.avg_frame_rate);
	if (fps === 0) fps = parseFps(video?.r_frame_rate);
	fps = Number(fps.toFixed(3));

	let durationSec = Number(video?.duration);
	if (!durationSec || durationSec === 0) {
		const ts = Number(video?.duration_ts);
		const tbStr = video?.time_base;
		if (ts && tbStr) {
			const [num, den] = tbStr.split('/').map(Number);
			durationSec = ts * (num / den);
		}
	}
	if (!durationSec && audio?.duration) durationSec = Number(audio.duration);

	return {
		width: video?.width || 0,
		height: video?.height || 0,
		fps,
		durationInSeconds: durationSec || 0,
		durationInTimcode: convertSecondsToTimecode(durationSec || 0, fps || 25),
	};
}

// ── Main function ────────────────────────────────────────────────────────────

export async function fileInfoFunc(_item: any, _description: any): Promise<string> {
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
			const info = await getVideoInfo(input);
			if (extractType === 'frameFormat') result = frameFormat(info.width, info.height);
			else if (extractType === 'width') result = String(info.width);
			else result = String(info.height);
			break;
		}

		case 'duration In Seconds':
		case 'duration in Timecode':
		case 'frame Rate': {
			if (fileType !== 'video') return '';
			const info = await getVideoInfo(input);
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
