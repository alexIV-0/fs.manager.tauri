import path from 'path';
import fs from 'fs';
import os from 'os';
import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { spawnFFmpegCommand } from '../../electron/main/processing/ffmpeg/spawnFFmpegCommand';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { sendToMW } from '../_template/pluginSender';

import { TitleSettings } from './types';
import { parseSubtitles, detectFormat } from './parsers';
import { adaptSettingsToVideo } from './settingsAdapter';
import { buildPhrases } from './buildPhrases';
import { buildAssFile } from './buildAss';

export { onLoad } from '../_template/pluginSender';

// ─── Font resolver ────────────────────────────────────────────────────────────

function findFontFile(fontName: string): { fontFile: string; fontName: string } | null {
	const searchDirs: string[] = [];

	if (process.platform === 'darwin') {
		searchDirs.push('/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library/Fonts'));
	} else if (process.platform === 'win32') {
		searchDirs.push('C:\\Windows\\Fonts', path.join(os.homedir(), 'AppData\\Local\\Microsoft\\Windows\\Fonts'));
	} else {
		searchDirs.push('/usr/share/fonts', '/usr/local/share/fonts');
	}

	const normalize = (s: string) => s.toLowerCase().replace(/[-_ ]/g, '');
	const target = normalize(fontName);
	const exts = new Set(['.ttf', '.otf', '.ttc']);

	for (const dir of searchDirs) {
		if (!fs.existsSync(dir)) continue;
		try {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isFile()) continue;
				const ext = path.extname(entry.name).toLowerCase();
				if (!exts.has(ext)) continue;
				const base = normalize(path.basename(entry.name, ext));
				if (base === target) {
					return {
						fontFile: path.join(dir, entry.name),
						fontName: path.basename(entry.name, ext),
					};
				}
			}
		} catch {
			/* skip */
		}
	}

	return null;
}

function isTitleFile(filePath: string): boolean {
	return ['.srt', '.vtt', '.json'].includes(path.extname(filePath).toLowerCase());
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function addTitle(_item: any, _description: any) {
	const finalFile: string[] = [];

	let curPath: string[] = _item.targetPath?.length > 0 ? [..._item.targetPath] : ['$clearName ($random(3))'];

	if (_item.import.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	// Parse titleSettings
	let titleSettings: TitleSettings | null = null;
	try {
		const raw = _item.titleSettings;
		if (raw) titleSettings = typeof raw === 'string' ? JSON.parse(raw) : raw;
	} catch (e) {
		sendToMW('log', { text: `[addTitle] Failed to parse titleSettings: ${e}` });
	}

	if (!titleSettings) {
		sendToMW('log', { text: '[addTitle] No titleSettings found, skipping' });
		return finalFile;
	}

	// Get subtitle file
	const titleFiles: string[] = (_item.import.inputTitle ?? []).filter(isTitleFile);
	if (titleFiles.length === 0) {
		sendToMW('log', { text: '[addTitle] No subtitle file found' });
		return finalFile;
	}

	const titleFilePath = titleFiles[0];
	const titleContent = fs.readFileSync(titleFilePath, 'utf-8');
	const format = detectFormat(titleContent);
	const cues = parseSubtitles(titleContent, format);
	const hasWords = format === 'jsonfull';

	if (cues.length === 0) {
		sendToMW('log', { text: `[addTitle] No cues parsed from ${path.basename(titleFilePath)}` });
		return finalFile;
	}

	sendToMW('log', {
		text: `[addTitle] Parsed ${cues.length} segments (${format}) from ${path.basename(titleFilePath)}`,
	});

	// Process each video file
	for (const fileFrom of _item.import.inputFile ?? []) {
		const fileTo = createPathForFileByPattern(curPath, _description, fileFrom);

		sendToMW('statusbar', {
			text: `${_description.infoText}: [add title]\n${path.basename(fileFrom)}`,
		});

		// Get real video dimensions
		let videoInfo: Awaited<ReturnType<typeof getFullInfoFromVideoFile>>;
		try {
			videoInfo = await getFullInfoFromVideoFile(fileFrom, _description);
		} catch (e) {
			sendToMW('log', { text: `[addTitle] Failed to get video info: ${e}` });
			continue;
		}

		const { width: realWidth, height: realHeight } = videoInfo;

		if (!realWidth || !realHeight) {
			sendToMW('log', { text: '[addTitle] Invalid video dimensions' });
			continue;
		}

		// Adapt settings to real video size
		const adapted = adaptSettingsToVideo(titleSettings, realWidth, realHeight);

		// ── Step 1: Build display phrases ──────────────────────────────────────
		// This is the key step: assemble lines, respect maxLines, sentence endings
		const phrases = buildPhrases(cues, adapted.text.size, adapted.videoWidth, adapted.text.wrapWidth, adapted.text.maxLines, hasWords);

		sendToMW('log', {
			text: `[addTitle] Built ${phrases.length} display phrases from ${cues.length} segments`,
		});

		if (phrases.length === 0) {
			sendToMW('log', { text: '[addTitle] No phrases built, skipping' });
			continue;
		}

		// ── Step 2: Resolve font ────────────────────────────────────────────────
		const fontResult = findFontFile(adapted.text.font);
		if (!fontResult) {
			sendToMW('log', { text: `[addTitle] Font not found: "${adapted.text.font}", using fallback` });
		}
		const fontName = fontResult?.fontName ?? (process.platform === 'win32' ? 'Arial' : 'Helvetica');

		// ── Step 3: Build ASS file ──────────────────────────────────────────────
		const assContent = buildAssFile(phrases, adapted, fontName);
		const assFile = path.join(os.tmpdir(), `addTitle_${Date.now()}.ass`);
		fs.writeFileSync(assFile, assContent, 'utf-8');

		sendToMW('log', { text: `[addTitle] ASS written: ${assFile}` });

		// ── Step 4: Run ffmpeg ──────────────────────────────────────────────────
		testAndCreateFolder(path.dirname(fileTo));

		const command = {
			text: `${_description.infoText}: [add title] ${path.basename(fileFrom)} → ${path.basename(fileTo)}`,
			duration: videoInfo.durationInSeconds,
			command: ['-i', fileFrom, '-vf', `ass=${assFile}`, '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-y', fileTo],
		};

		try {
			await spawnFFmpegCommand(command, _description, sendToMW);
			finalFile.push(fileTo);
		} catch (e) {
			sendToMW('log', { text: `[addTitle] ffmpeg failed: ${e}` });
		} finally {
			try {
				fs.unlinkSync(assFile);
			} catch {
				/* ignore */
			}
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });

	return finalFile;
}
