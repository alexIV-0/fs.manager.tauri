// src/NODE_WIN/nodes/properties/TitleEdit/TitleCanvas.tsx

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { TitleFormatSettings } from './types';
import { drawChecker, drawTextBlock, layoutTextBlock } from './canvasUtils';
import { useCanvasTransform } from '@/NODE_WIN/hooks/useCanvasTransform';
import { CHECKER_COLOR_LIGHT, CHECKER_COLOR_DARK } from '@/Utils/CheckerboardBg';

interface TitleCanvasProps {
	settings: TitleFormatSettings;
	/** Кадр, отрисованный ffmpeg+libass. Есть — показываем ЕГО вместо рисунка канваса:
	 *  титры в нём уже вжжены тем же ASS, что уйдёт в финальный рендер. */
	frameUrl?: string | null;
	/** Подложка под титрами, когда кадра нет. null — шахматка (прозрачность). */
	bgColor?: string | null;
	placeholderText: string;
	onPlaceholderTextChange: (text: string) => void;
	onVideoSizeChange: (width: number, height: number) => void;
	/** Сообщаем наружу о правке текста: под редактором кадр не показывается,
	 *  и гонять ради него ffmpeg на каждую букву незачем. */
	onEditingChange?: (editing: boolean) => void;
	canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export default function TitleCanvas({
	settings,
	frameUrl,
	bgColor,
	placeholderText,
	onPlaceholderTextChange,
	onVideoSizeChange,
	onEditingChange,
	canvasRef,
}: TitleCanvasProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	// ── Все данные в refs — draw() никогда не пересоздаётся ──────────────────
	const settingsRef = useRef(settings);
	const placeholderRef = useRef(placeholderText);
	// Картинка кадра держится в ref: перерисовка идёт из стабильной draw().
	const frameImgRef = useRef<HTMLImageElement | null>(null);
	const bgColorRef = useRef(bgColor);
	bgColorRef.current = bgColor;
	const checkerLightRef = useRef(CHECKER_COLOR_LIGHT);
	const checkerDarkRef = useRef(CHECKER_COLOR_DARK);

	// Синхронизируем refs без эффектов — прямо в теле рендера (безопасно для refs)
	settingsRef.current = settings;
	placeholderRef.current = placeholderText;

	// Редактирование текста прямо на холсте
	const [isEditing, setIsEditing] = useState(false);
	const editInputRef = useRef<HTMLTextAreaElement>(null);
	// draw() стабильна и читает состояние только через refs.
	const isEditingRef = useRef(isEditing);
	isEditingRef.current = isEditing;

	const onEditingChangeRef = useRef(onEditingChange);
	onEditingChangeRef.current = onEditingChange;
	useEffect(() => {
		onEditingChangeRef.current?.(isEditing);
	}, [isEditing]);

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

		// Во время правки кадр убираем: титры в нём вжжены старым текстом, поверх
		// него редактировать нечего. Показываем холст с фоном и плашкой.
		const frame = isEditingRef.current ? null : frameImgRef.current;
		if (frame && frame.naturalWidth > 0) {
			// Кадр вписываем по своим пропорциям: если подложка не того формата,
			// это должно быть видно, а не растянуто под рамку.
			const k = Math.min(vw / frame.naturalWidth, vh / frame.naturalHeight);
			const fw = frame.naturalWidth * k;
			const fh = frame.naturalHeight * k;
			ctx.drawImage(frame, vx + (vw - fw) / 2, vy + (vh - fh) / 2, fw, fh);
		} else {
			const bg = bgColorRef.current;
			if (bg) {
				ctx.fillStyle = bg;
				ctx.fillRect(vx, vy, vw, vh);
			} else {
				drawChecker(ctx, vx, vy, vw, vh, scale, checkerLightRef.current, checkerDarkRef.current);
			}

			ctx.save();
			ctx.beginPath();
			ctx.rect(vx, vy, vw, vh);
			ctx.clip();

			// Буквы во время правки рисует textarea — иначе они двоились бы. Плашка
			// при этом остаётся и подстраивается под набираемый текст.
			drawTextBlock({ ctx, s, text: placeholderRef.current, vx, vy, scale, skipText: isEditingRef.current });

			ctx.restore();
		}

		ctx.strokeStyle = 'rgba(255,255,255,0.15)';
		ctx.lineWidth = 1;
		ctx.strokeRect(vx, vy, vw, vh);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	drawRef.current = draw;

	// ── Кадр из ffmpeg ────────────────────────────────────────────────────────

	useEffect(() => {
		if (!frameUrl) {
			frameImgRef.current = null;
			drawRef.current();
			return;
		}
		const img = new Image();
		img.onload = () => {
			frameImgRef.current = img;
			drawRef.current();
		};
		img.src = frameUrl;
		return () => {
			img.onload = null;
		};
	}, [frameUrl]);

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

	// ── Раскладка под редактор ────────────────────────────────────────────────
	//
	// Считаем ТЕМ ЖЕ кодом, что рисует строки, — иначе при двойном клике текст
	// прыгает с места. Координаты канваса переводим в страничные: textarea лежит
	// поверх канваса обычным абсолютом.
	const editBox = useMemo(() => {
		if (!isEditing) return null;
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext('2d');
		if (!canvas || !ctx) return null;

		const { scale, offsetX, offsetY } = transform;
		const lay = layoutTextBlock(ctx, settings, placeholderText, offsetX, offsetY, scale);

		// В CSS базовая линия первой строки опущена на половину «свободного»
		// места строки (half-leading); канвас же кладёт её ровно на ascent.
		const top = lay.blockTop - (lay.lineHeight - lay.realLineH) / 2;

		const left =
			settings.position.hAlign === 'left'
				? lay.textX
				: settings.position.hAlign === 'right'
					? lay.textX - lay.wrapWidth
					: lay.textX - lay.wrapWidth / 2;

		return {
			left,
			top,
			width: lay.wrapWidth,
			height: lay.lineHeight * Math.max(1, lay.lines.length),
			font: lay.fontStyle,
			lineHeight: lay.lineHeight,
		};
	}, [isEditing, settings, placeholderText, transform, canvasRef]);

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

			{/* Textarea — позиционируется у точки привязки текста через fixed */}
			{/* Правка текста-образца прямо на месте: тот же шрифт, кегль, цвет и
			    выравнивание, что у нарисованных титров. Эффекты (обводка, тень,
			    плашка) при вводе не показываем — они вернутся, как только уйдёт фокус. */}
			{isEditing && editBox && (
				<textarea
					ref={editInputRef}
					value={placeholderText}
					onChange={(e) => onPlaceholderTextChange(e.target.value)}
					onBlur={() => setIsEditing(false)}
					onKeyDown={(e) => {
						if (e.key === 'Escape') setIsEditing(false);
						e.stopPropagation();
					}}
					spellCheck={false}
					placeholder='Текст образца…'
					style={{
						position: 'absolute',
						left: editBox.left,
						top: editBox.top,
						width: editBox.width,
						height: editBox.height,
						font: editBox.font,
						lineHeight: `${editBox.lineHeight}px`,
						color: settings.text.color,
						caretColor: settings.text.color,
						textAlign: settings.position.hAlign,
						backgroundColor: 'transparent',
						border: 'none',
						padding: 0,
						margin: 0,
						resize: 'none',
						overflow: 'hidden',
						whiteSpace: 'pre-wrap',
						// outline вместо border — не сдвигает текст внутри поля.
						outline: '1px dashed rgba(255,255,255,0.35)',
						outlineOffset: 6,
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

