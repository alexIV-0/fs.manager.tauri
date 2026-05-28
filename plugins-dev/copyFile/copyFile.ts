// copyFile — копирует файл по сформированному паттерну.
// Tauri-port: все file-операции идут через @plugin-api/tauri helper, который
// дёргает Tauri IPC. Старая Electron-логика (fs.existsSync + copyFileWithHashCheck)
// заменена на copy_item в Rust (там же создаются родительские директории).

import path from 'path';
import { fs, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
import { formatNameByPattern } from '../../src/Utils/formatNameByPattern';

export { onLoad } from '../_template/tauri';

export async function copyFileFunc(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	// Сегменты, заданные пользователем (папка/имя), либо дефолтное имя.
	const targetSegments: string[] = _item.targetPath.length === 0 ? ['$clearName ($random(3))'] : [..._item.targetPath];

	// Если последний сегмент — это «папка» (абсолютный путь или относительный ./ ../),
	// то имя файла не задано — дописываем стандартное (как обещает тултип Target Path).
	// Если же последний сегмент — обычное имя/токен ($fileName и т.п.), оставляем как есть.
	const lastResolved = formatNameByPattern({ string: targetSegments[targetSegments.length - 1], description: _description });
	if (path.isAbsolute(lastResolved) || /^\.\.?[\\/]/.test(lastResolved)) {
		targetSegments.push('$clearName ($random(3))');
	}

	// Выбор базы по первому сегменту:
	//  - АБСОЛЮТНЫЙ путь ("Custom Folder...") — используем как есть, иначе path.join
	//    приклеил бы его к дефолтному префиксу и получился бы несуществующий путь;
	//  - относительный ./ ../ — отсчитываем от папки проекта ($projectPathGD);
	//  - иначе (имена папок / пусто) — input targetPath или локальная папка обработки.
	const firstResolved = formatNameByPattern({ string: targetSegments[0], description: _description });

	let curPath: string[];
	if (path.isAbsolute(firstResolved)) {
		curPath = targetSegments;
	} else if (/^\.\.?[\\/]/.test(firstResolved)) {
		curPath = ['$projectPathGD', ...targetSegments];
	} else if (_item.import.targetPath?.length) {
		curPath = [..._item.import.targetPath, ...targetSegments];
	} else {
		curPath = ['$localFolder', '$mainFolderName', '$projectName', '$findTime', ...targetSegments];
	}

	for (const fileFrom of _item.import.inputFile as string[]) {
		const fileTo = createPathForFileByPattern(curPath, _description, fileFrom);

		sendToMW('statusbar', {
			text: `${_description.infoText ?? ''}: [copy file] ${path.basename(fileFrom)} → ${path.basename(fileTo)}`,
		});

		// destination уже существует? Проверяем через exists (а не existsFile),
		// потому что inputFile может быть папкой — existsFile вернул бы false
		// и для проверки overwrite, и для пост-проверки после копирования.
		const destExists = await fs.exists(fileTo);

		if (destExists) {
			if (!_item.overwriteOldest) {
				// overwrite=false — пропускаем (как в оригинальном Electron-плагине).
				console.log('Destination exists and overwrite=false:', fileTo);
				finalFile.push(fileTo);
				continue;
			}

			// overwriteOldest=true: перезаписываем только если source новее.
			const newer = await fs.isSourceNewer(fileFrom, fileTo);
			if (!newer) {
				console.log('Destination is newer or same age — skip:', path.basename(fileTo));
				finalFile.push(fileTo);
				continue;
			}
		}

		// copy_item в Rust сам создаёт родительские директории.
		// overwrite:true — мы уже отфильтровали кейсы выше.
		await fs.copy(fileFrom, fileTo, { overwrite: true });

		// Проверка что результат действительно появился (защита от тихого фейла).
		// exists — потому что fileFrom может быть папкой.
		const copied = await fs.exists(fileTo);
		if (!copied) {
			throw new Error(`[copyFile] Copy failed: ${path.basename(fileFrom)} → ${path.basename(fileTo)}`);
		}

		if (_item.deleteAfter) {
			await fs.remove(fileFrom).catch(() => {});
		}

		finalFile.push(fileTo);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
