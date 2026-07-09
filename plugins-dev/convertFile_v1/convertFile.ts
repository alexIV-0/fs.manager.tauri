// convertFile_v1 — ручная конвертация ffmpeg-аргументами. Tauri-port.

import path from 'path';
import { fs, ffmpeg, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

// Резолвит ffmpeg-команду по приоритету. Три источника (в порядке приоритета):
//   1. Вход из другой ноды (_item.import.ffmpegCommand) — если что-то пришло, оно главнее поля.
//      • пришёл путь к существующему файлу → читаем его содержимое;
//      • пришла строка → используем как есть.
//   2. Текст в самом поле ноды (_item.ffmpegCommand).
async function resolveFfmpegCommand(_item: any): Promise<string> {
	const imported: string[] = _item.import?.ffmpegCommand ?? [];
	if (imported.length > 0) {
		const src = imported[0];
		if (src && (await fs.existsFile(src))) return await fs.read(src);
		return src ?? '';
	}
	return _item.ffmpegCommand ?? '';
}

export async function convertFileFunc(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];
	let iteration = 1;
	const inputs: string[] = _item.import.inputFile;

	// Команда одна на всю ноду — резолвим до цикла (файл читаем один раз).
	const ffmpegCommandStr = await resolveFfmpegCommand(_item);
	const ffmpegArgs = ffmpegCommandStr ? ffmpegCommandStr.trim().split(/\s+/).filter(Boolean) : [];

	for (const fileFrom of inputs) {
		let curPath: string[] = _item.targetPath.length === 0 ? ['$clearName ($random(3))'] : [..._item.targetPath];

		if (_item.import.targetPath?.length) {
			curPath.unshift(..._item.import.targetPath);
		} else {
			curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
		}

		const newPath = createPathForFileByPattern(curPath, _description, fileFrom);
		const dirTo = path.dirname(newPath);
		const originalName = path.basename(fileFrom);
		const newName = path.basename(newPath, path.extname(newPath)) + '.' + _item.fileExt[0];
		const fileTo = path.join(dirTo, newName);

		await fs.mkdir(dirTo);

		const curDuration = (await ffmpeg.getInfo(fileFrom)).durationInSeconds;

		await ffmpeg.run({
			text: `${_description.infoText}: [convert file ${iteration}/${inputs.length}]\n ${originalName} → ${newName}`,
			duration: curDuration || 0,
			nodeId: _item.id,
			command: ['-y', '-i', fileFrom, ...ffmpegArgs, fileTo],
		});

		finalFile.push(fileTo);
		iteration++;
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
