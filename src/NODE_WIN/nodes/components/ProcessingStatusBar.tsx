import { greyColor, steelColor } from '@/Store/Color/grayColor';
import { useProcessingStatus_store } from '@/Store/Node/useProcessingStatus_store';
import { Box, IconButton, Typography } from '@mui/material';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function ProcessingStatusBar() {
	const { statusText, isRunning, resetAll } = useProcessingStatus_store();
	const [visible, setVisible] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Единый эффект показа/автоскрытия. Раньше показ и скрытие жили в двух
	// эффектах и дрались за один timerRef: эффект показа делал clearTimeout на
	// каждое изменение statusText, а автоскрытие перезаводилось только по смене
	// isRunning. Поздний statusbar-ивент в конце обработки (напр. 'waiting
	// starting' из startProcessing) убивал таймер скрытия и не перезаводил его —
	// бар оставался висеть пустым. Здесь логика собрана в одном месте.
	useEffect(() => {
		const clearTimer = () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};

		// Идёт обработка → показываем бар, отменяем любое автоскрытие.
		if (isRunning) {
			setVisible(true);
			clearTimer();
			return;
		}

		// Обработка завершена. Есть финальный текст — показываем его напоследок.
		if (statusText) setVisible(true);

		// Заводим автоскрытие через 3 сек. Таймер перезаводится на каждое позднее
		// статус-событие, поэтому бар прячется через 3 сек после ПОСЛЕДНЕЙ
		// активности, а не зависает пустым.
		if (visible || statusText) {
			clearTimer();
			timerRef.current = setTimeout(() => {
				setVisible(false);
				resetAll();
				timerRef.current = null;
			}, 3000);
		}
	}, [isRunning, statusText, visible]);

	// чистим таймер при размонтировании
	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);

	if (!visible) return null;

	return (
		<Box
			sx={{
				position: 'fixed',
				bottom: 0,
				left: 0,
				right: 0,
				zIndex: 9999,
				backgroundColor: greyColor(12),
				borderTop: `1px solid ${steelColor(40)}`,
				boxShadow: `0 -4px 20px ${greyColor(5)}`,
				px: 2,
				py: 0.75,
			}}
		>
			<Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mt: 0.25 }}>
				<Typography
					sx={{
						flex: 1,
						fontSize: '1.1rem',
						color: typeof statusText === 'string' && statusText.startsWith('❌') ? '#ef9a9a' : '#e0e0e0',
						whiteSpace: 'pre-wrap',
						wordBreak: 'break-word',
						lineHeight: 1.5,
					}}
				>
					{typeof statusText === 'string' ? statusText : String(statusText ?? '')}
				</Typography>

				<IconButton
					size='small'
					onClick={() => {
						setVisible(false);
						resetAll();
					}}
					sx={{ color: greyColor(40), flexShrink: 0, mt: 0.25 }}
				>
					<X size={14} />
				</IconButton>
			</Box>
		</Box>
	);
}
