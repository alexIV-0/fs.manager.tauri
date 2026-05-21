import fs from 'fs';

export function isFile(path: string) {
    try {
        const stats = fs.statSync(path);
        return stats.isFile(); // ← изменили здесь
    } catch (err) {
        return false; // Если возникла ошибка (файл не существует и т.д.)
    }
}
