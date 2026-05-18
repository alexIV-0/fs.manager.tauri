export async function getNameFromFFnoExt(path: string) {
	const ext = (await window.electronAPI.invoke('pathExtname', path)) as string;
	const name = (await window.electronAPI.invoke('pathBasename', path)) as string;
	if (!ext) return name;
	return name.slice(0, name.length - ext.length);
}
