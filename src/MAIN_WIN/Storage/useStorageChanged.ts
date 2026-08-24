// Живое обновление значков после ФОНОВОЙ передачи.
//
// ── Зачем ───────────────────────────────────────────────────────────────────
// Значок файла менялся только тогда, когда действие начал сам интерфейс: пункты
// меню «Скачать»/«Залить» перечитывают папку сами. А передачи чаще идут в фоне —
// префетч, гидрация перед обработкой, заливка демоном, вытеснение по таймеру, —
// и после них на экране оставалась прежняя картинка: файл уже лежит на диске, а
// нарисовано «только в облаке». Выглядит как «синхронизация не работает», хотя в
// индексе всё правильно.
//
// Rust эмитит `storage-changed` со списком путей; здесь мы сбрасываем кэш папок
// и просим колонки перечитаться — ровно то же, что делает меню после действия.

import { useEffect } from 'react';

import { invalidateDirCache } from '@/Store/helpers/readDirContent';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { dirname } from '@/Utils/path';
import { tauriAPI } from '@/Utils/tauri-api';
import { storage_store } from '@/Store/MainWin/storage_store';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { reloadFolders } from '@/PROCESSING/reloadFolders';

export function useStorageChanged(): void {
	useEffect(() => {
		const handler = (paths: string[]) => {
			if (!Array.isArray(paths) || paths.length === 0) return;

			// Событий может прийти пачка (вытеснение чистит десятки файлов) —
			// перечитываем каждую затронутую папку по одному разу.
			const dirs = Array.from(new Set(paths.map((p) => dirname(p))));
			for (const dir of dirs) invalidateDirCache(dir);

			const store = useColumnView_Store.getState();
			// Путь может быть открыт в любой из панелей, и знать в какой — не наша
			// забота: `refreshAffectedColumns` сам проверит, затронута ли колонка.
			store.refreshAffectedColumns('gd', dirs);
			store.refreshAffectedColumns('local', dirs);
		};

		const offFiles = tauriAPI.onStorageChanged(handler);

		// Список проектов: имя, архив, пауза, состав. Приходит отдельным событием —
		// архив и пауза живут в `projects` и в журнал изменений не попадают, значит
		// узнать о них можно только перечитав список.
		const offProjects = tauriAPI.onStorageProjectsChanged(() => {
			void (async () => {
				await storage_store.getState().refreshProjects();
				// Пересобираем список проектов у КАЖДОЙ облачной главной папки: оттуда же
				// подхватываются архивность и снятые галочки.
				const { mainFolderArr, updateParameters } = mainFolders_stor.getState();
				for (const f of mainFolderArr) {
					if (!f.online) continue;
					try {
						const projectFolders = await reloadFolders(f);
						updateParameters({ id: f.id, projectFolders });
					} catch (e) {
						console.error('[storage-projects-changed] не обновилась папка', f.path, e);
					}
				}
			})();
		});

		return () => {
			offFiles();
			offProjects();
		};
	}, []);
}
