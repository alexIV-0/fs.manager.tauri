// columnFocus_store.ts
// Какая из четырёх логических колонок главного окна сейчас "в фокусе"
// для управления с клавиатуры (стрелки / Tab):
//   'main'    — главная колонка (список main-папок)
//   'project' — колонка проектов (подпапки активной main)
//   'gd'      — верхняя панель содержимого проекта (Miller-колонки)
//   'local'   — нижняя панель локального хранилища проекта (Miller-колонки)
import { create } from 'zustand';

export type FocusedColumn = 'main' | 'project' | 'gd' | 'local';

// Порядок обхода по Tab / Shift+Tab и стрелками влево-вправо.
export const COLUMN_ORDER: FocusedColumn[] = ['main', 'project', 'gd', 'local'];

type ColumnFocusStore = {
	focusedColumn: FocusedColumn;
	setFocusedColumn: (c: FocusedColumn) => void;
};

export const useColumnFocus_store = create<ColumnFocusStore>((set) => ({
	focusedColumn: 'main',
	setFocusedColumn: (c) => set({ focusedColumn: c }),
}));
