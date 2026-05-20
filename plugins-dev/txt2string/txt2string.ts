// txt2string — возвращает содержимое текстового файла или строку как есть.
// Tauri-port: fs.existsSync/readFileSync через @plugin-api/tauri helper.

import { fs, sendToMW } from '../_template/tauri';

export { onLoad } from '../_template/tauri';

export async function txt2stringFunc(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	const importedItems: string[] = _item.import?.textedit ?? [];

	if (importedItems.length > 0) {
		// Приоритет — входной файл или строка из другой ноды
		for (const fileOrText of importedItems) {
			sendToMW('statusbar', { text: `${_description.infoText}: [txt2string] ${fileOrText}` });

			if (await fs.existsFile(fileOrText)) {
				finalFile.push(await fs.read(fileOrText));
			} else {
				finalFile.push(fileOrText);
			}
		}
	} else {
		// Статичный текст из самой ноды
		const staticText: string = _item.textedit ?? '';
		if (staticText.trim()) finalFile.push(staticText);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
