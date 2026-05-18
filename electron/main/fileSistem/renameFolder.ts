import fs from 'fs';

export async function renameFolder(oldPath: string, newPath: string) {
	if (!fs.existsSync(oldPath)) return false;
	if (fs.existsSync(newPath)) return false;
	fs.renameSync(oldPath, newPath);
	return true;
}
