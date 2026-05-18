// src/NODE_WIN/nodes/properties/TitleEdit/TitleCanvas.tsx

import { useEffect, useRef, useCallback, useState } from 'react';
import { TitleFormatSettings } from './types';
import { drawChecker, drawTextBlock } from './canvasUtils';
import { useCanvasTransform } from '@/NODE_WIN/hooks/useCanvasTransform';
import { CHECKER_COLOR_LIGHT, CHECKER_COLOR_DARK } from '@/Utils/CheckerboardBg';

interface TitleCanvasProps {
	settings: TitleFormatSettings;
	placeholderText: string;
	onPlaceholderTextChange: (text: string) => void;
	onVideoSizeChange: (width: number, height: number) => void;
	canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export default function TitleCanvas({
	settings,
	placeholderText,
	onPlaceholderTextChange,
	onVideoSizeChange,
	canvasRef,
}: TitleCanvasProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	// ── Все данные в refs — draw() никогда не пересоздаётся ──────────────────
	const settingsRef = useRef(settings);
	const placeholderRef = useRef(placeholderText);
	const checkerLightRef = useRef(CHECKER_COLOR_LIGHT);
	const checkerDarkRef = useRef(CHECKER_COLOR_DARK);

	// Синхронизируем refs без эффектов — прямо в теле рендера (безопасно для refs)
	settingsRef.current = settings;
	placeholderRef.current = placeholderText;

	// Редактирование текста
	const [isEditing, setIsEditing] = useState(false);
	const editInputRef = useRef<HTMLTextAreaElement>(null);

	// Редактирование размера кадра
	const [isEditingSize, setIsEditingSize] = useState(false);
	const [sizeInput, setSizeInput] = useState({ w: settings.videoWidth, h: settings.videoHeight });

	// ── Стабильная draw — создаётся один раз ─────────────────────────────────

	const drawRef = useRef<() => void>(() => {});

	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const { scale, offsetX, offsetY } = transformRef.current;
		const s = settingsRef.current;
		const { videoWidth, videoHeight } = s;
		const W = canvas.width;
		const H = canvas.height;

		const vx = offsetX;
		const vy = offsetY;
		const vw = videoWidth * scale;
		const vh = videoHeight * scale;

		ctx.fillStyle = '#000000';
		ctx.fillRect(0, 0, W, H);

		drawChecker(ctx, vx, vy, vw, vh, scale, checkerLightRef.current, checkerDarkRef.current);

		ctx.save();
		ctx.beginPath();
		ctx.rect(vx, vy, vw, vh);
		ctx.clip();

		drawTextBlock({ ctx, s, text: placeholderRef.current, vx, vy, scale });

		ctx.restore();

		ctx.strokeStyle = 'rgba(255,255,255,0.15)';
		ctx.lineWidth = 1;
		ctx.strokeRect(vx, vy, vw, vh);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	drawRef.current = draw;

	// ── Transform ─────────────────────────────────────────────────────────────

	const { transform, transformRef, fitToContainer } = useCanvasTransform({
		canvasRef,
		containerRef,
		// videoWidth/Height только для fitToContainer — тоже через ref в хуке
		videoWidth: settings.videoWidth,
		videoHeight: settings.videoHeight,
		onTransformChange: draw,
	});

	// ── ResizeObserver — монтируется один раз ─────────────────────────────────

	useEffect(() => {
		const canvas = canvasRef.current;
		const container = containerRef.current;
		if (!canvas || !container) return;

		const ro = new ResizeObserver(() => {
			canvas.width = container.clientWidth;
			canvas.height = container.clientHeight;
			drawRef.current();
		});

		ro.observe(container);
		canvas.width = container.clientWidth;
		canvas.height = container.clientHeight;
		fitToContainer();

		return () => ro.disconnect();
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Перерисовка при изменении settings или текста ─────────────────────────
	// Используем requestAnimationFrame чтобы не вызывать draw в середине рендера

	const rafRef = useRef<number>(0);
	useEffect(() => {
		cancelAnimationFrame(rafRef.current);
		rafRef.current = requestAnimationFrame(() => drawRef.current());
	}); // без зависимостей — после каждого рендера, но через rAF (не setState внутри)

	// ── Double click ──────────────────────────────────────────────────────────

	const handleDoubleClick = useCallback(
		(e: MouseEvent) => {
			const canvas = canvasRef.current;
			if (!canvas) return;

			const rect = canvas.getBoundingClientRect();
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;
			const { scale, offsetX, offsetY } = transformRef.current;
			const { videoWidth, videoHeight } = settingsRef.current;

			const vx = offsetX;
			const vy = offsetY;
			const vw = videoWidth * scale;
			const vh = videoHeight * scale;

			const inside = mouseX >= vx && mouseX <= vx + vw && mouseY >= vy && mouseY <= vy + vh;

			if (inside) {
				setIsEditing(true);
				setTimeout(() => {
					editInputRef.current?.focus();
					editInputRef.current?.select();
				}, 30);
			} else {
				fitToContainer();
			}
		},
		[canvasRef, transformRef, fitToContainer],
	);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		canvas.addEventListener('dblclick', handleDoubleClick);
		return () => canvas.removeEventListener('dblclick', handleDoubleClick);
	}, [handleDoubleClick]);

	// ── Размер кадра ──────────────────────────────────────────────────────────

	const applySizeInput = useCallback(() => {
		const w = Math.max(1, Math.round(sizeInput.w));
		const h = Math.max(1, Math.round(sizeInput.h));
		onVideoSizeChange(w, h);
		setIsEditingSize(false);
	}, [sizeInput, onVideoSizeChange]);

	const sizeLeft = transform.offsetX;
	const sizeTop = transform.offsetY - 22;

	// ── Render ────────────────────────────────────────────────────────────────

	return (
		<div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
			<canvas ref={canvasRef} style={{ display: 'block' }} />

			{/* Размер кадра */}
			<div
				style={{
					position: 'absolute',
					left: sizeLeft,
					top: Math.max(4, sizeTop),
					fontSize: 11,
					color: 'rgba(255,255,255,0.45)',
					userSelect: 'none',
					pointerEvents: 'all',
					display: 'flex',
					alignItems: 'center',
					gap: 3,
					whiteSpace: 'nowrap',
				}}
			>
				{isEditingSize ? (
					<>
						<input
							autoFocus
							type='number'
							value={sizeInput.w}
							onChange={(e) => setSizeInput((p) => ({ ...p, w: Number(e.target.value) }))}
							onBlur={applySizeInput}
							onKeyDown={(e) => {
								e.stopPropagation();
								if (e.key === 'Enter') applySizeInput();
								if (e.key === 'Escape') setIsEditingSize(false);
							}}
							style={sizeInputStyle}
						/>
						<span style={{ color: 'rgba(255,255,255,0.3)' }}>×</span>
						<input
							type='number'
							value={sizeInput.h}
							onChange={(e) => setSizeInput((p) => ({ ...p, h: Number(e.target.value) }))}
							onBlur={applySizeInput}
							onKeyDown={(e) => {
								e.stopPropagation();
								if (e.key === 'Enter') applySizeInput();
								if (e.key === 'Escape') setIsEditingSize(false);
							}}
							style={sizeInputStyle}
						/>
					</>
				) : (
					<span
						title='Double click to edit size'
						style={{ cursor: 'text' }}
						onDoubleClick={() => {
							setSizeInput({ w: settings.videoWidth, h: settings.videoHeight });
							setIsEditingSize(true);
						}}
					>
						{settings.videoWidth} × {settings.videoHeight}
					</span>
				)}
			</div>

			{/* Textarea */}
			{isEditing && (
				<textarea
					ref={editInputRef}
					value={placeholderText}
					onChange={(e) => onPlaceholderTextChange(e.target.value)}
					onBlur={() => setIsEditing(false)}
					onKeyDown={(e) => {
						if (e.key === 'Escape') setIsEditing(false);
						e.stopPropagation();
					}}
					placeholder='Preview text...'
					style={{
						position: 'absolute',
						left: '50%',
						top: '50%',
						transform: 'translate(-50%, -50%)',
						width: Math.min(
							400,
							(settings.text.wrapWidth / 100) * (settings.videoWidth * transformRef.current.scale),
						),
						minHeight: 60,
						backgroundColor: 'rgba(0,0,0,0.75)',
						color: '#fff',
						fontSize: 13,
						fontFamily: 'monospace',
						border: '1px dashed rgba(255,255,255,0.4)',
						borderRadius: 4,
						outline: 'none',
						resize: 'both',
						padding: '6px 10px',
						boxSizing: 'border-box',
						zIndex: 5,
					}}
				/>
			)}

			{/* Подсказки */}
			<div
				style={{
					position: 'absolute',
					bottom: 8,
					left: 8,
					fontSize: 10,
					color: 'rgba(255,255,255,0.2)',
					pointerEvents: 'none',
					userSelect: 'none',
				}}
			>
				Scroll — zoom · Middle btn — pan · Dbl click inside — edit text · Dbl click outside — fit
			</div>

			<div
				style={{
					position: 'absolute',
					bottom: 8,
					right: 8,
					fontSize: 11,
					color: 'rgba(255,255,255,0.35)',
					pointerEvents: 'none',
					userSelect: 'none',
					fontFamily: 'monospace',
				}}
			>
				{Math.round(transform.scale * 100)}%
			</div>
		</div>
	);
}

const sizeInputStyle: React.CSSProperties = {
	width: 54,
	fontSize: 11,
	fontFamily: 'monospace',
	textAlign: 'center',
	backgroundColor: 'rgba(0,0,0,0.7)',
	color: '#fff',
	border: '1px solid rgba(255,255,255,0.3)',
	borderRadius: 3,
	padding: '1px 4px',
	outline: 'none',
};
