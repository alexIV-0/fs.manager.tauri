import { greyColor, steelColor } from '@/Store/Color/grayColor';
import { useProcessingStatus_store } from '@/Store/Node/useProcessingStatus_store';
import { Box, IconButton, Typography } from '@mui/material';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function ProcessingStatusBar() {
	const { statusText, isRunning, resetAll } = useProcessingStatus_store();
	const [visible, setVisible] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// показываем как только начался процесс или появился текст
	useEffect(() => {
		if (isRunning || statusText) {
			setVisible(true);
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		}
	}, [isRunning, statusText]);

	// автоскрытие через 3 сек после завершения
	useEffect(() => {
		if (!isRunning && visible) {
			timerRef.current = setTimeout(() => {
				setVisible(false);
				resetAll();
				timerRef.current = null;
			}, 3000);
		}

		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [isRunning]);

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
