import { typeOfFile_store } from '@/Store/MainWin/pathPattern_store';

// Явные исключения — значения которых нет в сторе как расширения
const resolveException = (value: string): string => {
	switch (value.toLowerCase()) {
		case 'jsonfull':
			return 'json';
		case 'vtt':
			return 'txt';
		// добавляй сюда новые исключения по мере необходимости
		default:
			return value.toLowerCase();
	}
};

// Извлекает расширение из строк вроде "MOV (ProRes alpha-ALAC)" → "mov"
const extractExtensionFromFormat = (value: string): string => {
	const match = value.match(/^([A-Za-z0-9]+)/);
	return match ? match[1].toLowerCase() : value.toLowerCase();
};

export function resolveTypeByExtension(value: string): { label: string; color: string } {
	if (!value) return { label: '', color: 'default' };

	let normalized = resolveException(value);
	const typeOfFileStore = typeOfFile_store.getState().patternStore;

	let fileType = typeOfFileStore.find((type) => type.path && Array.isArray(type.path) && type.path.includes(normalized));

	// Если не найдено прямое совпадение, пытаемся извлечь расширение из формата (для "MOV (ProRes...)" → "mov")
	if (!fileType) {
		const extracted = extractExtensionFromFormat(value);
		fileType = typeOfFileStore.find((type) => type.path && Array.isArray(type.path) && type.path.includes(extracted));
	}

	if (fileType) {
		return { label: fileType.name, color: fileType.name };
	}

	return { label: value, color: 'default' };
}
