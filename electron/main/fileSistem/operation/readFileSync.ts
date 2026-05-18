import fs from 'fs';
export function readFileSync(path: string) {
	if (fs.existsSync(path)) {
		const file = fs.readFileSync(decodeURI(path), 'utf-8');
		return file;
	} else {
		return '';
	}
}
