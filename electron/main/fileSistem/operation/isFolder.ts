import fs from 'fs';

export function isFolder(path: string) {
    try {
        const stats = fs.statSync(path);
        return stats.isDirectory();
    } catch (err) {
        return false;
    }
}
