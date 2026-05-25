// pluginSender — мост для логов и событий из плагина в orchestrator.
//
// Каждый плагин при сборке (esbuild bundle:true) получает свою копию этого файла,
// значит свою module-local `_sendToMW`. processItem.ts перед вызовом плагина
// дёргает pluginModule.onLoad({ sendToMW }), который сохраняет per-execution
// sendToMW в `_sendToMW`. Для устранения гонок при MAX_PARALLEL > 1 и нескольких
// одновременных вызовах ОДНОГО плагина — loader.ts делает cache-bust по
// execToken и создаёт свежий module-instance на каждый вызов.

let _sendToMW: (type: string, payload: any) => void = () => {};

export function onLoad(api: any) {
	if (api?.sendToMW) _sendToMW = api.sendToMW;
}

export function sendToMW(type: string, payload: any) {
	_sendToMW(type, payload);
}
