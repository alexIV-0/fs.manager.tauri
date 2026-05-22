import { joinPath } from '@/Utils/joinPath';
import { tauriAPI } from '@/Utils/tauri-api';

export async function getPresetsDir(_name: string): Promise<string> {
	const userData = await tauriAPI.invoke<string>('getUserDataPath');
	return joinPath(userData, _name);
}
