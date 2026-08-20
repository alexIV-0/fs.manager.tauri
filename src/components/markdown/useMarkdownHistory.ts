/**
 * Отмена/возврат для редактора описания.
 *
 * Зачем своя история, если у `textarea` есть браузерная: как только значение
 * подменяется программно (а тулбар делает именно это), нативный стек отмены
 * обнуляется — ⌘Z начинает возвращать пустоту или прыгать. Та же причина, по
 * которой в канвасе нод живёт `useUndoRedo`; параметры взяты оттуда же:
 * дебаунс 400 мс = один шаг, глубина 50.
 *
 * `present` держим ещё и в ref: при зажатом ⌘Z состояние из стора приходит
 * с задержкой, и шаг проскакивает.
 */

import { useCallback, useRef, useState } from 'react';
import type { TextState } from './markdownCommands';

const DEBOUNCE_MS = 400;
const DEPTH = 50;

export interface MarkdownHistory {
	state: TextState;
	/** Растёт, когда текст изменён программно — редактору пора вернуть выделение. */
	syncKey: number;
	/** Печать пользователя: складывается в один шаг отмены по дебаунсу. */
	type: (next: TextState) => void;
	/** Кнопка тулбара: отдельный шаг отмены сразу. */
	commit: (next: TextState) => void;
	undo: () => void;
	redo: () => void;
	canUndo: boolean;
	canRedo: boolean;
	/** Загрузка файла: новое содержимое без истории. */
	reset: (value: string) => void;
}

export function useMarkdownHistory(initial: string): MarkdownHistory {
	const [state, setState] = useState<TextState>({ value: initial, selStart: 0, selEnd: 0 });
	const [syncKey, setSyncKey] = useState(0);
	const [canUndo, setCanUndo] = useState(false);
	const [canRedo, setCanRedo] = useState(false);

	const present = useRef<TextState>(state);
	const past = useRef<TextState[]>([]);
	const future = useRef<TextState[]>([]);
	// Состояние до начала текущей серии правок — оно и уйдёт в историю.
	const pending = useRef<TextState | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const flags = useCallback(() => {
		setCanUndo(past.current.length > 0 || pending.current !== null);
		setCanRedo(future.current.length > 0);
	}, []);

	const push = useCallback(
		(snapshot: TextState) => {
			past.current = [...past.current.slice(-(DEPTH - 1)), snapshot];
			future.current = [];
			flags();
		},
		[flags],
	);

	/** Досрочно закрыть незавершённую серию правок (перед отменой или кнопкой). */
	const flush = useCallback(() => {
		if (timer.current) {
			clearTimeout(timer.current);
			timer.current = null;
		}
		if (pending.current) {
			push(pending.current);
			pending.current = null;
		}
	}, [push]);

	const type = useCallback(
		(next: TextState) => {
			if (next.value !== present.current.value) {
				if (!pending.current) pending.current = present.current;
				if (timer.current) clearTimeout(timer.current);
				timer.current = setTimeout(() => {
					timer.current = null;
					if (pending.current) {
						push(pending.current);
						pending.current = null;
					}
				}, DEBOUNCE_MS);
			}
			present.current = next;
			setState(next);
			flags();
		},
		[flags, push],
	);

	const commit = useCallback(
		(next: TextState) => {
			flush();
			if (next.value !== present.current.value) push(present.current);
			present.current = next;
			setState(next);
			setSyncKey((k) => k + 1);
			flags();
		},
		[flags, flush, push],
	);

	const undo = useCallback(() => {
		flush();
		const prev = past.current.pop();
		if (!prev) {
			flags();
			return;
		}
		future.current = [present.current, ...future.current];
		present.current = prev;
		setState(prev);
		setSyncKey((k) => k + 1);
		flags();
	}, [flags, flush]);

	const redo = useCallback(() => {
		const [next, ...rest] = future.current;
		if (!next) return;
		future.current = rest;
		past.current = [...past.current, present.current];
		present.current = next;
		setState(next);
		setSyncKey((k) => k + 1);
		flags();
	}, [flags]);

	const reset = useCallback(
		(value: string) => {
			if (timer.current) {
				clearTimeout(timer.current);
				timer.current = null;
			}
			pending.current = null;
			past.current = [];
			future.current = [];
			const fresh = { value, selStart: 0, selEnd: 0 };
			present.current = fresh;
			setState(fresh);
			setSyncKey((k) => k + 1);
			setCanUndo(false);
			setCanRedo(false);
		},
		[],
	);

	return { state, syncKey, type, commit, undo, redo, canUndo, canRedo, reset };
}
