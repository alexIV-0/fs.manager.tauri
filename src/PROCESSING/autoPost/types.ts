// Типы отвязанного автопостинга (см. ideasAndTest/UNIFIED_SOURCES_ENGINE.md).
// Маршрут = один Finder (нода-источник) + его скомпилированный пайплайн (Finder→Poster→…),
// который драйвер исполняет через processItem.

export interface PostRoute {
	projectPath: string; // абсолютный путь к папке проекта (GD)
	projectName: string;
	mainFolder: string; // имя главной папки
	mainFolderPath: string; // абсолютный путь главной папки (для description)
	finderId: string; // id ноды-источника (корень пайплайна, queue[0])
	folder: string; // папка-источник (напр. VK_post)
	searchType: string; // тип файлов (video/photo/...)
	order: string; // by Time | by Name | Random
	interval: number; // сек между постами (капля)
	daysOfWeek: string[]; // ['Mon',...]; пусто = все дни
	window: [number, number]; // [startMin, endMin] суток
	deleteAfter: boolean; // удалить исходник после успешного графа (читает processItem)
	account: string; // аккаунт (из ноды Poster) — для тайминга интервала
	platform: string; // площадка (vk|youtube|tg…) — ключ дедупа и тайминга интервала (дефолт 'vk')
	pipeline: any[]; // скомпилированная очередь execution-объектов (createProcessQueue output)
	baseDescription: Record<string, any>; // getDescription(flow) — запечён при сохранении
}

// Запись в лог постинга (options/_post/$MM.$YYYY.jsonl). Пишет нода Poster; читает драйвер.
export interface PostRecord {
	ts: number;
	publishedAt: number;
	project?: string;
	platform: string;
	account: string;
	file: string;
	mode: string;
	ownerId?: number;
	videoId?: number;
	postId?: number;
	permalink: string;
	status: string;
}
