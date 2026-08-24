// Выбранная главная папка — облачная?
//
// Нужен трём верхним полосам (проекты + обе панели третьей колонки), чтобы
// подкрасить тень. Отдельный хук, а не повтор `find` в каждой колонке: правило
// «что считать облачной папкой» должно жить в одном месте.

import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';

export function useActiveFolderIsOnline(): boolean {
	const activeMainFolder = setActiveFolders_store((s) => s.activeMainFolder);
	return mainFolders_stor((s) => !!s.mainFolderArr.find((f) => f.id === activeMainFolder)?.online);
}
