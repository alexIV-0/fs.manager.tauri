// src/NODE_WIN/nodes/properties/PanelSlider.tsx

import { useRef, useState, useCallback, useEffect, memo } from 'react';
import { Box, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';

interface PanelSliderProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	/** Если true — при ручном вводе значение не зажимается по min/max */
	noClamp?: boolean;
	onChange: (value: number) => void;
}

function PanelSlider({ label, value, min, max, step = 1, noClamp = false, onChange }: PanelSliderProps) {
	const trackRef = useRef<HTMLDivElement>(null);
	const isDragging = useRef(false);
	const [isEditing, setIsEditing] = useState(false);
	const [inputVal, setInputVal] = useState(String(value));

	const labelColor = greyColor(55);
	const defColor = greyColor(80);
	const trackBg = greyColor(25);
	const fillBg = greyColor(55);
	const inputBg = greyColor(20);
	const borderColor = greyColor(30);

	// Синхронизируем inputVal когда value меняется снаружи
	useEffect(() => {
		if (!isEditing) {
			setInputVal(String(value));
		}
	}, [value, isEditing]);

	const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

	const posFromEvent = useCallback(
		(clientX: number): number => {
			if (!trackRef.current) return value;
			const rect = trackRef.current.getBoundingClientRect();
			const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
			const raw = min + ratio * (max - min);
			const stepped = Math.round(raw / step) * step;
			return clamp(parseFloat(stepped.toFixed(10)));
		},
		[min, max, step, value, clamp],
	);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (isEditing) return;
			e.preventDefault();
			isDragging.current = true;

			const newVal = posFromEvent(e.clientX);
			onChange(newVal);

			const onMove = (ev: MouseEvent) => {
				if (!isDragging.current) return;
				onChange(posFromEvent(ev.clientX));
			};

			const onUp = () => {
				isDragging.current = false;
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
			};

			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		},
		[posFromEvent, onChange, isEditing],
	);

	// Двойной клик — переходим в режим ввода
	const handleDoubleClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			setIsEditing(true);
			setInputVal(String(value));
		},
		[value],
	);

	const handleInputBlur = useCallback(() => {
		setIsEditing(false);
		const parsed = parseFloat(inputVal);
		if (!isNaN(parsed)) {
			onChange(noClamp ? parsed : clamp(parsed));
		} else {
			setInputVal(String(value));
		}
	}, [inputVal, value, onChange, clamp, noClamp]);

	const handleInputKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			e.stopPropagation();
			if (e.key === 'Enter') {
				(e.target as HTMLInputElement).blur();
			}
			if (e.key === 'Escape') {
				setIsEditing(false);
				setInputVal(String(value));
			}
		},
		[value],
	);

	const percent = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

	return (
		<Box mb={1}>
			<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.3 }}>
				<Typography sx={{ fontSize: 11, color: labelColor, userSelect: 'none' }}>{label}</Typography>

				{/* Значение — клик для ручного ввода */}
				{isEditing ? (
					<input
						autoFocus
						value={inputVal}
						onChange={(e) => setInputVal(e.target.value)}
						onBlur={handleInputBlur}
						onKeyDown={handleInputKeyDown}
						style={{
							width: 52,
							fontSize: 11,
							fontFamily: 'monospace',
							textAlign: 'right',
							backgroundColor: inputBg,
							color: defColor,
							border: `1px solid ${borderColor}`,
							borderRadius: 3,
							padding: '1px 4px',
							outline: 'none',
						}}
					/>
				) : (
					<Typography
						sx={{
							fontSize: 11,
							color: defColor,
							fontFamily: 'monospace',
							userSelect: 'none',
							cursor: 'text',
							px: 0.5,
							borderRadius: 0.5,
							'&:hover': { backgroundColor: inputBg },
						}}
						onDoubleClick={handleDoubleClick}
						title='Double click to edit'
					>
						{value}
					</Typography>
				)}
			</Box>

			{/* Track */}
			<Box
				ref={trackRef}
				onMouseDown={handleMouseDown}
				onDoubleClick={handleDoubleClick}
				sx={{
					position: 'relative',
					height: 4,
					borderRadius: 2,
					backgroundColor: trackBg,
					cursor: isEditing ? 'default' : 'pointer',
					userSelect: 'none',
				}}
			>
				{/* Fill */}
				<Box
					sx={{
						position: 'absolute',
						left: 0,
						top: 0,
						height: '100%',
						width: `${percent}%`,
						backgroundColor: fillBg,
						borderRadius: 2,
						pointerEvents: 'none',
					}}
				/>

				{/* Thumb */}
				<Box
					sx={{
						position: 'absolute',
						top: '50%',
						left: `${percent}%`,
						transform: 'translate(-50%, -50%)',
						width: 12,
						height: 12,
						borderRadius: '50%',
						backgroundColor: defColor,
						pointerEvents: 'none',
						boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
					}}
				/>
			</Box>
		</Box>
	);
}

export default memo(PanelSlider);
