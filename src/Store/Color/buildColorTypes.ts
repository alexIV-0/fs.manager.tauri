// buildColorTypes.ts
import { typeOfdata_store, typeOfNodes_store, typeOfFile_store } from '../MainWin/pathPattern_store';
import { colorTypes_store } from './colorTypes_store';
import { defGray } from './grayColor';

/** Записать цвет в map, НЕ затирая уже существующее значение пустотой.
 *  Нужно потому что `typeOfFile_store` (file_types) хранит записи типа
 *  `{name:'ai', color:null}` — раньше null затирал валидный цвет из
 *  typeOfNodes_store (там `ai: #2d84ffff`), и ноды становились серыми. */
function assignIfColored(acc: Record<string, string | null | undefined>, name: string, color: string | null | undefined) {
	if (color === null || color === undefined || color === '') {
		// Не перетираем существующее непустое значение пустотой.
		if (!(name in acc) || !acc[name]) acc[name] = color ?? null;
		return;
	}
	acc[name] = color;
}

export function rebuildColorTypes() {
	const colorMap: Record<string, string | null | undefined> = {};

	for (const item of typeOfdata_store.getState().patternStore) {
		assignIfColored(colorMap, item.name, item.color);
	}
	for (const item of typeOfNodes_store.getState().patternStore) {
		assignIfColored(colorMap, item.name, item.color);
	}
	for (const item of typeOfFile_store.getState().patternStore) {
		assignIfColored(colorMap, item.name, item.color);
	}

	colorMap.default = defGray;

	colorTypes_store.getState().setColorTypes(colorMap);
}
