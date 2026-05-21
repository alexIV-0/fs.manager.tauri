import fs from 'fs';
import path from 'path';

export async function saveFlowToOptionsFolder(pathToFolder: string, flow: any) {
	const finalPath = path.join(pathToFolder, 'options', 'options.json');
	fs.writeFileSync(finalPath, JSON.stringify(flow, null, 2), 'utf-8');
	return true;
}
