// =========================================================================================
// вытаскиваем ID из имени файла. оно должно находиться в квадратных скобках в начале имени файла.
// возвращаем ID (даже если его нет, то вернем просто пустые кавычки) и чистое имя, без кавычек
// =========================================================================================
export function clearFileNameAndID(_str: string) {
	const patternSqBracket = /\[.*?\]/g;
	const matches = _str.match(patternSqBracket);

	const pattern = /\[.*?\]|\(.*?\)/g;
	const clearName = clearFileName(_str.replace(pattern, ''));
	let id = '';

	if (matches != null) {
		for (let i = 0; i < matches.length; i++) {
			const str = matches[i].substring(1, matches[i].length - 1);
			if (str.length >= 3) {
				id = str;
			}
		}
	}
	return { id: id, clearName: clearName };
}

// =========================================================================================
// функция убираем эмоджи из имени файла и возвращаем имя без лишних символов и без расширения
// =========================================================================================
export function clearFileName(_name: string) {
	let nameFile = '';
	if (_name.lastIndexOf('.') !== -1) {
		nameFile = _name.substring(0, _name.lastIndexOf('.'));
	} else {
		nameFile = _name;
	}

	// Убираем эмоджи и нежелательные символы, оставляя только буквы, цифры, пробелы и некоторые символы
	const nameF = nameFile.replace(/[^\p{L}\p{N}\s\[\]()._\-]/gu, '');

	// Нормализуем пробелы и обрезаем
	return nameF.replace(/\s+/g, ' ').trim();
}
