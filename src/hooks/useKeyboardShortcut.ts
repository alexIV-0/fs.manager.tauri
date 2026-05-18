import { useEffect, useRef } from 'react';

interface UseKeyboardShortcutOptions {
	/** Клавиша или массив клавиш (e.key) */
	key: string | string[];
	/** Функция, вызываемая при срабатывании */
	callback: (e: KeyboardEvent) => void;
	/** Включён ли слушатель. При false — не вешается. Default: true */
	enabled?: boolean;
	/** Тип события. Default: 'keydown' */
	eventType?: 'keydown' | 'keyup';
	/** Цель подписки. Default: 'window' */
	target?: 'window' | 'document';
	/** Пропускать событие, если фокус в INPUT/TEXTAREA. Default: true */
	skipOnInput?: boolean;
	/** Обязательные модификаторы */
	modifiers?: {
		/** Ctrl (Windows) или Cmd (Mac) */
		ctrlOrMeta?: boolean;
		shift?: boolean;
		alt?: boolean;
	};
}

/**
 * Подписывается на глобальное событие клавиатуры и вызывает callback при совпадении.
 *
 * Callback всегда актуален (через ref) — не требует перечисления
 * внешних зависимостей, только флаги подписки (enabled, eventType, target).
 */
export function useKeyboardShortcut({
	key,
	callback,
	enabled = true,
	eventType = 'keydown',
	target = 'window',
	skipOnInput = true,
	modifiers,
}: UseKeyboardShortcutOptions): void {
	const callbackRef = useRef(callback);
	callbackRef.current = callback;

	const keyRef = useRef(key);
	keyRef.current = key;

	const modifiersRef = useRef(modifiers);
	modifiersRef.current = modifiers;

	useEffect(() => {
		if (!enabled) return;

		const handler = (e: KeyboardEvent) => {
			const keys = Array.isArray(keyRef.current) ? keyRef.current : [keyRef.current];
			if (!keys.includes(e.key)) return;

			const mods = modifiersRef.current;
			if (mods?.ctrlOrMeta !== undefined && mods.ctrlOrMeta !== (e.ctrlKey || e.metaKey)) return;
			if (mods?.shift !== undefined && mods.shift !== e.shiftKey) return;
			if (mods?.alt !== undefined && mods.alt !== e.altKey) return;

			if (skipOnInput) {
				const active = document.activeElement as HTMLElement | null;
				const tag = active?.tagName;
				// Пропускаем, если фокус в INPUT/TEXTAREA
				if (tag === 'INPUT' || tag === 'TEXTAREA') return;
				// Пропускаем, если элемент contentEditable (RichTextEditor и т.п.)
				if (active?.isContentEditable) return;
				// Пропускаем, если фокус внутри модального окна (MUI Dialog/Modal)
				if (active?.closest('[role="dialog"]') || active?.closest('.MuiDialog-root') || active?.closest('.MuiModal-root'))
					return;
			}

			callbackRef.current(e);
		};

		const el: EventTarget = target === 'document' ? document : window;
		el.addEventListener(eventType, handler as EventListener);
		return () => el.removeEventListener(eventType, handler as EventListener);
	}, [enabled, eventType, target, skipOnInput]);
}
