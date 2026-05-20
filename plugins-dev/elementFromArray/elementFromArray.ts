// elementFromArray — выбирает элемент(ы) из входного массива по правилу
// (First/Last/Random/Text-match). Tauri-port: fs.existsSync/statSync убраны,
// проверка через @plugin-api/tauri helper.

import path from 'path';
import { fs, sendToMW } from '../_template/tauri';
import { getRandomInt } from '../../electron/main/utilits/getRandomInt';

export { onLoad } from '../_template/tauri';

async function resolveSearchText(raw: string): Promise<string> {
	if (!raw) return '';
	if (await fs.existsFile(raw)) {
		return path.parse(raw).name;
	}
	return raw;
}

function splitWords(text: string): string[] {
	return text
		.split(',')
		.map((w) => w.trim().toLowerCase())
		.filter(Boolean);
}

function countMatches(filePath: string, words: string[]): number {
	const fname = path.parse(filePath).name.toLowerCase();
	let count = 0;
	for (const w of words) if (fname.includes(w)) count++;
	return count;
}

function findBestMatchIndex(inputArr: string[], words: string[]): number {
	let bestIdx = -1;
	let bestCount = 0;
	for (let i = 0; i < inputArr.length; i++) {
		const c = countMatches(inputArr[i], words);
		if (c > bestCount) {
			bestCount = c;
			bestIdx = i;
		}
	}
	return bestIdx;
}

export async function elementFromArrayFunc(_item: any, _description: any): Promise<string[]> {
	const inputArr: string[] = _item.import?.inputFile ?? [];
	const mode: string = _item.ddm ?? 'First';

	const importedText: any[] = _item.import?.textInFName ?? [];
	const rawText: string =
		importedText.length > 0 ? String(importedText[0] ?? '') : String(_item.textInFName ?? '');
	const searchText = await resolveSearchText(rawText);
	const words = splitWords(searchText);

	let finalFile: string[] = [];

	switch (mode) {
		case 'First':
			finalFile = inputArr.slice(0, 1);
			break;
		case 'Last':
			finalFile = inputArr.slice(-1);
			break;
		case 'Except First':
			finalFile = inputArr.slice(1);
			break;
		case 'Except Last':
			finalFile = inputArr.slice(0, -1);
			break;
		case 'Random':
			if (inputArr.length > 0) finalFile = [inputArr[getRandomInt(inputArr.length - 1)]];
			break;
		case 'Text In fName': {
			if (words.length === 0 || inputArr.length === 0) {
				finalFile = [];
				break;
			}
			const idx = findBestMatchIndex(inputArr, words);
			finalFile = idx === -1 ? [] : [inputArr[idx]];
			break;
		}
		case 'Exept text in fName': {
			if (words.length === 0 || inputArr.length === 0) {
				finalFile = inputArr.slice();
				break;
			}
			const idx = findBestMatchIndex(inputArr, words);
			finalFile = idx === -1 ? inputArr.slice() : inputArr.filter((_, i) => i !== idx);
			break;
		}
	}

	sendToMW('statusbar', {
		text: `${_description.infoText}: [${mode}]\n ${_description.curItem}`,
	});
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
