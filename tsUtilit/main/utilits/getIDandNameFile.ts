import { clearFileName } from './clearFileName';
// =========================================================================================
/**
 * Извлекает содержимое первых квадратных скобок в начале имени файла
 * Возвращает объект с ID (содержимым первых скобок) и очищенным именем файла
 * Если скобок нет в начале - возвращает пустой ID
 */
// =========================================================================================

interface FileIdAndName {
    id: string;
    clearName: string;
}

export function getIDandNameFile(fileName: string): FileIdAndName {
    let id = '';

    // Ищем первые квадратные скобки именно в начале строки
    const firstBracketMatch = fileName.match(/^\[(.*?)\]/);

    if (firstBracketMatch) {
        id = firstBracketMatch[1]; // Содержимое скобок
    }

    // Удаляем только первые квадратные скобки и очищаем имя
    const nameWithoutFirstBrackets = fileName.replace(/^\[.*?\]/, '');
    const clearName = clearFileName(nameWithoutFirstBrackets);

    return { id, clearName };
}
