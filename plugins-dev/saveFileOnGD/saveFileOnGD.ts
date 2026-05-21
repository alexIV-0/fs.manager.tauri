// saveFileOnGD — копирует файл на «GD»-сторону (mainFolderPath/projectName/OUT/...).
// Видео-файлы копируются ffmpeg-ом с записью метаданных (department, project, contact).
// При коллизии имени — добавляется числовой суффикс.
// Tauri-port: fs / ffmpeg / mkdir — через @plugin-api/tauri helper.

import path from 'path';
import { fs, ffmpeg, sendToMW } from '../_template/tauri';
import { getFileTypeByExt } from '../../src/Utils/getFileTypeByExt';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

/** Аналог copyFileWithAddMetadata из Electron — копирует видео через ffmpeg с -metadata description=...
 *  Раньше использовал spawnFFmpegCommand из main; здесь — helper.ffmpeg.exec. */
async function copyVideoWithMetadata(fileFrom: string, fileTo: string, description: any, nodeId?: string): Promise<void> {
	const metadata = {
		department: 'inovationHub',
		modification: description.automationType,
		project: description.projectName,
		contact: description.contact,
	};
	const jsonStr = JSON.stringify(metadata);

	// Пробуем достать длительность для прогресса (не критично — если упадёт, прогресс просто не будет показан).
	let durationSec: number | undefined;
	try {
		const streams = await ffmpeg.probe(fileFrom);
		const v = ffmpeg.pickVideo(streams);
		if (v?.duration) durationSec = Number(v.duration);
	} catch {}

	const result = await ffmpeg.exec(['-y', '-i', fileFrom, '-metadata', `description=${jsonStr}`, '-c', 'copy', fileTo], {
		durationSec,
		nodeId,
		statusText: `${description.infoText}: [copy file with add metadata] ${path.basename(fileFrom)} → ${path.basename(fileTo)}`,
	});

	if (result.exit_code !== 0) {
		throw new Error(`[saveFileOnGD] ffmpeg copy-with-metadata failed (exit ${result.exit_code}): ${result.stderr.slice(-400)}`);
	}
}

export async function saveFileOnGDFunc(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	const fileType = getFileTypeByExt(_item.import.inputFile[0], _description.typeOfFile);

	let curPath: string[] = _item.path.length === 0 ? ['[$id]_$findTime-$clearName ($random(3))'] : [..._item.path];
	if (_item.import.path) {
		curPath.unshift(..._item.import.path);
	} else {
		curPath.unshift('$mainFolderPath', '$projectName', 'OUT');
	}

	for (const fileFrom of _item.import.inputFile as string[]) {
		let fileTo = createPathForFileByPattern(curPath, _description, fileFrom);

		// При коллизии (на диске или среди уже зарезервированных) — добавляем индекс.
		if ((await fs.exists(fileTo)) || finalFile.includes(fileTo)) {
			const fileDir = path.dirname(fileTo);
			const fileExt = path.extname(fileTo);
			const fileName = path.basename(fileTo, fileExt);
			let i = 1;
			let candidate: string;
			do {
				candidate = path.join(fileDir, `${fileName}_${i}${fileExt}`);
				i++;
			} while ((await fs.exists(candidate)) || finalFile.includes(candidate));
			fileTo = candidate;
		}

		sendToMW('statusbar', {
			text: `${_description.infoText}: [save file on GD] ${path.basename(fileFrom)} → ${path.basename(fileTo)}`,
		});

		await fs.mkdir(path.dirname(fileTo));

		if (fileType === 'video') {
			await copyVideoWithMetadata(fileFrom, fileTo, _description, _item.id);
		} else {
			await fs.copy(fileFrom, fileTo, { overwrite: Boolean(_item.overwriteOldest) });
			// верификация копии
			if (!(await fs.existsFile(fileTo))) {
				throw new Error(`[saveFileOnGD] Copy failed: ${path.basename(fileFrom)} → ${path.basename(fileTo)}`);
			}
		}

		finalFile.push(fileTo);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
