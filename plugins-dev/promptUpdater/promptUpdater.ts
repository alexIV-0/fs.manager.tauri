// promptUpdater — берёт текст (из файла или строки), подставляет в него динамические
// [label]-токены и опционально сохраняет результат в .txt. Tauri-port: все fs-операции
// через @plugin-api/tauri helper.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';


// Ключи плагинной инфраструктуры — не считаются динамическими addLink-входами.
const KNOWN_ITEM_KEYS = new Set([
	'id',
	'nodeType',
	'isTerminal',
	'import',
	'pluginId',
	'pluginVersion',
	'colorType',
	'cost',
	'costUnit',
	'functionName',
	'promptPath',
	'targetPath',
	'saveAsText',
	'addLink',
	'nodeLabel',
]);

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toStringValue(value: any): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (Array.isArray(value)) return value.map(toStringValue).join(', ');
	return String(value);
}

export async function promptUpdaterFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { fs, sendToMW } = ctx;
	// ── 1. Get text content ──────────────────────────────────────────────────
	let text = '';

	const importedPrompt: string[] = _item.import?.promptPath ?? [];
	if (importedPrompt.length > 0) {
		const src = importedPrompt[0];
		if (await fs.existsFile(src)) {
			text = await fs.read(src);
		} else {
			// treat as plain text string
			text = src;
		}
	} else if (_item.promptPath) {
		const rawPath = _item.promptPath as string;
		const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.join(_description.projectPathGD ?? '', rawPath);
		if (await fs.existsFile(resolvedPath)) {
			text = await fs.read(resolvedPath);
		}
	}

	// ── 2. Collect dynamic addLink labels ────────────────────────────────────
	const dynamicLabels = Object.keys(_item).filter((k) => !KNOWN_ITEM_KEYS.has(k));

	// ── 3. Replace [label] tokens in text ───────────────────────────────────
	// Умная подстановка: если значение входа — путь к СУЩЕСТВУЮЩЕМУ файлу, подставляем
	// его содержимое (как для promptPath); иначе — значение как строку. Так вход можно
	// кормить и файлом (нода вернула путь), и строкой (нода вернула контент).
	let modifiedText = text;
	for (const label of dynamicLabels) {
		const importedValues: any[] = _item.import?.[label] ?? [];
		let strValue: string;
		if (importedValues.length > 0) {
			const parts: string[] = [];
			for (const v of importedValues) {
				if (typeof v === 'string' && (await fs.existsFile(v))) parts.push(await fs.read(v));
				else parts.push(toStringValue(v));
			}
			strValue = parts.join('\n');
		} else {
			strValue = toStringValue(_item[label]);
		}
		const pattern = new RegExp(`\\[${escapeRegExp(label)}\\]`, 'g');
		modifiedText = modifiedText.replace(pattern, strValue);
	}

	sendToMW('statusbar', { text: `${_description.infoText}: [promptUpdater]\n ${_description.curItem}` });

	// ── 4. Output: save to .txt file or return as string ────────────────────
	const saveAsText: boolean = _item.saveAsText ?? false;

	if (saveAsText) {
		let curPath: string[] = (_item.targetPath?.length ?? 0) === 0 ? ['$clearName ($random(3))'] : [..._item.targetPath];

		if (_item.import?.targetPath?.length > 0) {
			curPath.unshift(..._item.import.targetPath);
		} else {
			curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
		}

		const fileForName = _description.pathForDelete;
		const basePath = createPathForFileByPattern(curPath, _description, fileForName);
		const fileTo = basePath.replace(/\.[^.]*$/, '') + '.txt';

		await fs.mkdir(path.dirname(fileTo));
		await fs.write(fileTo, modifiedText);

		sendToMW('log', { level: 'info', text: `Saved to: ${fileTo}` });
		return [fileTo];
	}

	sendToMW('log', { level: 'info', text: `Result:\n${modifiedText}` });
	return [modifiedText];
}
