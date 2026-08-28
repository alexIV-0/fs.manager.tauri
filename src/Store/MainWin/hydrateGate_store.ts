// Прогресс подготовки файлов перед файловой операцией — состояние для оверлея.
//
// ── Почему стор, а не состояние компонента ──────────────────────────────────
// Копирование зовут откуда угодно: пункт меню файла, пункт меню папки, Ctrl+V,
// перетаскивание. Все эти точки входа — обычные функции (`fileSystemActions`), а
// не компоненты, и своего места на экране у них нет. Стор даёт им одно окно на
// всех: оверлей висит в `AppMain` и рисует то, что здесь лежит.
//
// Отмена живёт здесь же и читается циклом гидрации между файлами: прерывать
// начатую передачу посреди файла незачем — она докачается и ляжет в зеркало.

import { create } from 'zustand';

interface HydrateGateState {
	/** Идёт подготовка — оверлей на экране. */
	active: boolean;
	/** Что именно готовим: «Копирование», «Перемещение». */
	title: string;
	/** Всего файлов к скачиванию и всего байт — числа из плана, они не меняются. */
	total: number;
	bytes: number;
	done: number;
	failed: number;
	bytesDone: number;
	/** Имя файла, который едет прямо сейчас. */
	current: string;
	/** Нажали «Отменить»: цикл остановится, не начиная следующий файл. */
	cancelled: boolean;

	start: (p: { title: string; total: number; bytes: number }) => void;
	setCurrent: (name: string) => void;
	advance: (p: { bytes: number; ok: boolean }) => void;
	cancel: () => void;
	stop: () => void;
}

export const hydrateGate_store = create<HydrateGateState>((set) => ({
	active: false,
	title: '',
	total: 0,
	bytes: 0,
	done: 0,
	failed: 0,
	bytesDone: 0,
	current: '',
	cancelled: false,

	start: ({ title, total, bytes }) =>
		set({ active: true, title, total, bytes, done: 0, failed: 0, bytesDone: 0, current: '', cancelled: false }),

	setCurrent: (current) => set({ current }),

	advance: ({ bytes, ok }) =>
		set((s) => ({
			done: s.done + 1,
			failed: ok ? s.failed : s.failed + 1,
			bytesDone: s.bytesDone + bytes,
		})),

	cancel: () => set({ cancelled: true }),

	stop: () => set({ active: false, current: '' }),
}));
