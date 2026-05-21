import { create } from 'zustand';

type State = {
	path: string;
	addPath: (path: string) => void;
};

// Простая проверка что строка похожа на абсолютный путь (POSIX или Windows).
// Защита от случая, когда из-за бага в IPC окну прилетает JSON-объект вместо пути —
// тогда дальнейшие команды (testAndCreateFolders/saveFlowToOptionsFolder) пытались бы
// создать папку с именем `{"filePath":"...` прямо в CWD процесса (= src-tauri/).
function isAbsolutePath(p: unknown): p is string {
	if (typeof p !== 'string' || p.length === 0) return false;
	return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

export const usePathStore = create<State>((set) => ({
	path: '',
	addPath: (path) => {
		console.log('[usePathStore] 📍 addPath called with:', path);
		if (!isAbsolutePath(path)) {
			console.warn('[usePathStore] ⚠️ rejecting non-absolute path:', path);
			return;
		}
		set({ path });
		console.log('[usePathStore] ✅ Path updated in store');
	},
}));
