import { joinPath } from '@/Utils/joinPath';

const api = window.electronAPI;

export async function getPresetsDir(_name: string): Promise<string> {
	const userData = await api.invoke<string>('getUserDataPath');
	return joinPath(userData, _name);
}
