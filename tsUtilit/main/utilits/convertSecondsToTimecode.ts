/*
	конвертируем время в секундах (из АЕ с учетом fps) в таймкод
*/
export function convertSecondsToTimecode(seconds: number, fps?: number) {
	// Общий расчёт времени
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);

	let frameOrMillis;
	if (fps !== undefined) {
		// Расчёт кадра
		frameOrMillis = Math.round((seconds % 1) * fps);
	} else {
		// Расчёт миллисекунд
		frameOrMillis = Math.round((seconds % 1) * 1000);
	}

	// Форматирование в строку
	const timecodeParts = [String(hours).padStart(2, '0'), String(minutes).padStart(2, '0'), String(secs).padStart(2, '0')];

	const timecode = timecodeParts.join(':');

	// Добавляем миллисекунды через запятую, если fps не указан
	if (fps === undefined) {
		return `${timecode},${String(frameOrMillis).padStart(3, '0')}`;
	} else {
		return `${timecode}:${String(frameOrMillis).padStart(2, '0')}`;
	}
}
