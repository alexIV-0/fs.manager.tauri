import fs from 'fs';
import { isFolder } from './isFolder';

export function deleteFolder(_path: string) {
	// if (fs.existsSync(_path) && isFolder(_path)) {
	fs.rmSync(_path, { recursive: true, force: true });
	console.log('Папку удалили ', _path);
	// }
}
