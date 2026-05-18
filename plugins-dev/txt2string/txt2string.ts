import { sendToMW } from '../_template/pluginSender';
import fs from 'fs';

export { onLoad } from '../_template/pluginSender';

export async function txt2stringFunc(_item: any, _description: any) {
	const finalFile: string[] = [];

	const importedItems: string[] = _item.import?.textedit ?? [];

	if (importedItems.length > 0) {
		// Приоритет — входной файл или строка из другой ноды
		for (const fileOrText of importedItems) {
			sendToMW('statusbar', {
				text: `${_description.infoText}: [txt2string] ${fileOrText}`,
			});

			if (fs.existsSync(fileOrText)) {
				finalFile.push(fs.readFileSync(fileOrText, 'utf-8'));
			} else {
				finalFile.push(fileOrText);
			}
		}
	} else {
		// Статичный текст из самой ноды
		const staticText: string = _item.textedit ?? '';
		if (staticText.trim()) {
			finalFile.push(staticText);
		}
	}
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}
