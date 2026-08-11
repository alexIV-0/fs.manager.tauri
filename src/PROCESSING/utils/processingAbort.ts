// processingAbort.ts
//
// Сигналов прерывания ДВА, и это не дублирование:
//   • AbortController здесь — им пользуется TS-пайплайн (`getSignal()`);
//   • `AtomicBool` в Rust (`ProcessingState.abort_signal`) — его опрашивает
//     `exec_command` в своём цикле ожидания, чтобы прибить дочерний процесс.
//
// Кнопка «стоп» дёргает оба: `abortNow()` + `commands.abortProcessing()`.
// А вот сбрасывать Rust-флаг на старте прогона не делал никто: команда
// `resetProcessingSignal` существовала и была мёртвой, а флаг фактически гасился
// побочным эффектом внутри `exec_command`. Из-за этого один убитый процесс снимал
// глобальный стоп, и остальные параллельные его уже не видели. Теперь сброс живёт
// здесь — там, где выражено «начался новый прогон», и забыть его нельзя.

import { commands } from '@/Utils/specta';
import { RUN_PROCESSING } from '../runLanes';

let controller: AbortController | null = null;

export function startProcessContext() {
	controller = new AbortController();
	// Намеренно без await: старт прогона не должен ждать IPC. Ошибку глушим —
	// если хранилище состояния недоступно, пайплайн всё равно ведёт свой AbortController.
	void commands.resetProcessingSignal(RUN_PROCESSING).catch(() => {});
}

export function abortNow() {
	controller?.abort();
}

export function getSignal(): AbortSignal {
	if (!controller) {
		throw new Error('Process context not initialized');
	}
	return controller.signal;
}
