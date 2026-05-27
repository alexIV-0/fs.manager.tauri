// columnFocusStyle.ts
// Единая настройка рамки колонок главного окна.
// Меняй цвета здесь — применяется сразу ко всем колонкам
// (главная, проекты, содержимое+локальное).
import { greyColor } from '@/Store/Color/grayColor';

// Рамка колонки в обычном состоянии.
export const COLUMN_BORDER_COLOR = greyColor(80);

// Рамка колонки, когда она в фокусе клавиатуры (бледно-голубая).
export const COLUMN_FOCUS_BORDER_COLOR = 'rgba(120,180,255,0.7)';

// Готовая border-строка для контейнера колонки в зависимости от фокуса.
export const columnBorder = (focused: boolean) =>
	`1px solid ${focused ? COLUMN_FOCUS_BORDER_COLOR : COLUMN_BORDER_COLOR}`;
