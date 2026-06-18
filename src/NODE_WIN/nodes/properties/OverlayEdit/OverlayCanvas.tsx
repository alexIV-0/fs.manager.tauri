// src/NODE_WIN/nodes/properties/OverlayEdit/OverlayCanvas.tsx

import { useEffect, useRef, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { OverlayFormatSettings, OverlaySettings } from './types';
import { drawChecker } from '../TitleEdit/canvasUtils';
import { useCanvasTransform } from '@/NODE_WIN/hooks/useCanvasTransform';
import { HANDLE_SIZE, ROTATION_HANDLE_DIST } from './constants';
import { CHECKER_COLOR_LIGHT, CHECKER_COLOR_DARK } from '@/Utils/CheckerboardBg';
import { commands, unwrap } from '@/Utils/specta';
import { toFileUrl } from '@/Utils/mediaUtils';
import { buildOverlayGraph } from '@/Utils/ffmpegGraphs/overlayGraph';
import PreviewStateDot from '../PreviewStateDot';

interface OverlayCanvasProps {
	settings: OverlayFormatSettings;
	onSettingsChange: (s: OverlayFormatSettings) => void;
	bgImageSrc?: string;
	fgImageSrc?: string;
	canvasRef: React.RefObject<HTMLCanvasElement | null>;
	lockAspect?: boolean;
	/** Full per-format settings — for the accurate ffmpeg render (format chosen by real BG dims). */
	allFormats?: OverlaySettings;
	/** Absolute FG/BG paths — for the accurate render (the canvas itself only has thumbnails). */
	fgFilePath?: string;
	bgFilePath?: string;
}

/** Minimal ffprobe stream shape we read for the accurate-frame graph. */
interface ProbeDims { width: number; height: number; pixFmt: string; }

async function probeDims(filePath: string): Promise<ProbeDims | null> {
	try {
		const json = await invoke<string>('ffprobe_get_info', { filePath });
		const streams = (JSON.parse(json).streams ?? []) as Array<Record<string, unknown>>;
		const v = streams.find((s) => s.codec_type === 'video');
		if (!v) return null;
		return {
			width: Number(v.width) || 0,
			height: Number(v.height) || 0,
			pixFmt: String(v.pix_fmt ?? ''),
		};
	} catch {
		return null;
	}
}

// ── Типы взаимодействия ────────────────────────────────────────────────────

type InteractionType =
	| 'none'
	| 'drag'
	| 'resize_nw'
	| 'resize_n'
	| 'resize_ne'
	| 'resize_e'
	| 'resize_se'
	| 'resize_s'
	| 'resize_sw'
	| 'resize_w'
	| 'rotate';

interface InteractionState {
	type: Exclude<InteractionType, 'none'>;
	startMX: number;
	startMY: number;
	startPosX: number;
	startPosY: number;
	startScaleW: number;
	startScaleH: number;
	startRotation: number;
	centerCX: number;
	centerCY: number;
	startAspectRatio: number;
}

// ── Вспомогательные функции ────────────────────────────────────────────────

function getFGCanvasRect(
	s: OverlayFormatSettings,
	t: { scale: number; offsetX: number; offsetY: number },
) {
	const fx = s.posX * t.scale + t.offsetX;
	const fy = s.posY * t.scale + t.offsetY;
	const fw = s.scaleW * t.scale;
	const fh = s.scaleH * t.scale;
	return { fx, fy, fw, fh, cx: fx + fw / 2, cy: fy + fh / 2 };
}

function hitTest(
	mx: number,
	my: number,
	s: OverlayFormatSettings,
	t: { scale: number; offsetX: number; offsetY: number },
): InteractionType {
	const rotRad = (s.rotation * Math.PI) / 180;
	const { fx, fy, fw, fh, cx, cy } = getFGCanvasRect(s, t);
	const DIST = ROTATION_HANDLE_DIST;

	// Ручка поворота (вычисляется в экранных координатах)
	const rotHandleX = cx + (fh / 2 + DIST) * Math.sin(rotRad);
	const rotHandleY = cy - (fh / 2 + DIST) * Math.cos(rotRad);
	if (Math.hypot(mx - rotHandleX, my - rotHandleY) < 10) return 'rotate';

	// Обратный поворот мыши вокруг центра FG — для тестирования в локальных координатах
	const cosR = Math.cos(-rotRad);
	const sinR = Math.sin(-rotRad);
	const dmx = mx - cx;
	const dmy = my - cy;
	const lmx = dmx * cosR - dmy * sinR + cx;
	const lmy = dmx * sinR + dmy * cosR + cy;

	const HIT = Math.max(HANDLE_SIZE / 2 + 3, 8);

	const handles: [InteractionType, number, number][] = [
		['resize_nw', fx, fy],
		['resize_n', fx + fw / 2, fy],
		['resize_ne', fx + fw, fy],
		['resize_e', fx + fw, fy + fh / 2],
		['resize_se', fx + fw, fy + fh],
		['resize_s', fx + fw / 2, fy + fh],
		['resize_sw', fx, fy + fh],
		['resize_w', fx, fy + fh / 2],
	];

	for (const [type, hx, hy] of handles) {
		if (Math.abs(lmx - hx) <= HIT && Math.abs(lmy - hy) <= HIT) return type;
	}

	if (lmx >= fx && lmx <= fx + fw && lmy >= fy && lmy <= fy + fh) return 'drag';

	return 'none';
}

function getCursor(hit: InteractionType): string {
	switch (hit) {
		case 'drag':
			return 'grab';
		case 'rotate':
			return 'crosshair';
		case 'resize_nw':
		case 'resize_se':
			return 'nwse-resize';
		case 'resize_ne':
		case 'resize_sw':
			return 'nesw-resize';
		case 'resize_n':
		case 'resize_s':
			return 'ns-resize';
		case 'resize_e':
		case 'resize_w':
			return 'ew-resize';
		default:
			return 'default';
	}
}

// ── Компонент ──────────────────────────────────────────────────────────────

export default function OverlayCanvas({
	settings,
	onSettingsChange,
	bgImageSrc,
	fgImageSrc,
	canvasRef,
	lockAspect,
	allFormats,
	fgFilePath,
	bgFilePath,
}: OverlayCanvasProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	// ── Accurate frame (on-demand ffmpeg composite, same builder as the export) ──
	const [accurate, setAccurate] = useState(false);
	const [accurateUrl, setAccurateUrl] = useState<string | null>(null);
	const [accurateLoading, setAccurateLoading] = useState(false);
	const probeCache = useRef<Map<string, ProbeDims>>(new Map());

	const cachedProbe = useCallback(async (p: string): Promise<ProbeDims | null> => {
		const hit = probeCache.current.get(p);
		if (hit) return hit;
		const dims = await probeDims(p);
		if (dims) probeCache.current.set(p, dims);
		return dims;
	}, []);

	const renderAccurate = useCallback(async () => {
		if (!fgFilePath || !bgFilePath || !allFormats) return;
		setAccurateLoading(true);
		try {
			const [bgD, fgD] = await Promise.all([cachedProbe(bgFilePath), cachedProbe(fgFilePath)]);
			if (!bgD || bgD.width <= 0) throw new Error('bg probe failed');
			// offsetBG is a node-level option not known to the modal — assume off (FG usually < BG).
			const { videoFilter, outLabel } = buildOverlayGraph({
				overlaySettings: allFormats,
				bgDims: { width: bgD.width, height: bgD.height },
				fgPixFmt: fgD?.pixFmt ?? '',
				offsetBG: false,
			});
			const res = await commands
				.previewRenderFrame({
					inputs: [
						{ path: bgFilePath, seek: 0 },
						{ path: fgFilePath, seek: 0 },
					],
					filterGraph: videoFilter,
					complex: true,
					outLabel,
					time: 0,
					maxDim: null,
					namespace: 'overlay',
				})
				.then(unwrap);
			setAccurateUrl(toFileUrl(res.path));
		} catch (e) {
			console.warn('[overlay] accurate render failed:', e);
			setAccurateUrl(null);
		} finally {
			setAccurateLoading(false);
		}
	}, [fgFilePath, bgFilePath, allFormats, cachedProbe]);

	const toggleAccurate = useCallback(() => {
		setAccurate((prev) => {
			const next = !prev;
			if (next) renderAccurate();
			return next;
		});
	}, [renderAccurate]);

	// Editing (drag / panel / format tab) invalidates the snapshot → back to live canvas.
	useEffect(() => {
		setAccurate(false);
		setAccurateUrl(null);
	}, [settings]);

	// Все данные через refs — draw() не пересоздаётся
	const settingsRef = useRef(settings);
	const onSettingsChangeRef = useRef(onSettingsChange);
	const lockAspectRef = useRef(lockAspect ?? false);
	lockAspectRef.current = lockAspect ?? false;
	const interactionRef = useRef<InteractionState | null>(null);
	const bgImageRef = useRef<HTMLImageElement | null>(null);
	const fgImageRef = useRef<HTMLImageElement | null>(null);

	settingsRef.current = settings;
	onSettingsChangeRef.current = onSettingsChange;

	const checkerLightRef = useRef(CHECKER_COLOR_LIGHT);
	const checkerDarkRef = useRef(CHECKER_COLOR_DARK);

	// ── Draw ────────────────────────────────────────────────────────────────

	const drawRef = useRef<() => void>(() => {});

	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const { scale, offsetX, offsetY } = transformRef.current;
		const s = settingsRef.current;
		const { bgWidth, bgHeight, posX, posY, scaleW, scaleH, rotation } = s;

		const W = canvas.width;
		const H = canvas.height;

		// BG фрейм в canvas-пространстве
		const bx = offsetX;
		const by = offsetY;
		const bw = bgWidth * scale;
		const bh = bgHeight * scale;

		// Тёмный фон снаружи фрейма
		ctx.fillStyle = '#111111';
		ctx.fillRect(0, 0, W, H);

		// Шахматный узор внутри BG фрейма
		drawChecker(ctx, bx, by, bw, bh, scale, checkerLightRef.current, checkerDarkRef.current);

		// BG превью (если загружено)
		const bgImg = bgImageRef.current;
		if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
			ctx.save();
			ctx.globalAlpha = 0.65;
			ctx.drawImage(bgImg, bx, by, bw, bh);
			ctx.restore();
		}

		// Граница BG фрейма
		ctx.strokeStyle = 'rgba(255,255,255,0.12)';
		ctx.lineWidth = 1;
		ctx.strokeRect(bx, by, bw, bh);

		// ── FG слой ────────────────────────────────────────────────────────
		const fx = posX * scale + offsetX;
		const fy = posY * scale + offsetY;
		const fw = scaleW * scale;
		const fh = scaleH * scale;
		const cx = fx + fw / 2;
		const cy = fy + fh / 2;
		const rotRad = (rotation * Math.PI) / 180;

		ctx.save();
		// Применяем поворот вокруг центра FG
		ctx.translate(cx, cy);
		ctx.rotate(rotRad);
		ctx.translate(-cx, -cy);

		// FG превью
		const fgImg = fgImageRef.current;
		if (fgImg && fgImg.complete && fgImg.naturalWidth > 0) {
			ctx.save();
			ctx.beginPath();
			ctx.rect(fx, fy, fw, fh);
			ctx.clip();
			ctx.drawImage(fgImg, fx, fy, fw, fh);
			ctx.restore();
		} else {
			ctx.fillStyle = 'rgba(255,255,255,0.06)';
			ctx.fillRect(fx, fy, fw, fh);
		}

		// Граница FG слоя
		ctx.strokeStyle = 'rgba(160, 120, 255, 0.9)';
		ctx.lineWidth = 2;
		ctx.strokeRect(fx, fy, fw, fh);

		// Ручки изменения размера (8 штук)
		const HS = HANDLE_SIZE;
		const handlePositions: [number, number][] = [
			[fx, fy],
			[fx + fw / 2, fy],
			[fx + fw, fy],
			[fx + fw, fy + fh / 2],
			[fx + fw, fy + fh],
			[fx + fw / 2, fy + fh],
			[fx, fy + fh],
			[fx, fy + fh / 2],
		];

		handlePositions.forEach(([hx, hy]) => {
			ctx.fillStyle = 'white';
			ctx.fillRect(hx - HS / 2, hy - HS / 2, HS, HS);
			ctx.strokeStyle = 'rgba(100, 80, 200, 0.85)';
			ctx.lineWidth = 1;
			ctx.strokeRect(hx - HS / 2, hy - HS / 2, HS, HS);
		});

		ctx.restore();

		// ── Ручка поворота (в глобальных координатах) ──────────────────────
		const DIST = ROTATION_HANDLE_DIST;
		const topCX = cx + (fh / 2) * Math.sin(rotRad);
		const topCY = cy - (fh / 2) * Math.cos(rotRad);
		const rotHandleX = cx + (fh / 2 + DIST) * Math.sin(rotRad);
		const rotHandleY = cy - (fh / 2 + DIST) * Math.cos(rotRad);

		// Линия от верхнего центра до ручки поворота
		ctx.beginPath();
		ctx.moveTo(topCX, topCY);
		ctx.lineTo(rotHandleX, rotHandleY);
		ctx.setLineDash([3, 3]);
		ctx.strokeStyle = 'rgba(255,255,255,0.35)';
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.setLineDash([]);

		// Кружок ручки поворота
		ctx.beginPath();
		ctx.arc(rotHandleX, rotHandleY, 5, 0, Math.PI * 2);
		ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
		ctx.fill();
		ctx.strokeStyle = 'rgba(120, 100, 220, 0.9)';
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	drawRef.current = draw;

	// ── Transform (zoom / pan) ───────────────────────────────────────────────

	const { transform, transformRef, fitToContainer } = useCanvasTransform({
		canvasRef,
		containerRef,
		videoWidth: settings.bgWidth,
		videoHeight: settings.bgHeight,
		onTransformChange: draw,
	});

	// ── ResizeObserver ───────────────────────────────────────────────────────

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

	// Перерисовка после каждого рендера
	const rafRef = useRef<number>(0);
	useEffect(() => {
		cancelAnimationFrame(rafRef.current);
		rafRef.current = requestAnimationFrame(() => drawRef.current());
	});

	// ── Загрузка изображений (data URLs из main-процесса) ───────────────────

	useEffect(() => {
		if (!bgImageSrc) {
			bgImageRef.current = null;
			drawRef.current();
			return;
		}
		const img = new Image();
		img.onload = () => drawRef.current();
		img.src = bgImageSrc; // всегда data URL, без CORS-проблем
		bgImageRef.current = img;
	}, [bgImageSrc]);

	useEffect(() => {
		if (!fgImageSrc) {
			fgImageRef.current = null;
			drawRef.current();
			return;
		}
		const img = new Image();
		img.onload = () => drawRef.current();
		img.src = fgImageSrc; // всегда data URL, без CORS-проблем
		fgImageRef.current = img;
	}, [fgImageSrc]);

	// ── Mouse interactions ───────────────────────────────────────────────────

	const handleMouseDown = useCallback((e: MouseEvent) => {
		if (e.button !== 0) return;

		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		const hit = hitTest(mx, my, settingsRef.current, transformRef.current);
		if (hit === 'none') return;

		e.preventDefault();
		e.stopPropagation();

		const s = settingsRef.current;
		const fgRect = getFGCanvasRect(s, transformRef.current);

		interactionRef.current = {
			type: hit,
			startMX: mx,
			startMY: my,
			startPosX: s.posX,
			startPosY: s.posY,
			startScaleW: s.scaleW,
			startScaleH: s.scaleH,
			startRotation: s.rotation,
			centerCX: fgRect.cx,
			centerCY: fgRect.cy,
			startAspectRatio: s.scaleW / Math.max(0.001, s.scaleH),
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			const canvas = canvasRef.current;
			if (!canvas) return;
			const rect = canvas.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;

			const inter = interactionRef.current;
			if (!inter) {
				// Обновляем курсор при hover
				const hit = hitTest(mx, my, settingsRef.current, transformRef.current);
				canvas.style.cursor = getCursor(hit);
				return;
			}

			const dx = mx - inter.startMX;
			const dy = my - inter.startMY;
			const { scale } = transformRef.current;
			const r = (settingsRef.current.rotation * Math.PI) / 180;

			if (inter.type === 'drag') {
				onSettingsChangeRef.current({
					...settingsRef.current,
					posX: parseFloat((inter.startPosX + dx / scale).toFixed(2)),
					posY: parseFloat((inter.startPosY + dy / scale).toFixed(2)),
				});
			} else if (inter.type === 'rotate') {
				const startAngle = Math.atan2(inter.startMY - inter.centerCY, inter.startMX - inter.centerCX);
				const currentAngle = Math.atan2(my - inter.centerCY, mx - inter.centerCX);
				const delta = ((currentAngle - startAngle) * 180) / Math.PI;
				onSettingsChangeRef.current({
					...settingsRef.current,
					rotation: parseFloat((inter.startRotation + delta).toFixed(2)),
				});
			} else {
				// Resize: проецируем canvas-дельту на локальные оси FG слоя
				const cosR = Math.cos(r);
				const sinR = Math.sin(r);
				const localDX = (dx * cosR + dy * sinR) / scale;
				const localDY = (-dx * sinR + dy * cosR) / scale;

				const { startPosX, startPosY, startScaleW, startScaleH } = inter;
				let newPosX = startPosX;
				let newPosY = startPosY;
				let newScaleW = startScaleW;
				let newScaleH = startScaleH;

				const lock = lockAspectRef.current;
				const ratio = inter.startAspectRatio;

				switch (inter.type) {
					case 'resize_se':
						newScaleW = Math.max(1, startScaleW + localDX);
						newScaleH = lock ? Math.max(1, newScaleW / ratio) : Math.max(1, startScaleH + localDY);
						break;
					case 'resize_nw':
						newScaleW = Math.max(1, startScaleW - localDX);
						if (lock) {
							newScaleH = Math.max(1, newScaleW / ratio);
							newPosX = startPosX + startScaleW - newScaleW;
							newPosY = startPosY + startScaleH - newScaleH;
						} else {
							newPosX = startPosX + localDX;
							newPosY = startPosY + localDY;
							newScaleH = Math.max(1, startScaleH - localDY);
						}
						break;
					case 'resize_ne':
						newScaleW = Math.max(1, startScaleW + localDX);
						if (lock) {
							newScaleH = Math.max(1, newScaleW / ratio);
							newPosY = startPosY + startScaleH - newScaleH;
						} else {
							newPosY = startPosY + localDY;
							newScaleH = Math.max(1, startScaleH - localDY);
						}
						break;
					case 'resize_sw':
						newScaleW = Math.max(1, startScaleW - localDX);
						if (lock) {
							newScaleH = Math.max(1, newScaleW / ratio);
							newPosX = startPosX + startScaleW - newScaleW;
						} else {
							newPosX = startPosX + localDX;
							newScaleH = Math.max(1, startScaleH + localDY);
						}
						break;
					case 'resize_n':
						newScaleH = Math.max(1, startScaleH - localDY);
						newPosY = startPosY + startScaleH - newScaleH;
						if (lock) {
							newScaleW = Math.max(1, newScaleH * ratio);
							newPosX = startPosX - (newScaleW - startScaleW) / 2;
						}
						break;
					case 'resize_s':
						newScaleH = Math.max(1, startScaleH + localDY);
						if (lock) {
							newScaleW = Math.max(1, newScaleH * ratio);
							newPosX = startPosX - (newScaleW - startScaleW) / 2;
						}
						break;
					case 'resize_e':
						newScaleW = Math.max(1, startScaleW + localDX);
						if (lock) {
							newScaleH = Math.max(1, newScaleW / ratio);
							newPosY = startPosY - (newScaleH - startScaleH) / 2;
						}
						break;
					case 'resize_w':
						newScaleW = Math.max(1, startScaleW - localDX);
						if (lock) {
							newScaleH = Math.max(1, newScaleW / ratio);
							newPosX = startPosX + startScaleW - newScaleW;
							newPosY = startPosY - (newScaleH - startScaleH) / 2;
						} else {
							newPosX = startPosX + localDX;
						}
						break;
				}

				onSettingsChangeRef.current({
					...settingsRef.current,
					posX: parseFloat(newPosX.toFixed(2)),
					posY: parseFloat(newPosY.toFixed(2)),
					scaleW: Math.max(1, Math.round(newScaleW)),
					scaleH: Math.max(1, Math.round(newScaleH)),
				});
			}
		};

		const onMouseUp = (e: MouseEvent) => {
			if (e.button === 0) interactionRef.current = null;
		};

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
		return () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Double-click: fit to container ──────────────────────────────────────

	const handleDoubleClick = useCallback(
		(e: MouseEvent) => {
			const canvas = canvasRef.current;
			if (!canvas) return;
			const rect = canvas.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;

			const { scale, offsetX, offsetY } = transformRef.current;
			const { bgWidth, bgHeight } = settingsRef.current;
			const inside =
				mx >= offsetX &&
				mx <= offsetX + bgWidth * scale &&
				my >= offsetY &&
				my <= offsetY + bgHeight * scale;

			if (!inside) fitToContainer();
		},
		[fitToContainer], // eslint-disable-line react-hooks/exhaustive-deps
	);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		canvas.addEventListener('mousedown', handleMouseDown);
		canvas.addEventListener('dblclick', handleDoubleClick);
		return () => {
			canvas.removeEventListener('mousedown', handleMouseDown);
			canvas.removeEventListener('dblclick', handleDoubleClick);
		};
	}, [handleMouseDown, handleDoubleClick]);

	// ── Редактирование размера холста ────────────────────────────────────────

	const [isEditingSize, setIsEditingSize] = useState(false);
	const [sizeInput, setSizeInput] = useState({ w: settings.bgWidth, h: settings.bgHeight });

	const applySizeInput = useCallback(() => {
		const w = Math.max(1, Math.round(sizeInput.w));
		const h = Math.max(1, Math.round(sizeInput.h));
		onSettingsChangeRef.current({ ...settingsRef.current, bgWidth: w, bgHeight: h });
		setIsEditingSize(false);
	}, [sizeInput]);

	const sizeLeft = transform.offsetX;
	const sizeTop = transform.offsetY - 22;

	// ── Render ────────────────────────────────────────────────────────────────

	return (
		<div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
			<canvas ref={canvasRef} style={{ display: 'block' }} />

			{/* 🟢 Accurate ffmpeg composite (on-demand) over the BG frame rect */}
			{accurate && accurateUrl && (
				<img
					src={accurateUrl}
					alt='Accurate composite'
					style={{
						position: 'absolute',
						left: transform.offsetX,
						top: transform.offsetY,
						width: settings.bgWidth * transform.scale,
						height: settings.bgHeight * transform.scale,
						objectFit: 'contain',
						pointerEvents: 'none',
						zIndex: 2,
					}}
				/>
			)}

			{/* Accurate-frame control + fidelity dot */}
			{fgFilePath && bgFilePath && (
				<button
					onClick={toggleAccurate}
					style={{
						position: 'absolute', top: 8, right: 8, zIndex: 4,
						padding: '3px 8px', fontSize: 10, borderRadius: 3,
						fontWeight: accurate ? 600 : 400,
						border: `1px solid ${accurate ? '#46b450' : '#333'}`,
						background: accurate ? '#1e3a24' : '#1a1a1acc',
						color: accurate ? '#8fe0a0' : '#aaa',
						cursor: 'pointer', outline: 'none',
					}}
					title='Render the exact ffmpeg composite for the current settings'
				>
					{accurate ? (accurateLoading ? '⏳ Точный кадр…' : '🟢 Точный кадр') : 'Точный кадр'}
				</button>
			)}
			{accurate && (
				<PreviewStateDot state={accurateUrl ? 'cached' : 'approx'} showLabel style={{ top: 36, right: 8 }} />
			)}

			{/* Размер BG холста */}
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
						title='Double click to edit BG size'
						style={{ cursor: 'text' }}
						onDoubleClick={() => {
							setSizeInput({ w: settings.bgWidth, h: settings.bgHeight });
							setIsEditingSize(true);
						}}
					>
						{settings.bgWidth} × {settings.bgHeight}
					</span>
				)}
			</div>

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
				Scroll — zoom · Middle btn — pan · Drag layer — move · Handles — resize · ○ — rotate · Dbl click outside — fit
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
