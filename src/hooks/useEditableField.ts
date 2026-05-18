import { useState, useCallback, useEffect, ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

interface UseEditableFieldOptions {
	initialValue: string;
	onSave: (value: string) => void | Promise<void>;
}

export interface EditableFieldInputProps {
	value: string;
	autoFocus: boolean;
	onChange: (e: ChangeEvent<HTMLInputElement>) => void;
	onBlur: () => void;
	// HTMLElement — совместимо с TextField (onKeyDown получает HTMLDivElement)
	onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface UseEditableFieldReturn {
	isEditing: boolean;
	value: string;
	startEditing: () => void;
	cancelEditing: () => void;
	handleSave: () => void;
	inputProps: EditableFieldInputProps;
}

/**
 * Управляет состоянием inline-редактирования текстового поля.
 *
 * - Enter / onBlur → сохранение (вызов onSave), если значение изменилось и не пустое
 * - Escape → отмена, восстановление initialValue
 * - Синхронизирует value с initialValue при внешнем изменении (пока не в режиме редактирования)
 */
export function useEditableField({ initialValue, onSave }: UseEditableFieldOptions): UseEditableFieldReturn {
	const [isEditing, setIsEditing] = useState(false);
	const [value, setValue] = useState(initialValue);

	// Синхронизация при внешнем изменении initialValue (например, данные обновились снаружи)
	useEffect(() => {
		if (!isEditing) setValue(initialValue);
	}, [initialValue, isEditing]);

	const startEditing = useCallback(() => {
		setValue(initialValue);
		setIsEditing(true);
	}, [initialValue]);

	const cancelEditing = useCallback(() => {
		setValue(initialValue);
		setIsEditing(false);
	}, [initialValue]);

	const handleSave = useCallback(async () => {
		const trimmed = value.trim();
		if (!trimmed || trimmed === initialValue) {
			cancelEditing();
			return;
		}
		await onSave(trimmed);
		setIsEditing(false);
	}, [value, initialValue, onSave, cancelEditing]);

	const inputProps: EditableFieldInputProps = {
		value,
		autoFocus: true,
		onChange: (e) => setValue(e.target.value),
		onBlur: handleSave,
		onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
			if (e.key === 'Enter') handleSave();
			if (e.key === 'Escape') cancelEditing();
		},
	};

	return { isEditing, value, startEditing, cancelEditing, handleSave, inputProps };
}
