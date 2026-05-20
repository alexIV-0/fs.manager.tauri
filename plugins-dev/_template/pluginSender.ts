// pluginSender — мост для логов и событий из плагина в orchestrator.
//
// Tauri (новый путь): processItem перед каждым вызовом плагина выставляет
// `globalThis.__pluginSendToMW = ctx.sendToMW`. Плагин читает его на лету —
// это работает для последовательной обработки в рамках одного item.
//
// Для параллельной обработки (MAX_PARALLEL > 1) и одного плагина, вызываемого
// двумя items одновременно — теоретически возможна гонка: лог второго вызова
// может атрибуцироваться к ctx первого. Сейчас допускаем это; решается позже
// через AsyncContext / Zone-like.
//
// Electron (старый путь): main-процесс вызывает plugin.onLoad(api), где
// api.sendToMW использует AsyncLocalStorage. Оставляем для совместимости.

let _sendToMW: (type: string, payload: any) => void = () => {};

export function onLoad(api: any) {
	if (api?.sendToMW) _sendToMW = api.sendToMW;
}

export function sendToMW(type: string, payload: any) {
	const tauriSend = (globalThis as any).__pluginSendToMW as ((t: string, p: any) => void) | undefined;
	if (tauriSend) {
		tauriSend(type, payload);
		return;
	}
	_sendToMW(type, payload);
}
