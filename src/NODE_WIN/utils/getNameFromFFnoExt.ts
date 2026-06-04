import { basename, extname } from '@/Utils/path';

export async function getNameFromFFnoExt(path: string) {
	const ext = extname(path);
	const name = basename(path);
	if (!ext) return name;
	return name.slice(0, name.length - ext.length);
}
