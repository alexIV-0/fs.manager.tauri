import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';


export async function selectFileFunc(_item: any, _description: any, ctx: PluginContext) {
	const { sendToMW } = ctx;
	const rawPath: string = _item.pathNavigator;
	const filePath = path.isAbsolute(rawPath) ? rawPath : path.join(_description.projectPathGD, rawPath);

	sendToMW('statusbar', {
		text: `${_description.infoText}: [select file]\n ${filePath}`,
	});
	sendToMW('log', { level: 'info', text: `Result:\n${filePath}` });

	return [filePath];
}
