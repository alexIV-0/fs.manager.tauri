/**
 * Преобразует таймкод (строку вида "00:01:30", "01:30", "90" и т.п.) в секунды.
 * Поддерживает форматы:
 *   - "HH:MM:SS"      → 3600*H + 60*M + S
 *   - "MM:SS"          → 60*M + S
 *   - "SS" или число   → просто секунды
 *   - "HH:MM:SS:FF"   → кадры игнорируются (или можно учесть через fps)
 */
export function convertTimecodeToSeconds(value: unknown): number {
	if (value === null || value === undefined || value === '') return 0;

	// Если уже число — возвращаем как есть
	if (typeof value === 'number') return value;

	const str = String(value).trim();
	if (str === '') return 0;

	// Пробуем просто распарсить как число (например, "90" или "90.5")
	const asNum = Number(str);
	if (!isNaN(asNum) && str !== '') return asNum;

	// Разбиваем по ":"
	const parts = str.split(':').map((p) => parseFloat(p) || 0);

	switch (parts.length) {
		case 1:
			// "SS"
			return parts[0];
		case 2:
			// "MM:SS"
			return parts[0] * 60 + parts[1];
		case 3:
			// "HH:MM:SS"
			return parts[0] * 3600 + parts[1] * 60 + parts[2];
		case 4:
			// "HH:MM:SS:FF" — кадры игнорируем (для точности нужен fps)
			return parts[0] * 3600 + parts[1] * 60 + parts[2];
		default:
			return 0;
	}
}
