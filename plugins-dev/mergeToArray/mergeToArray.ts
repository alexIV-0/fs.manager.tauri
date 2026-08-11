import { mergeAndFilterByType } from '../../src/Utils/mergeAndFilterByType';
import type { PluginContext } from '../../src/PluginAPI/host';


export async function mergeToArrayFunc(_item: any, _description: any, ctx: PluginContext) {
	const { sendToMW } = ctx;
	const finalFile = mergeAndFilterByType(_item.import ?? {}, Array.isArray(_item.addLink) ? _item.addLink : [], _description?.typeOfFile ?? {});

	sendToMW('statusbar', {
		text: `${_description.infoText}: [merge ${finalFile.length}]\n ${_description.curItem}`,
	});
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
