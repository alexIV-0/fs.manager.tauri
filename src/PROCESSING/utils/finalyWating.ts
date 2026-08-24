import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { useStatusBar_Store } from '@/Store/Processing/useStatusBar_Store';
import { getSignal } from './processingAbort';
import { formatNameByPattern } from '@/Utils/formatNameByPattern';

function formatTime(seconds: number) {
	const total = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(total / 60);
	const secs = total % 60;
	const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
	const ss = secs < 10 ? `0${secs}` : `${secs}`;
	return `waiting: ${mm}:${ss}`;
}

export async function finalyWating(timeAEprocess: number) {
	const { setStatusBarState } = useStatusBar_Store.getState();
	const signal = getSignal();

	const dateTime = formatNameByPattern({ string: '$DD.$MM-$HH.$mm' });

	if (!isScanningStore.getState().isScanning) {
		console.warn(`=== without waiting === ${dateTime}`);
		return;
	}

	console.warn(`=== ${formatTime((timeAEprocess - 1000) / 1000)} === ${dateTime}`);

	const endTime = Date.now() + timeAEprocess;

	await new Promise<void>((resolve, reject) => {
		let uiTick: ReturnType<typeof setInterval> | null = null;
		let mainTimer: ReturnType<typeof setTimeout> | null = null;
		let settled = false;

		const onAbort = () => finish('abort');

		const cleanup = () => {
			if (uiTick) clearInterval(uiTick);
			if (mainTimer) clearTimeout(mainTimer);
			uiTick = null;
			mainTimer = null;
			// Слушателя снимаем и при НОРМАЛЬНОМ завершении ожидания. `{ once: true }`
			// сам его не убирает, если abort не случился: сигнал живёт весь прогон, а
			// ожидание в нём — каждый цикл, поэтому за длинный прогон на одном сигнале
			// накапливался слушатель на цикл.
			signal.removeEventListener('abort', onAbort);
		};

		const finish = (mode: 'resolve' | 'abort') => {
			if (settled) return;
			settled = true;
			cleanup();
			setStatusBarState('ready to start');
			if (mode === 'abort') reject(new DOMException('Aborted', 'AbortError'));
			else resolve();
		};

		if (signal.aborted) {
			finish('abort');
			return;
		}
		signal.addEventListener('abort', onAbort, { once: true });

		// UI-тик: обновляем статус-бар примерно раз в секунду. Если в фоне Chromium
		// его дросселирует — не критично, главный таймер ниже отработает корректно.
		uiTick = setInterval(() => {
			if (settled) return;
			if (!isScanningStore.getState().isScanning) {
				finish('resolve');
				return;
			}
			const remaining = Math.max(0, endTime - Date.now());
			setStatusBarState(formatTime(remaining / 1000));
		}, 1000);

		// Главный таймер — один setTimeout на всё ожидание. Это надёжнее, чем
		// рекурсивный 1-сек тик: один долгий таймер устойчивее к background-тротлингу
		// (а с backgroundThrottling=false он не тротлится вовсе).
		mainTimer = setTimeout(() => finish('resolve'), timeAEprocess);
	});
}
