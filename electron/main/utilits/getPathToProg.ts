import { getStoreState, waitForStoresReady } from '../storeCache';

export async function getPathToProg(progName: string): Promise<string> {
	// ⏳ ждём, пока renderer пришлёт сторы
	await waitForStoresReady();

	const progObj = getStoreState<any[]>('progPath');
	if (!progObj) return '';

	for (const program of progObj) {
		if (program.name === progName) {
			const p = program.path;
			return Array.isArray(p) ? String(p[0] ?? '') : String(p ?? '');
		}
	}

	return '';
}
