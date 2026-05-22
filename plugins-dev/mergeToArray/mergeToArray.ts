import { mergeAndFilterByType } from '../../src/Utils/mergeAndFilterByType';
import { sendToMW } from '../_template/pluginSender';

export { onLoad } from '../_template/pluginSender';

export async function mergeToArrayFunc(_item: any, _description: any) {
	const finalFile = mergeAndFilterByType(_item.import ?? {}, Array.isArray(_item.addLink) ? _item.addLink : [], _description?.typeOfFile ?? {});

	sendToMW('statusbar', {
		text: `${_description.infoText}: [merge ${finalFile.length}]\n ${_description.curItem}`,
	});
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
