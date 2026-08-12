// Какие проекты убраны в архив — чтобы колонка проектов могла это показать.
//
// ── Почему стор, а не проп ──────────────────────────────────────────────────
// Колонка проектов получает от главной папки только ИМЕНА (`projectFolders:
// string[]`) — так было всегда, и локальным папкам большего не нужно. Архивность
// же знает каталог хранилища, и тащить её через всю цепочку пропов ради значка
// значило бы менять форму данных у всех, включая локальные папки.
//
// Ключ — путь проекта в нижнем регистре: на macOS файловая система
// регистро-нечувствительна, а сравнение строк нет, и `.../Test 1` с `.../test 1`
// иначе оказались бы разными проектами.
//
// Наполняется в `reloadFolders` (он и так читает каталог зеркала на каждом
// проходе), поэтому отдельного запроса значок не стоит.

import { create } from 'zustand';

interface ArchivedProjectsState {
	/** path в нижнем регистре → true. Отсутствие ключа = не архивный. */
	paths: Record<string, true>;
	/** Заменить набор архивных для одной главной папки. */
	setForMainFolder: (mainFolderPath: string, archivedPaths: string[]) => void;
	isArchived: (path: string) => boolean;
}

const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();

export const archivedProjects_store = create<ArchivedProjectsState>((set, get) => ({
	paths: {},

	setForMainFolder: (mainFolderPath, archivedPaths) =>
		set((s) => {
			// Чистим прежние записи ЭТОЙ папки и кладём новые: проект могли
			// разархивировать, и тогда старая запись врала бы значком.
			const prefix = norm(mainFolderPath) + '/';
			const next: Record<string, true> = {};
			for (const key of Object.keys(s.paths)) {
				if (!key.startsWith(prefix)) next[key] = true;
			}
			for (const p of archivedPaths) next[norm(p)] = true;
			return { paths: next };
		}),

	isArchived: (path) => Boolean(get().paths[norm(path)]),
}));
