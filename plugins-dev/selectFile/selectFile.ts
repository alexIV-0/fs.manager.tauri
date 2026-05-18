import path from 'path';
import { sendToMW } from '../_template/pluginSender';

export { onLoad } from '../_template/pluginSender';

export async function selectFileFunc(_item: any, _description: any) {
	const rawPath: string = _item.pathNavigator;
	const filePath = path.isAbsolute(rawPath) ? rawPath : path.join(_description.projectPathGD, rawPath);

	sendToMW('statusbar', {
		text: `${_description.infoText}: [select file]\n ${filePath}`,
	});
	sendToMW('log', { level: 'info', text: `Result:\n${filePath}` });

	return [filePath];
}
