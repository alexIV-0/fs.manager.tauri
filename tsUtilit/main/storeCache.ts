// main/storeCache.ts
type StoreCache = Record<string, any>;

const storeCache: StoreCache = {};
const readyStores = new Set<string>();

let resolveReady: (() => void) | null = null;

const readyPromise = new Promise<void>((resolve) => {
	resolveReady = resolve;
});

export function updateStoreCache(name: string, state: any) {
	storeCache[name] = state;
	readyStores.add(name);

	// если первый раз получили хотя бы один store — считаем main готовым
	if (resolveReady) {
		resolveReady();
		resolveReady = null;
	}
}

export function getStoreState<T = any>(name: string): T | undefined {
	console.log(`[storeCache] updateStoreCache called: ${name}`); // ← добавь это
	return storeCache[name];
}

export async function waitForStoresReady() {
	await readyPromise;
}
