// convertFile_v2 — универсальная нода конвертации файлов. Tauri-port: ffmpeg
// вызывается через @plugin-api/tauri helper (ffmpeg.run), вместо
// spawnFFmpegCommand из Electron.

import path from 'path';
import { fs, ffmpeg, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
import { getFileTypeByExt } from '../../src/Utils/getFileTypeByExt';
import {
	ConvertSettings,
	buildVideoFilterString,
	buildImageFilterString,
	buildAudioFilterString,
	defaultConvertSettings,
} from '../../src/NODE_WIN/nodes/properties/ConvertEdit/types';

export { onLoad } from '../_template/tauri';

// ── Codec name mappings ──────────────────────────────────────────────────────

const VIDEO_CODEC_MAP: Record<string, string> = {
	h264: 'libx264',
	h265: 'libx265',
	vp9: 'libvpx-vp9',
	av1: 'libsvtav1',
	prores: 'prores_ks',
	dnxhd: 'dnxhd',
	hap: 'hap',
	hap_q: 'hap',
	copy: 'copy',
};

const AUDIO_CODEC_MAP: Record<string, string> = {
	aac: 'aac',
	mp3: 'libmp3lame',
	opus: 'libopus',
	flac: 'flac',
	pcm_s16le: 'pcm_s16le',
	copy: 'copy',
};

const PRESET_CODECS = new Set(['h264', 'h265', 'av1']);
const CRF_CODECS = new Set(['h264', 'h265', 'vp9', 'av1']);
const BITRATE_CODECS = new Set(['aac', 'mp3', 'opus']);

// ── Core ffmpeg arg builder ──────────────────────────────────────────────────

function buildConvertFFmpegArgs(settings: ConvertSettings, outputMode: 'image' | 'audio' | 'video'): string[] {
	const ext = settings.outputExtension.toLowerCase();
	const args: string[] = [];

	if (outputMode === 'image') {
		const vf = buildImageFilterString(settings.image);
		if (vf) args.push('-vf', vf);

		const q = settings.image.quality;
		if (ext === 'jpg' || ext === 'jpeg') {
			const qv = Math.max(2, Math.round(31 - (q / 100) * 29));
			args.push('-q:v', String(qv));
		} else if (ext === 'webp') {
			args.push('-q:v', String(q));
		} else if (ext === 'png') {
			const cl = Math.round(9 - (q / 100) * 9);
			args.push('-compression_level', String(cl));
		}
		args.push('-frames:v', '1');
	} else if (outputMode === 'audio') {
		const af = buildAudioFilterString(settings.audio);
		if (af) args.push('-af', af);

		if (settings.audio.enabled) {
			const codec = settings.audio.codec;
			args.push('-c:a', AUDIO_CODEC_MAP[codec] ?? codec);
			if (BITRATE_CODECS.has(codec)) args.push('-b:a', settings.audio.bitrate);
			if (codec !== 'copy') {
				args.push('-ar', String(settings.audio.sampleRate));
				args.push('-ac', String(settings.audio.channels));
			}
		}
		args.push('-vn');
	} else {
		if (settings.video.enabled) {
			const vf = buildVideoFilterString(settings.video);
			if (vf) args.push('-vf', vf);
			const codec = settings.video.codec;
			args.push('-c:v', VIDEO_CODEC_MAP[codec] ?? codec);
			if (codec === 'hap_q') args.push('-format', 'hap_q');
			if (PRESET_CODECS.has(codec)) args.push('-preset', settings.video.preset);
			if (CRF_CODECS.has(codec)) args.push('-crf', String(settings.video.crf));
			if (codec === 'prores' && settings.video.alpha) args.push('-profile:v', '4444');
			if (codec === 'hap' && settings.video.alpha) args.push('-format', 'hap_alpha');
			if (settings.video.pixFmt) args.push('-pix_fmt', settings.video.pixFmt);
		} else {
			args.push('-vn');
		}

		if (settings.audio.enabled) {
			const af = buildAudioFilterString(settings.audio);
			if (af) args.push('-af', af);
			const codec = settings.audio.codec;
			args.push('-c:a', AUDIO_CODEC_MAP[codec] ?? codec);
			if (BITRATE_CODECS.has(codec)) args.push('-b:a', settings.audio.bitrate);
			if (codec !== 'copy') {
				args.push('-ar', String(settings.audio.sampleRate));
				args.push('-ac', String(settings.audio.channels));
			}
		} else {
			args.push('-an');
		}
	}

	return args;
}

// ── Plugin entry point ───────────────────────────────────────────────────────

export async function convertFileV2Func(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	// Parse ConvertSettings — fall back to defaults for empty / invalid JSON
	let settings: ConvertSettings;
	try {
		settings = _item.convertSettings ? (JSON.parse(_item.convertSettings) as ConvertSettings) : defaultConvertSettings();
	} catch {
		settings = defaultConvertSettings();
	}

	const ext = settings.outputExtension.toLowerCase();
	const fileType = getFileTypeByExt('file.' + ext, _description.typeOfFile as Record<string, string[]>);
	const outputMode: 'image' | 'audio' | 'video' = fileType === 'image' ? 'image' : fileType === 'audio' ? 'audio' : 'video';

	const inputs: string[] = _item.import.convertSettings as string[];
	let iteration = 1;

	for (const fileFrom of inputs) {
		// Build output path (copy the array to avoid mutating _item.targetPath)
		let curPath: string[] = _item.targetPath.length === 0 ? ['$clearName ($random(3))'] : [..._item.targetPath];

		if (_item.import.targetPath?.length) {
			curPath.unshift(..._item.import.targetPath);
		} else {
			curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
		}

		const newPath = createPathForFileByPattern(curPath, _description, fileFrom);
		const dirTo = path.dirname(newPath);
		const originalName = path.basename(fileFrom);
		const newName = path.basename(newPath, path.extname(newPath)) + '.' + ext;
		const fileTo = path.join(dirTo, newName);

		await fs.mkdir(dirTo);

		const info = await ffmpeg.getInfo(fileFrom);
		const curDuration = info.durationInSeconds ?? 0;

		// Resolve frame.mode='original' → fixed with source dimensions, so filters
		// that reference Frame W/H work consistently.
		const effSettings: ConvertSettings =
			outputMode === 'video' && settings.video.frame.mode === 'original' && info.width && info.height
				? {
						...settings,
						video: {
							...settings.video,
							frame: { ...settings.video.frame, mode: 'fixed', width: info.width, height: info.height },
						},
					}
				: settings;

		const ffmpegArgs = buildConvertFFmpegArgs(effSettings, outputMode);

		await ffmpeg.run({
			text: `${_description.infoText}: [convert ${iteration}/${inputs.length}]\n ${originalName} → ${newName}`,
			duration: curDuration,
			nodeId: _item.id,
			command: ['-y', '-i', fileFrom, ...ffmpegArgs, fileTo],
		});

		finalFile.push(fileTo);
		iteration++;
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
