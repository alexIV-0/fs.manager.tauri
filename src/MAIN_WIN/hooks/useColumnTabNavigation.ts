// useColumnTabNavigation.ts
// Tab / Shift+Tab — циклическое переключение фокуса между четырьмя колонками
// главного окна: главная → проекты → содержимое (gd) → локальное (local) → ...
// Shift+Tab — в обратном порядке. Монтируется один раз в AppMain.
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { COLUMN_ORDER, FocusedColumn, useColumnFocus_store } from '@/Store/MainWin/columnFocus_store';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';

// Делает указанную колонку фокусной, при необходимости подставляя выделение,
// чтобы стрелки сразу работали от осмысленной позиции.
function focusColumn(target: FocusedColumn) {
	if (target === 'gd' || target === 'local') {
		useColumnView_Store.getState().focusInstance(target);
		return;
	}

	useColumnFocus_store.getState().setFocusedColumn(target);

	if (target === 'main') {
		const { activeMainFolder, setMainFolderId } = setActiveFolders_store.getState();
		if (!activeMainFolder) {
			const arr = mainFolders_stor.getState().mainFolderArr;
			if (arr.length) setMainFolderId(arr[0].id);
		}
	} else if (target === 'project') {
		const { activeProjectFolder, setActiveProjectFolder, activeMainFolder } = setActiveFolders_store.getState();
		if (!activeProjectFolder) {
			const pf = mainFolders_stor.getState().mainFolderArr.find((f) => f.id === activeMainFolder)?.projectFolders || [];
			if (pf.length) setActiveProjectFolder(pf[0]);
		}
	}
}

export function useColumnTabNavigation(): void {
	useKeyboardShortcut({
		key: 'Tab',
		skipOnInput: true,
		callback: (e) => {
			e.preventDefault();
			const cur = useColumnFocus_store.getState().focusedColumn;
			const i = COLUMN_ORDER.indexOf(cur);
			const len = COLUMN_ORDER.length;
			const next = e.shiftKey ? COLUMN_ORDER[(i - 1 + len) % len] : COLUMN_ORDER[(i + 1) % len];
			focusColumn(next);
		},
	});
}
