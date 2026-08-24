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
//
// ── Контроллер НА ПОЛОСУ ────────────────────────────────────────────────────
//
// Контроллер был один на модуль, пока по этому файлу ходил один раннер. Теперь их
// два: локальный прогон и режим воркера, и работают они одновременно. С единственным
// контроллером старт воркера подменял бы объект под идущей обработкой (её шаги
// остались бы со старым сигналом, а `abortNow` дёргал бы новый — стоп перестал бы
// работать вовсе), а аварийный стоп воркера убивал бы локальную обработку заодно.
// Ключ — то же имя полосы, что уходит в Rust: один ключ на оба сигнала, разъехаться
// им негде. Полоса по умолчанию — обработка: её зовут из десятка мест, и там, где
// полоса одна, о ней можно не думать.

import { commands } from '@/Utils/specta';
import { RUN_PROCESSING, type RunLane } from '../runLanes';

const controllers = new Map<string, AbortController>();

export function startProcessContext(lane: RunLane = RUN_PROCESSING) {
	controllers.set(lane, new AbortController());
	// Намеренно без await: старт прогона не должен ждать IPC. Ошибку глушим —
	// если хранилище состояния недоступно, пайплайн всё равно ведёт свой AbortController.
	void commands.resetProcessingSignal(lane).catch(() => {});
}

export function abortNow(lane: RunLane = RUN_PROCESSING) {
	controllers.get(lane)?.abort();
}

export function getSignal(lane: RunLane = RUN_PROCESSING): AbortSignal {
	const controller = controllers.get(lane);
	if (!controller) {
		throw new Error(`Process context not initialized (полоса ${lane})`);
	}
	return controller.signal;
}
