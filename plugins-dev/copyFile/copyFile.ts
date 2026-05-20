// copyFile — копирует файл по сформированному паттерну.
// Tauri-port: все file-операции идут через @plugin-api/tauri helper, который
// дёргает Tauri IPC. Старая Electron-логика (fs.existsSync + copyFileWithHashCheck)
// заменена на copy_item в Rust (там же создаются родительские директории).

import path from 'path';
import { fs, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

export async function copyFileFunc(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	let curPath: string[] = _item.targetPath.length === 0 ? ['$clearName ($random(3))'] : [..._item.targetPath];

	if (_item.import.targetPath?.length) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	for (const fileFrom of _item.import.inputFile as string[]) {
		const fileTo = createPathForFileByPattern(curPath, _description, fileFrom);

		sendToMW('statusbar', {
			text: `${_description.infoText ?? ''}: [copy file] ${path.basename(fileFrom)} → ${path.basename(fileTo)}`,
		});

		// destination уже существует?
		const destExists = await fs.existsFile(fileTo);

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

		// Проверка что файл действительно появился (защита от тихого фейла).
		const copied = await fs.existsFile(fileTo);
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
