/**
 * Базовый размер шрифта описания.
 *
 * Это НАСТРОЙКА ПРОСМОТРА, а не свойство документа: в файл она не попадает и на
 * сайт не уезжает — там своя типографика (контракт §8). Поэтому живёт в
 * localStorage, а не в markdown.
 *
 * Заголовки, код и подписи заданы в `em` от этого размера (`markdownProseSx`),
 * так что одна ручка тянет за собой всю типографику.
 */

import { useCallback, useState } from 'react';

const LS_KEY = 'descriptionFontSize';

/** Ступени — не произвольное число: соседние размеры должны заметно отличаться. */
export const FONT_SIZES = [14, 15, 16, 18, 20, 22] as const;

export const DEFAULT_FONT_SIZE = 16;

function read(): number {
	try {
		const raw = Number(localStorage.getItem(LS_KEY));
		return FONT_SIZES.includes(raw as (typeof FONT_SIZES)[number]) ? raw : DEFAULT_FONT_SIZE;
	} catch {
		return DEFAULT_FONT_SIZE;
	}
}

export function useDescriptionFontSize(): [number, (size: number) => void] {
	const [size, setSize] = useState(read);

	const update = useCallback((next: number) => {
		setSize(next);
		try {
			localStorage.setItem(LS_KEY, String(next));
		} catch {
			// приватный режим или переполненное хранилище — просто не запомним
		}
	}, []);

	return [size, update];
}
