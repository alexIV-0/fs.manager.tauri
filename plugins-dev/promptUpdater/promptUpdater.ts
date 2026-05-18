
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';
import fs from 'fs';

export { onLoad } from '../_template/pluginSender';

// Fixed keys that belong to the node infrastructure or static properties — not dynamic addLink inputs
const KNOWN_ITEM_KEYS = new Set([
	'id', 'nodeType', 'isTerminal', 'import',
	'pluginId', 'pluginVersion', 'colorType', 'cost', 'costUnit', 'functionName',
	'promptPath', 'targetPath', 'saveAsText', 'addLink', 'nodeLabel',
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

export async function promptUpdaterFunc(_item: any, _description: any) {
	// ── 1. Get text content ────────────────────────────────────────────────────
	let text = '';

	const importedPrompt: string[] = _item.import?.promptPath ?? [];
	if (importedPrompt.length > 0) {
		const src = importedPrompt[0];
		if (fs.existsSync(src)) {
			text = fs.readFileSync(src, 'utf-8');
		} else {
			// treat as plain text string
			text = src;
		}
	} else if (_item.promptPath) {
		const rawPath = _item.promptPath as string;
		const resolvedPath = path.isAbsolute(rawPath)
			? rawPath
			: path.join(_description.projectPathGD ?? '', rawPath);
		if (fs.existsSync(resolvedPath)) {
			text = fs.readFileSync(resolvedPath, 'utf-8');
		}
	}

	// ── 2. Collect dynamic labels added via addLink ────────────────────────────
	// Dynamic properties use their label as the key in _item (editLabel: true).
	// All other keys belong to the node infrastructure or fixed static properties.
	const dynamicLabels = Object.keys(_item).filter((k) => !KNOWN_ITEM_KEYS.has(k));

	// ── 3. Replace [label] tokens in text ─────────────────────────────────────
	let modifiedText = text;
	for (const label of dynamicLabels) {
		const importedValues: any[] = _item.import?.[label] ?? [];
		// Priority: upstream import value → static controlProps value
		// Use entire importedValues array so multi-value results (e.g. timecodes) are joined, not truncated to [0]
		const rawValue = importedValues.length > 0 ? importedValues : _item[label];
		const strValue = toStringValue(rawValue);

		const pattern = new RegExp(`\\[${escapeRegExp(label)}\\]`, 'g');
		modifiedText = modifiedText.replace(pattern, strValue);
	}

	sendToMW('statusbar', {
		text: `${_description.infoText}: [promptUpdater]\n ${_description.curItem}`,
	});

	// ── 4. Output: save to .txt file or return as string ──────────────────────
	const saveAsText: boolean = _item.saveAsText ?? false;

	if (saveAsText) {
		let curPath: string[] = (_item.targetPath?.length ?? 0) === 0
			? ['$clearName ($random(3))']
			: _item.targetPath;

		if (_item.import?.targetPath?.length > 0) {
			curPath.unshift(..._item.import.targetPath);
		} else {
			curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
		}

		const fileForName = _description.pathForDelete;
		const basePath = createPathForFileByPattern(curPath, _description, fileForName);
		const fileTo = basePath.replace(/\.[^.]*$/, '') + '.txt';

		testAndCreateFolder(path.dirname(fileTo));
		fs.writeFileSync(fileTo, modifiedText, 'utf-8');

		sendToMW('log', { level: 'info', text: `Saved to: ${fileTo}` });
		return [fileTo];
	}

	sendToMW('log', { level: 'info', text: `Result:\n${modifiedText}` });
	return [modifiedText];
}
