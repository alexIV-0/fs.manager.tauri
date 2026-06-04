import { joinPath } from '@/Utils/joinPath';
import { commands, unwrap } from '@/Utils/specta';

export async function getPresetsDir(_name: string): Promise<string> {
	const userData = unwrap(await commands.getUserDataPath());
	return joinPath(userData, _name);
}
