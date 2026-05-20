// transcribeAudio — оригинал запускал whisper-cli бинарник рядом с плагином
// (plugins-dev/transcribeAudio/whisper/<platform>/whisper-cli). В Tauri-порте
// эта нативная зависимость пока не интегрирована. Плагин-заглушка: возвращает
// предупреждение и пустой результат, чтобы не падать в воркфлоу.
//
// TODO: реализовать через exec helper, найдя путь к whisper-cli (вероятно через
// resource resolver Tauri) + загрузка моделей в app_data.

import { sendToMW } from '../_template/tauri';

export { onLoad } from '../_template/tauri';

export async function transcribeAudioFunc(_item: any, _description: any): Promise<string[]> {
	const msg =
		'[transcribeAudio] плагин ещё не портирован под Tauri — нужна интеграция whisper-cli и моделей.';
	sendToMW('statusbar', { text: msg });
	sendToMW('log', { level: 'warn', text: msg });
	return [];
}
