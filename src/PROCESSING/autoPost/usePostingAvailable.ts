import { useHasAnyPlugin } from '@/Store/MainWin/plugin_store';
import { POSTER_PLATFORM } from './posters';

// id плагина-источника (нода-«корень» постинг-пайплайна).
// В графе finder опознаётся по node.type === 'finder' (== pluginId).
const FINDER_PLUGIN_ID = 'finder';

/**
 * Постинг имеет смысл только когда собирается пайплайн `finder → poster`:
 * нужен плагин-источник `finder` И хотя бы один плагин-постер (любой из POSTER_PLATFORM).
 * Если пропало любое из звеньев — раннер всё равно не соберёт маршрут, поэтому UI
 * постинга (кнопку START POSTING, статус-строку, секцию настроек «Постинг») прячем.
 *
 * Реактивно: при включении/выключении/удалении плагина значение пересчитается само.
 * Добавление новой площадки постинга не требует правок здесь — только строку в POSTER_PLATFORM.
 */
export const usePostingAvailable = (): boolean => {
	const hasFinder = useHasAnyPlugin([FINDER_PLUGIN_ID]);
	const hasAnyPoster = useHasAnyPlugin(Object.keys(POSTER_PLATFORM));
	return hasFinder && hasAnyPoster;
};
