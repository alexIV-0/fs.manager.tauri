// keyingFFmpeg — кеинг (chromakey/colorkey/lumakey/despill) через ffmpeg.
// Tauri-port: spawnFFmpegCommand → ffmpeg.run, getFullInfoFromVideoFile → ffmpeg.getInfo.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { getFileTypeByExt } from '../../src/Utils/getFileTypeByExt';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';


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
	if (s.edge.blur > 0) {
		const b = s.edge.blur;
		filters.push('format=rgba');
		filters.push('split[rgb][a]');
		filters.push(`[a]alphaextract,boxblur=${b}:${b}[blurA]`);
		filters.push('[rgb][blurA]alphamerge');
	}
	filters.push('format=rgba');
	return filters.join(',');
}

async function processFile(
	fileFrom: string,
	fileTo: string,
	settings: KeyingSettings,
	index: number,
	total: number,
	_description: any,
	// ctx перед необязательным nodeId: host-сервисы приходят из него, поэтому у
	// модуля не остаётся состояния и загрузчик его кэширует.
	ctx: PluginContext,
	nodeId?: string,
): Promise<string> {
	const { fs, ffmpeg, sendToMW } = ctx;
	const label = `${_description.infoText}: [keying ${index}/${total}]`;
	sendToMW('statusbar', { text: `${label}\n${path.basename(fileFrom)}` });

	const filterString = buildKeyingFilterString(settings);
	const isImage = isImageFile(fileFrom, _description.typeOfFile);

	await fs.mkdir(path.dirname(fileTo));

	if (isImage) {
		await ffmpeg.run({
			text: label,
			duration: 1,
			nodeId,
			command: ['-y', '-i', fileFrom, '-vf', filterString, '-frames:v', '1', fileTo],
		});
	} else {
		const info = await ffmpeg.getInfo(fileFrom);
		const audioArgs = info.hasAudio ? ['-c:a', 'copy'] : ['-an'];
		await ffmpeg.run({
			text: label,
			duration: info.durationInSeconds || 10,
			nodeId,
			command: ['-y', '-i', fileFrom, '-vf', filterString, '-c:v', 'hap', '-format', 'hap_q', '-compressor', 'snappy', ...audioArgs, fileTo],
		});
	}
	return fileTo;
}

export async function keyingFFmpegFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { sendToMW } = ctx;
	const finalFiles: string[] = [];

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

	const inputFiles: string[] = (_item.import?.keyingFFmpeg ?? []).filter(Boolean);
	if (inputFiles.length === 0) {
		sendToMW('statusbar', { text: `${_description.infoText}: [keying] no input files, skipping` });
		return finalFiles;
	}

	for (let i = 0; i < inputFiles.length; i++) {
		const fileFrom = inputFiles[i];

		let curPath: string[] = _item.targetPath?.length === 0 ? ['$clearName ($random(3))'] : [...(_item.targetPath ?? [])];
		if (_item.import?.targetPath?.length) {
			curPath.unshift(..._item.import.targetPath);
		} else {
			curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
		}

		const basePath = createPathForFileByPattern(curPath, _description, fileFrom);
		const ext = isImageFile(fileFrom, _description.typeOfFile) ? '.png' : '.mov';
		const fileTo = path.join(path.dirname(basePath), path.basename(basePath, path.extname(basePath)) + ext);

		const result = await processFile(fileFrom, fileTo, settings, i + 1, inputFiles.length, _description, ctx, _item.id);
		finalFiles.push(result);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFiles.join('\n')}` });
	return finalFiles;
}
