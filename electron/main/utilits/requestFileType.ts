import { getStoreState, waitForStoresReady } from '../storeCache';

export async function requestFileType(extension: string): Promise<string> {
	// ⏳ ждём, пока renderer пришлёт сторы
	await waitForStoresReady();

	const types = getStoreState<any[]>('typeOfFile');
	if (!types) return 'files';

	const ext = extension.slice(1).toLowerCase();

	for (const type of types) {
		if (type.path.includes(ext)) {
			return type.name;
		}
	}

	return 'files';
}
