// Единый реестр нод-постеров: pluginId → платформа.
//
// Платформа НЕ хранится в сайдкаре отдельным полем — граф уже связывает Finder с Poster'ом
// конкретной площадки, и эта связь лежит в скомпилированном pipeline. И writer сайдкара
// (для извлечения account), и драйвер (для дедупа/тайминга интервала) выводят платформу
// из того, КАКОЙ Poster стоит в пайплайне finder'а. Добавление площадки = одна строка тут.
//
// ВАЖНО: значение платформы должно совпадать с тем, что Poster-нода пишет в PostRecord.platform
// (константа PLATFORM в самой ноде), иначе дедуп/интервал не сматчатся с логом.

export const POSTER_PLATFORM: Record<string, string> = {
	autoPostVK: 'vk',
	autoPostYT: 'youtube',
	// autoPostTG: 'tg',
};

/** Найти Poster-объект в скомпилированном пайплайне finder'а (первый известный по pluginId). */
export function findPoster(pipeline: any[]): any | null {
	if (!Array.isArray(pipeline)) return null;
	return pipeline.find((o) => o?.pluginId && POSTER_PLATFORM[o.pluginId]) ?? null;
}

/** Платформа finder-маршрута = платформа Poster-ноды в его пайплайне. Дефолт 'vk' (легаси). */
export function platformFromPipeline(pipeline: any[]): string {
	const poster = findPoster(pipeline);
	return poster ? POSTER_PLATFORM[poster.pluginId] : 'vk';
}
