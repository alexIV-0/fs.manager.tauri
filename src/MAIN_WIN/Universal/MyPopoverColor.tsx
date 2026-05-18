import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { Box } from '@mui/material';
import { createPortal } from 'react-dom';

interface PopoverPickerProps {
	color: string;
	onChange: (color: string) => void;
	size?: number;
	popoverOffset?: [number, number]; // оставляем для обратной совместимости, но не используем
	onOpenChange?: (isOpen: boolean) => void;
}

const THROTTLE_MS = 80;

// Размеры пикера react-colorful (примерные, но стабильные)
const PICKER_WIDTH = 200;
const PICKER_HEIGHT = 200;
const PICKER_PADDING = 4; // внутренний padding обёртки
const MARGIN = 8; // отступ от края окна

export const MyPopoverColor = memo<PopoverPickerProps>(({ color, onChange, size = 30, onOpenChange }) => {
	const popoverRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLDivElement>(null);
	const [isOpen, setIsOpen] = useState(false);
	const [position, setPosition] = useState({ top: 0, left: 0 });

	// Локальный цвет для мгновенной отзывчивости пикера
	const [localColor, setLocalColor] = useState(color);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const lastEmitRef = useRef(0);
	const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Синхронизируем localColor с внешним color (когда пикер закрыт)
	useEffect(() => {
		if (!isOpen) setLocalColor(color);
	}, [color, isOpen]);

	// ── Flush при закрытии / unmount ─────────────────────────────────────────
	useEffect(() => {
		return () => {
			if (pendingRef.current) {
				clearTimeout(pendingRef.current);
				pendingRef.current = null;
			}
		};
	}, []);

	// ── Закрытие по клику вне ────────────────────────────────────────────────

	useEffect(() => {
		if (!isOpen) return;

		const listener = (event: MouseEvent | TouchEvent) => {
			const target = event.target as Node;
			if (popoverRef.current?.contains(target)) return;
			if (buttonRef.current?.contains(target)) return;
			setIsOpen(false);
			onOpenChange?.(false);
		};

		document.addEventListener('mousedown', listener);
		document.addEventListener('touchstart', listener);
		return () => {
			document.removeEventListener('mousedown', listener);
			document.removeEventListener('touchstart', listener);
		};
	}, [isOpen, onOpenChange]);

	// ── Открытие с умным позиционированием ───────────────────────────────────

	const handleOpen = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			e.preventDefault();

			if (!buttonRef.current) return;

			const rect = buttonRef.current.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;

			const totalW = PICKER_WIDTH + PICKER_PADDING * 2;
			const totalH = PICKER_HEIGHT + PICKER_PADDING * 2;

			// Пробуем открыть вниз-вправо (под кнопкой, правее)
			let top = rect.bottom + MARGIN;
			let left = rect.left;

			// Не хватает места снизу → открываем вверх
			if (top + totalH > vh - MARGIN) {
				top = rect.top - totalH - MARGIN;
			}

			// Не хватает места справа → сдвигаем влево
			if (left + totalW > vw - MARGIN) {
				left = vw - totalW - MARGIN;
			}

			// Не уходим за левый край
			if (left < MARGIN) {
				left = MARGIN;
			}

			// Не уходим за верхний край
			if (top < MARGIN) {
				top = MARGIN;
			}

			setPosition({ top, left });
			setIsOpen(true);
			onOpenChange?.(true);
		},
		[onOpenChange],
	);

	const handleColorChange = useCallback((newColor: string) => {
		setLocalColor(newColor);

		const now = Date.now();
		if (now - lastEmitRef.current >= THROTTLE_MS) {
			lastEmitRef.current = now;
			onChangeRef.current(newColor);
		} else {
			if (pendingRef.current) clearTimeout(pendingRef.current);
			pendingRef.current = setTimeout(() => {
				lastEmitRef.current = Date.now();
				onChangeRef.current(newColor);
				pendingRef.current = null;
			}, THROTTLE_MS);
		}
	}, []);

	return (
		<Box sx={{ ml: 1.5, position: 'relative', display: 'inline-block' }}>
			<Box
				ref={buttonRef}
				sx={{
					height: `${size}px`,
					aspectRatio: 1,
					borderRadius: '8px',
					border: '0.5px solid #fff',
					cursor: 'pointer',
					backgroundColor: localColor,
					flexShrink: 0,
				}}
				onClick={handleOpen}
			/>

			{isOpen &&
				createPortal(
					<Box
						ref={popoverRef}
						sx={{
							position: 'fixed',
							top: `${position.top}px`,
							left: `${position.left}px`,
							borderRadius: '9px',
							boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
							background: 'white',
							padding: `${PICKER_PADDING}px`,
							zIndex: 99999,
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<HexColorPicker color={localColor} onChange={handleColorChange} />
					</Box>,
					document.body,
				)}
		</Box>
	);
});
