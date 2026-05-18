// buildColorTypes.ts
import { typeOfdata_store, typeOfNodes_store, typeOfFile_store } from '../MainWin/pathPattern_store';
import { colorTypes_store } from './colorTypes_store';
import { defGray } from './grayColor';

export function rebuildColorTypes() {
	const colorData = typeOfdata_store.getState().patternStore.reduce((acc: any, item) => {
		acc[item.name] = item.color;
		return acc;
	}, {});

	const colorNodes = typeOfNodes_store.getState().patternStore.reduce((acc: any, item) => {
		acc[item.name] = item.color;
		return acc;
	}, colorData);

	const colorTypes = typeOfFile_store.getState().patternStore.reduce((acc: any, item) => {
		acc[item.name] = item.color;
		return acc;
	}, colorNodes);

	colorTypes.default = defGray;

	colorTypes_store.getState().setColorTypes(colorTypes);
}
