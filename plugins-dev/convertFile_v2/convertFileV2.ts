// plugins-dev/convertFile_v2/convertFileV2.ts
//
// Universal file conversion plugin — builds a full ffmpeg command from
// ConvertSettings (video frame, codec, filters, audio, image quality, etc.)

import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { spawnFFmpegCommand } from '../../electron/main/processing/ffmpeg/spawnFFmpegCommand';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { getFileTypeByExt } from '../../electron/main/utilits/getFileTypeByExt';
import { sendToMW } from '../_template/pluginSender';
import {
	ConvertSettings,
	buildVideoFilterString,
	buildImageFilterString,
	buildAudioFilterString,
	defaultConvertSettings,
} from '../../src/NODE_WIN/nodes/properties/ConvertEdit/types';
import path from 'path';

export { onLoad } from '../_template/pluginSender';

// ── Codec name mappings ──────────────────────────────────────────────────────

const VIDEO_CODEC_MAP: Record<string, string> = {
	h264: 'libx264',
	h265: 'libx265',
	vp9: 'libvpx-vp9',
	av1: 'libsvtav1',
	prores: 'prores_ks',
	dnxhd: 'dnxhd',
	hap: 'hap',
	hap_q: 'hap', // format flag added separately
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

// Codecs that accept -preset / -crf / -b:a
const PRESET_CODECS = new Set(['h264', 'h265', 'av1']);
const CRF_CODECS = new Set(['h264', 'h265', 'vp9', 'av1']);
const BITRATE_CODECS = new Set(['aac', 'mp3', 'opus']);

// ── Core ffmpeg arg builder ──────────────────────────────────────────────────

/**
 * Converts a ConvertSettings object into an ffmpeg argument array.
 * Does NOT include `-y`, `-i <input>`, or the output path — those are added
 * by the caller so they appear in the correct position.
 */
function buildConvertFFmpegArgs(settings: ConvertSettings, outputMode: 'image' | 'audio' | 'video'): string[] {
	const ext = settings.outputExtension.toLowerCase();
	const mode = outputMode;
	const args: string[] = [];

	// ── Image ──────────────────────────────────────────────────────────────
	if (mode === 'image') {
		const vf = buildImageFilterString(settings.image);
		if (vf) args.push('-vf', vf);

		const q = settings.image.quality; // 0–100

		if (ext === 'jpg' || ext === 'jpeg') {
			// q:v 2 = best quality, 31 = worst  →  invert the 0–100 scale
			const qv = Math.max(2, Math.round(31 - (q / 100) * 29));
			args.push('-q:v', String(qv));
		} else if (ext === 'webp') {
			// libwebp q:v 0–100 where 100 = best
			args.push('-q:v', String(q));
		} else if (ext === 'png') {
			// PNG compression level 0 (none/fastest) → 9 (max)
			// Higher quality setting = less compression (prefer speed/accuracy over size)
			const cl = Math.round(9 - (q / 100) * 9);
			args.push('-compression_level', String(cl));
		}
		// Ensure only one output frame (avoids -vframes deprecation)
		args.push('-frames:v', '1');

		// ── Audio-only ─────────────────────────────────────────────────────────
	} else if (mode === 'audio') {
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
		args.push('-vn'); // strip video stream

		// ── Video (+ audio) ────────────────────────────────────────────────────
	} else {
		// Video track
		if (settings.video.enabled) {
			const vf = buildVideoFilterString(settings.video);
			if (vf) args.push('-vf', vf);

			const codec = settings.video.codec;
			args.push('-c:v', VIDEO_CODEC_MAP[codec] ?? codec);

			// HAP Q requires a -format flag (HAP family uses the same encoder)
			if (codec === 'hap_q') args.push('-format', 'hap_q');

			if (PRESET_CODECS.has(codec)) args.push('-preset', settings.video.preset);
			if (CRF_CODECS.has(codec)) args.push('-crf', String(settings.video.crf));
		} else {
			args.push('-vn');
		}

		// Audio track
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

export async function convertFileV2Func(_item: any, _description: any) {
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
	let iteration = 1;

	for (const fileFrom of _item.import.convertSettings as string[]) {
		// Build output path (copy the array to avoid mutating _item.targetPath)
		let curPath: string[] = _item.targetPath.length === 0 ? ['$clearName ($random(3))'] : [..._item.targetPath];

		if (_item.import.targetPath) {
			curPath.unshift(..._item.import.targetPath);
		} else {
			curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
		}

		const newPath = createPathForFileByPattern(curPath, _description, fileFrom);
		const dirTo = path.dirname(newPath);
		const originalName = path.basename(fileFrom);
		const newName = path.basename(newPath, path.extname(newPath)) + '.' + ext;
		const fileTo = path.join(dirTo, newName);

		testAndCreateFolder(dirTo);

		const info = await getFullInfoFromVideoFile(fileFrom, _description);
		const curDuration = info.durationInSeconds ?? 0;

		// Resolve frame.mode='original' → fixed with the source file's actual dimensions, so
		// all filters that reference Frame W/H (Position, cover-fill, etc.) work consistently.
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

		const command = {
			text: `${_description.infoText}: [convert ${iteration}/${(_item.import.convertSettings as string[]).length}]\n ${originalName} → ${newName}`,
			duration: curDuration,
			// ffmpeg -y -i <input> [codec/filter args] <output>
			// command: ['-y', '-i', `"${fileFrom}"`, ...ffmpegArgs, `"${fileTo}"`],
			command: ['-y', '-i', fileFrom, ...ffmpegArgs, fileTo],
		};

		// sendToMW('log', {
		// 	text: `[convertFileV2] cmd: ffmpeg ${command.command.join(' ')}`,
		// });

		await spawnFFmpegCommand(command, _description, sendToMW);

		finalFile.push(fileTo);
		iteration++;
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}
