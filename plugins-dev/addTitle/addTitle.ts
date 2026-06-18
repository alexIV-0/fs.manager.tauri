// addTitle — добавляет субтитры (SRT/VTT/JSON) в видео через ffmpeg ass-фильтр.
// Tauri-port: spawn/fs/os через @plugin-api/tauri helper, поиск шрифтов
// через fontsGetList (Rust обходит системные папки сам).

import path from 'path';
import { fs, ffmpeg, fonts, paths, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
import { TitleSettings } from './types';
import { parseSubtitles, detectFormat } from './parsers';
import { adaptSettingsToVideo } from './settingsAdapter';
import { buildPhrases } from './buildPhrases';
import { buildAssFile } from './buildAss';
import { resolveFontFamily } from './fontFamily';

export { onLoad } from '../_template/tauri';

function isTitleFile(filePath: string): boolean {
	return ['.srt', '.vtt', '.json'].includes(path.extname(filePath).toLowerCase());
}

function platformFallbackFont(): string {
	// в браузерном бандле process отсутствует, гадаем по navigator.platform.
	const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
	if (/Win/i.test(ua)) return 'Arial';
	return 'Helvetica';
}

/** Экранирует путь как значение опции в filtergraph ffmpeg (`ass=PATH:fontsdir=DIR`).
 * Парсер фильтров трактует `:` как разделитель опций, `\` — как escape, `'` — как кавычку;
 * без экранирования ломаются пути с двоеточием (напр. Windows `C:\...`). */
function escapeFilterPath(p: string): string {
	return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export async function addTitle(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	let curPath: string[] = _item.targetPath?.length > 0 ? [..._item.targetPath] : ['$clearName ($random(3))'];
	if (_item.import.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

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

	const titleFiles: string[] = (_item.import.inputTitle ?? []).filter(isTitleFile);
	if (titleFiles.length === 0) {
		sendToMW('log', { text: '[addTitle] No subtitle file found' });
		return finalFile;
	}

	const titleFilePath = titleFiles[0];
	const titleContent = await fs.read(titleFilePath);
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

	const tmpDir = await paths.tmpdir();

	for (const fileFrom of (_item.import.inputFile ?? []) as string[]) {
		const fileTo = createPathForFileByPattern(curPath, _description, fileFrom);

		sendToMW('statusbar', { text: `${_description.infoText}: [add title]\n${path.basename(fileFrom)}` });

		let videoInfo;
		try {
			videoInfo = await ffmpeg.getInfo(fileFrom);
		} catch (e) {
			sendToMW('log', { text: `[addTitle] Failed to get video info: ${e}` });
			continue;
		}

		const { width: realWidth, height: realHeight } = videoInfo;
		if (!realWidth || !realHeight) {
			sendToMW('log', { text: '[addTitle] Invalid video dimensions' });
			continue;
		}

		const adapted = adaptSettingsToVideo(titleSettings, realWidth, realHeight);

		const phrases = buildPhrases(cues, adapted.text.size, adapted.videoWidth, adapted.text.wrapWidth, adapted.text.maxLines, hasWords);

		sendToMW('log', {
			text: `[addTitle] Built ${phrases.length} display phrases from ${cues.length} segments`,
		});

		if (phrases.length === 0) {
			sendToMW('log', { text: '[addTitle] No phrases built, skipping' });
			continue;
		}

		const fontResult = await fonts.find(adapted.text.font);
		if (!fontResult) {
			sendToMW('log', { text: `[addTitle] Font not found: "${adapted.text.font}", using fallback` });
		}
		// libass матчит шрифт ASS-стиля по ИМЕНИ СЕМЕЙСТВА, а fonts_get_list отдаёт лишь
		// stem файла ("ArialHB" вместо "Arial Hebrew") — при несовпадении шрифт молча
		// подменяется дефолтным. Поэтому читаем настоящее имя семейства из файла.
		let fontName = fontResult?.name ?? platformFallbackFont();
		if (fontResult) {
			const family = await resolveFontFamily(fontResult.path);
			if (family) fontName = family;
			else sendToMW('log', { text: `[addTitle] Could not read family name from ${fontResult.path}, using stem "${fontName}"` });
		}
		// fontsdir гарантирует, что libass подхватит файл даже если он не в системном кэше.
		const fontsDir = fontResult ? path.dirname(fontResult.path) : null;

		const assContent = buildAssFile(phrases, adapted, fontName);
		const assFile = path.join(tmpDir, `addTitle_${Date.now()}.ass`);
		await fs.write(assFile, assContent);

		sendToMW('log', {
			text: `[addTitle] ASS written: ${assFile} (font: "${fontName}"${fontsDir ? `, fontsdir: ${fontsDir}` : ''})`,
		});

		await fs.mkdir(path.dirname(fileTo));

		const assFilter = fontsDir
			? `ass=${escapeFilterPath(assFile)}:fontsdir=${escapeFilterPath(fontsDir)}`
			: `ass=${escapeFilterPath(assFile)}`;

		try {
			await ffmpeg.run({
				text: `${_description.infoText}: [add title] ${path.basename(fileFrom)} → ${path.basename(fileTo)}`,
				duration: videoInfo.durationInSeconds || 10,
				nodeId: _item.id,
				command: ['-y', '-i', fileFrom, '-vf', assFilter, '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', fileTo],
			});
			finalFile.push(fileTo);
		} catch (e) {
			sendToMW('log', { text: `[addTitle] ffmpeg failed: ${e}` });
		} finally {
			await fs.remove(assFile).catch(() => {});
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
