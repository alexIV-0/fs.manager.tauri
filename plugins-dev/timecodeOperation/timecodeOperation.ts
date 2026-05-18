import { sendToMW } from '../_template/pluginSender';

export { onLoad } from '../_template/pluginSender';

export async function timecodeOperationFunc(_item: any, _description: any) {
	const inputTc: unknown[] = _item.import?.inputFile ?? [];

	if (inputTc.length === 0) {
		sendToMW('log', { level: 'warn', text: 'timecodeOperation: нет входящего таймкода' });
		return [];
	}

	const mainTc = Number(inputTc[0]);
	const operation: string = _item.operation ?? '＋ Summ';

	// Второй аргумент: из подключённой ноды (таймкод в секундах) или из слайдера (число)
	const importedSlider: unknown[] = _item.import?.slider ?? [];
	const arg2 = importedSlider.length > 0
		? Number(importedSlider[0])
		: Number(_item.slider ?? 0);

	let result: number;

	switch (operation) {
		case '＋ Summ':
		case '－ Substract': {
			// Слайдер без подключения интерпретируется как секунды (дробные допустимы).
			// Работаем в миллисекундах чтобы избежать ошибок плавающей точки.
			const mainMs = Math.round(mainTc * 1000);
			const arg2Ms = Math.round(arg2 * 1000);
			result = (operation === '＋ Summ' ? mainMs + arg2Ms : mainMs - arg2Ms) / 1000;
			break;
		}
		case '✕ Multiply':
			result = mainTc * arg2;
			break;
		case '÷ Divide':
			if (arg2 === 0) {
				sendToMW('log', { level: 'error', text: 'timecodeOperation: деление на ноль' });
				return [];
			}
			result = mainTc / arg2;
			break;
		default:
			result = mainTc;
	}

	// Таймкод не может быть отрицательным; округляем до миллисекунд
	result = Math.round(Math.max(0, result) * 1000) / 1000;

	sendToMW('statusbar', `${_description.infoText}: [timecode op]\n${operation}`);
	sendToMW('log', { level: 'info', text: `timecodeOperation: ${mainTc}s ${operation} ${arg2} = ${result}s` });

	return [result];
}
