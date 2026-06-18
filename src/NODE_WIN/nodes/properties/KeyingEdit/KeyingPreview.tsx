// src/NODE_WIN/nodes/properties/KeyingEdit/KeyingPreview.tsx
//
// Left panel: keyed-frame preview with the unified render-bar workflow.
// - Live client-side approximation on a <canvas> (keyingPreviewCanvas.ts) = the 🟡 tier:
//   instant feedback while you tune sliders (no ffmpeg).
// - Accurate ffmpeg frame rendered in the background per timeline cell (usePreviewCache) =
//   the 🟢 tier: on pause it swaps in over the canvas → what you see == the export.
// - PreviewStateDot (corner) shows the fidelity of the frame on screen.
// - PreviewTimeline (render-bar) shows which cells are cached and scrubs.
// - The old Original/Preview toggle buttons are gone — fidelity is shown, not chosen.
// - Eyedropper: click frame → pick color. Zoom: wheel, Pan: middle drag, Dbl-click: fit.

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { toFileUrl } from '@/Utils/mediaUtils';
import type { PreviewRenderSpec } from '@/bindings';
import { KeyingSettings, buildKeyingFilterString } from './types';
import { renderKeyingPreview } from './keyingPreviewCanvas';
import { checkerboardStyle } from '@/Utils/CheckerboardBg';
import PreviewToolbar, { type PreviewToolbarHandle } from '../PreviewToolbar';
import PreviewTimeline, { type PreviewTimelineHandle } from '../PreviewTimeline';
import PreviewStateDot from '../PreviewStateDot';
import { usePreviewCache } from '../usePreviewCache';
import { PreviewState } from '../previewState';

const CONTROLS_H = 84;
const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

export interface PixelInfo { r: number; g: number; b: number; a: number }

interface KeyingPreviewProps {
	filePath: string;
	settings: KeyingSettings;
	eyedropperActive: boolean;
	/** Receives hex color string picked from canvas (e.g. '#00ff00') */
	onEyedropperPick: (color: string) => void;
	onTimecodeChange?: (tc: number) => void;
	/** Fires on mouse move over the keyed preview — null when outside image bounds */
	onPixelHover?: (pixel: PixelInfo | null) => void;
}

export default function KeyingPreview({
	filePath,
	settings,
	eyedropperActive,
	onEyedropperPick,
	onTimecodeChange,
	onPixelHover,
}: KeyingPreviewProps) {
	const containerRef   = useRef<HTMLDivElement>(null);
	const previewAreaRef = useRef<HTMLDivElement>(null);
	const videoRef       = useRef<HTMLVideoElement>(null);
	const imgRef         = useRef<HTMLImageElement>(null);
	const keyingCanvasRef = useRef<HTMLCanvasElement>(null);
	const toolbarRef     = useRef<PreviewToolbarHandle>(null);
	const timelineRef    = useRef<PreviewTimelineHandle>(null);
	const rafRef         = useRef<number>(0);
	const durationRef    = useRef(0);

	const [playing, setPlaying] = useState(false);
	const [duration, setDuration] = useState(0);

	// ── Keyed output size (from the rendered canvas) ────────────────────────
	const [keyedImageSize, setKeyedImageSize] = useState<{ w: number; h: number } | null>(null);
	const keyedImageSizeRef = useRef(keyedImageSize);
	keyedImageSizeRef.current = keyedImageSize;

	// ── Zoom / Pan state ─────────────────────────────────────────────────────

	const [transform, setTransform] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
	const transformRef = useRef(transform);
	transformRef.current = transform;
	const isPanningRef   = useRef(false);
	const lastPanPosRef  = useRef({ x: 0, y: 0 });

	// ── Auto-fit guard: only fit to view on first load per file ──────────
	const hasAutoFitRef  = useRef(false);

	const fileUrl = filePath ? toFileUrl(filePath) : '';

	// Определяем тип файла по расширению
	const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'tga']);
	const fileExt = filePath.split('.').pop()?.toLowerCase() ?? '';
	const isImage = IMAGE_EXTS.has(fileExt);

	// Размеры оригинальной картинки (для isImage=true, когда <video> не даёт videoWidth)
	const [origImageSize, setOrigImageSize] = useState<{ w: number; h: number } | null>(null);
	const origImageSizeRef = useRef(origImageSize);
	origImageSizeRef.current = origImageSize;

	const settingsRef = useRef(settings);
	settingsRef.current = settings;

	// ── Filtergraph (single source of truth — same builder as the export) ───
	const settingsStr = JSON.stringify(settings);
	const filterGraph = useMemo(() => buildKeyingFilterString(settings), [settingsStr]); // eslint-disable-line react-hooks/exhaustive-deps
	const hasEffect = filterGraph.length > 0;
	const hasEffectRef = useRef(hasEffect);
	hasEffectRef.current = hasEffect;

	// ── Render-bar grid: ~4 cells/sec (250 ms buckets), clamped ─────────────
	const cellCount = useMemo(
		() => (duration > 0 ? Math.min(600, Math.max(20, Math.round(duration * 4))) : 1),
		[duration],
	);

	// Build the ffmpeg render-spec for a given time (keying = single input, -vf).
	const buildSpec = useCallback(
		(time: number): PreviewRenderSpec | null => {
			if (!filePath || !hasEffect) return null;
			return {
				inputs: [{ path: filePath, seek: time }],
				filterGraph,
				complex: false,
				outLabel: null,
				time,
				maxDim: null, // full source res — the 🟢 frame is the real thing
				namespace: 'keying',
			};
		},
		[filePath, hasEffect, filterGraph],
	);

	const { cellStates, frameUrl, frameState, requestFrame } = usePreviewCache({
		duration,
		cellCount,
		buildSpec,
		graphKey: `${filePath}|${filterGraph}`,
	});

	// ── Fit to container ─────────────────────────────────────────────────────

	const fitToView = useCallback(() => {
		const area = previewAreaRef.current;
		if (!area) return;

		const v = videoRef.current;
		const srcW = keyedImageSizeRef.current?.w ?? origImageSizeRef.current?.w ?? v?.videoWidth ?? 0;
		const srcH = keyedImageSizeRef.current?.h ?? origImageSizeRef.current?.h ?? v?.videoHeight ?? 0;
		if (!srcW || !srcH) return;

		const areaW = area.clientWidth;
		const areaH = area.clientHeight;
		const scale = Math.min((areaW - 20) / srcW, (areaH - 20) / srcH);
		const t = {
			scale,
			offsetX: (areaW - srcW * scale) / 2,
			offsetY: (areaH - srcH * scale) / 2,
		};
		transformRef.current = t;
		setTransform(t);
	}, []);

	// Сбрасываем размеры оригинала и guard при смене файла
	useEffect(() => {
		setOrigImageSize(null);
		origImageSizeRef.current = null;
		setKeyedImageSize(null);
		keyedImageSizeRef.current = null;
		hasAutoFitRef.current = false;
	}, [filePath]);

	// ── Autoplay + fit on file load ──────────────────────────────────────────

	useEffect(() => {
		if (!fileUrl || isImage) return;
		const v = videoRef.current;
		if (!v) return;
		const onMeta = () => {
			durationRef.current = v.duration;
			setDuration(v.duration);
			v.play().catch(() => {});
			if (!hasAutoFitRef.current) {
				hasAutoFitRef.current = true;
				requestAnimationFrame(fitToView);
			}
		};
		v.addEventListener('loadedmetadata', onMeta, { once: true });
		return () => v.removeEventListener('loadedmetadata', onMeta);
	}, [fileUrl, isImage, fitToView]);

	// ── Sync playing state + request an accurate frame on pause ─────────────

	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;
		const onPlay  = () => setPlaying(true);
		const onPause = () => {
			setPlaying(false);
			requestFrame(v.currentTime); // paused → fetch the 🟢 frame for this cell
		};
		setPlaying(!v.paused);
		v.addEventListener('play', onPlay);
		v.addEventListener('pause', onPause);
		return () => {
			v.removeEventListener('play', onPlay);
			v.removeEventListener('pause', onPause);
		};
	}, [fileUrl, requestFrame]);

	// ── Draw keyed frame onto the canvas (client-side, no ffmpeg) ───────────

	const drawKeyed = useCallback(() => {
		const cvs = keyingCanvasRef.current;
		if (!cvs) return;

		let source: CanvasImageSource | null = null;
		let sw = 0;
		let sh = 0;
		if (isImage) {
			const im = imgRef.current;
			if (im && im.complete && im.naturalWidth > 0) { source = im; sw = im.naturalWidth; sh = im.naturalHeight; }
		} else {
			const v = videoRef.current;
			if (v && v.readyState >= 2 && v.videoWidth > 0) { source = v; sw = v.videoWidth; sh = v.videoHeight; }
		}
		if (!source) return;

		const rendered = renderKeyingPreview(source, sw, sh, settingsRef.current);
		if (!rendered) return;

		if (cvs.width !== rendered.width || cvs.height !== rendered.height) {
			cvs.width = rendered.width;
			cvs.height = rendered.height;
		}
		const ctx = cvs.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, cvs.width, cvs.height);
		ctx.drawImage(rendered, 0, 0);

		const prev = keyedImageSizeRef.current;
		if (!prev || prev.w !== rendered.width || prev.h !== rendered.height) {
			const size = { w: rendered.width, h: rendered.height };
			keyedImageSizeRef.current = size;
			setKeyedImageSize(size);
			if (!hasAutoFitRef.current || !prev || prev.w !== size.w || prev.h !== size.h) {
				hasAutoFitRef.current = true;
				requestAnimationFrame(() => fitToView());
			}
		}
	}, [isImage, fitToView]);

	// ── RAF loop: progress + timeline playhead + live keyed render ──────────

	useEffect(() => {
		const loop = () => {
			const v = videoRef.current;
			if (v && v.duration > 0) {
				toolbarRef.current?.update(v.currentTime, v.duration);
				timelineRef.current?.update(v.currentTime, v.duration);
			}
			if (hasEffectRef.current) drawKeyed();
			rafRef.current = requestAnimationFrame(loop);
		};
		rafRef.current = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(rafRef.current);
	}, [drawKeyed]);

	// Reset hover when there's no effect on screen
	useEffect(() => {
		if (!hasEffect) onPixelHover?.(null);
	}, [hasEffect]); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Re-request the accurate frame when graph / file / duration changes ──

	useEffect(() => {
		if (!filePath || !hasEffect) return;
		if (!isImage && duration <= 0) return; // video: wait for metadata (duration)
		requestFrame(videoRef.current?.currentTime ?? 0);
	}, [filterGraph, filePath, duration, hasEffect, isImage, requestFrame]);

	// ── Seek ──────────────────────────────────────────────────────────────────

	const seekTo = useCallback((ratio: number) => {
		const v = videoRef.current;
		if (!v) return;
		const t = ratio * durationRef.current;
		v.currentTime = t;
		onTimecodeChange?.(t);
		requestFrame(t);
	}, [onTimecodeChange, requestFrame]);

	// ── Play/Pause ────────────────────────────────────────────────────────────

	const togglePlay = useCallback(() => {
		const v = videoRef.current;
		if (!v) return;
		if (v.paused) v.play().catch(() => {}); else v.pause();
	}, []);

	// ── Frame step ────────────────────────────────────────────────────────────

	const stepFrame = useCallback((dir: 1 | -1) => {
		const v = videoRef.current;
		if (!v) return;
		v.pause();
		v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + dir * (1 / 30)));
		onTimecodeChange?.(v.currentTime);
		requestFrame(v.currentTime);
	}, [onTimecodeChange, requestFrame]);

	// ── Zoom (scroll wheel) ──────────────────────────────────────────────────

	useEffect(() => {
		const area = previewAreaRef.current;
		if (!area) return;

		const handleWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = area.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;

			const delta = e.deltaY > 0 ? 0.9 : 1.1;
			const { scale, offsetX, offsetY } = transformRef.current;
			const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * delta));
			const t = {
				scale: newScale,
				offsetX: mx - (mx - offsetX) * (newScale / scale),
				offsetY: my - (my - offsetY) * (newScale / scale),
			};
			transformRef.current = t;
			setTransform(t);
		};

		area.addEventListener('wheel', handleWheel, { passive: false });
		return () => area.removeEventListener('wheel', handleWheel);
	}, []);

	// ── Pan (middle mouse button) ────────────────────────────────────────────

	useEffect(() => {
		const area = previewAreaRef.current;
		if (!area) return;

		const onDown = (e: MouseEvent) => {
			if (e.button === 1) {
				e.preventDefault();
				isPanningRef.current = true;
				lastPanPosRef.current = { x: e.clientX, y: e.clientY };
			}
		};
		const onMove = (e: MouseEvent) => {
			if (!isPanningRef.current) return;
			const dx = e.clientX - lastPanPosRef.current.x;
			const dy = e.clientY - lastPanPosRef.current.y;
			lastPanPosRef.current = { x: e.clientX, y: e.clientY };
			const { scale, offsetX, offsetY } = transformRef.current;
			const t = { scale, offsetX: offsetX + dx, offsetY: offsetY + dy };
			transformRef.current = t;
			setTransform(t);
		};
		const onUp = (e: MouseEvent) => {
			if (e.button === 1) isPanningRef.current = false;
		};

		area.addEventListener('mousedown', onDown);
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => {
			area.removeEventListener('mousedown', onDown);
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	}, []);

	// ── Double-click → fit to view ───────────────────────────────────────────

	const handleDoubleClick = useCallback(() => {
		fitToView();
	}, [fitToView]);

	// ── Eyedropper click — read pixel from the source frame ──────────────────

	const handlePreviewClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
		if (!eyedropperActive) return;
		let source: CanvasImageSource | null = null;
		let sw = 0;
		let sh = 0;
		if (isImage) {
			const im = imgRef.current;
			if (im && im.complete && im.naturalWidth > 0) { source = im; sw = im.naturalWidth; sh = im.naturalHeight; }
		} else {
			const v = videoRef.current;
			if (v && v.videoWidth > 0) { source = v; sw = v.videoWidth; sh = v.videoHeight; }
		}
		if (!source) return;
		const area = previewAreaRef.current;
		if (!area) return;
		const rect = area.getBoundingClientRect();
		const { scale, offsetX, offsetY } = transformRef.current;
		const localX = Math.round((e.clientX - rect.left - offsetX) / scale);
		const localY = Math.round((e.clientY - rect.top - offsetY) / scale);
		if (localX < 0 || localX >= sw || localY < 0 || localY >= sh) return;
		const canvas = document.createElement('canvas');
		canvas.width = sw;
		canvas.height = sh;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.drawImage(source, 0, 0);
		let pixel: Uint8ClampedArray;
		try {
			pixel = ctx.getImageData(localX, localY, 1, 1).data;
		} catch {
			return; // tainted
		}
		const r = pixel[0].toString(16).padStart(2, '0');
		const g = pixel[1].toString(16).padStart(2, '0');
		const b = pixel[2].toString(16).padStart(2, '0');
		onEyedropperPick(`#${r}${g}${b}`);
	}, [eyedropperActive, isImage, onEyedropperPick]);

	// ── Mouse move — читаем RGBA из keyed-превью через canvas ────────────────

	const rafHoverRef = useRef<number>(0);
	const handlePreviewMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
		if (!hasEffectRef.current || !onPixelHover) return;
		cancelAnimationFrame(rafHoverRef.current);
		rafHoverRef.current = requestAnimationFrame(() => {
			const canvas = keyingCanvasRef.current;
			if (!canvas || canvas.width === 0) { onPixelHover(null); return; }
			const area = previewAreaRef.current;
			if (!area) return;
			const rect = area.getBoundingClientRect();
			const { scale, offsetX, offsetY } = transformRef.current;
			const localX = Math.round((e.clientX - rect.left - offsetX) / scale);
			const localY = Math.round((e.clientY - rect.top - offsetY) / scale);
			if (localX < 0 || localX >= canvas.width || localY < 0 || localY >= canvas.height) {
				onPixelHover(null); return;
			}
			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			const [r, g, b, a] = ctx.getImageData(localX, localY, 1, 1).data;
			onPixelHover({ r, g, b, a });
		});
	}, [onPixelHover]);

	const handlePreviewMouseLeave = useCallback(() => {
		cancelAnimationFrame(rafHoverRef.current);
		onPixelHover?.(null);
	}, [onPixelHover]);

	// ── Compute display style ────────────────────────────────────────────────

	const v = videoRef.current;
	const vidW = v?.videoWidth || 1920;
	const vidH = v?.videoHeight || 1080;

	const displayW = keyedImageSize?.w ?? origImageSize?.w ?? vidW;
	const displayH = keyedImageSize?.h ?? origImageSize?.h ?? vidH;

	const mediaStyle: React.CSSProperties = {
		position: 'absolute',
		left: transform.offsetX,
		top: transform.offsetY,
		width: displayW * transform.scale,
		height: displayH * transform.scale,
		imageRendering: 'auto',
	};

	// ── Display rule: 🟢 accurate frame (paused, cached) > 🟡 live canvas > source ──
	const showGreen  = hasEffect && !playing && frameState === 'cached' && !!frameUrl;
	const showCanvas = hasEffect && !showGreen;
	const showSource = !hasEffect;
	const dotState: PreviewState = !hasEffect ? 'original' : (showGreen ? 'cached' : 'approx');

	const hasKnownSize = origImageSize !== null || (videoRef.current?.videoWidth ?? 0) > 0 || keyedImageSize !== null;

	// ── Render ────────────────────────────────────────────────────────────────

	return (
		<div
			ref={containerRef}
			style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#111111' }}
		>
			{/* Preview area with zoom/pan */}
			<div
				ref={previewAreaRef}
				style={{
					flex: 1,
					position: 'relative',
					overflow: 'hidden',
					cursor: eyedropperActive ? 'crosshair' : 'default',
				}}
				onClick={handlePreviewClick}
				onDoubleClick={handleDoubleClick}
				onMouseMove={handlePreviewMouseMove}
				onMouseLeave={handlePreviewMouseLeave}
			>
				{/* Frame background — checkerboard + border */}
				{fileUrl && hasKnownSize && (
					<div style={{
						position: 'absolute',
						left: transform.offsetX,
						top: transform.offsetY,
						width: displayW * transform.scale,
						height: displayH * transform.scale,
						...checkerboardStyle,
						border: '1px solid rgba(255,255,255,0.12)',
						boxSizing: 'border-box',
					}} />
				)}

				{/* Static image — always mounted (display source / canvas source) */}
				{fileUrl && isImage && (
					<img
						ref={imgRef}
						crossOrigin='anonymous'
						src={fileUrl}
						onLoad={(e) => {
							const img = e.currentTarget;
							const size = { w: img.naturalWidth, h: img.naturalHeight };
							setOrigImageSize(size);
							origImageSizeRef.current = size;
							if (!hasAutoFitRef.current) {
								hasAutoFitRef.current = true;
								requestAnimationFrame(() => fitToView());
							}
						}}
						style={showSource
							? mediaStyle
							: { position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }
						}
						alt='Original'
					/>
				)}

				{/* <video> всегда в DOM для videoWidth/timecode/canvas-source (скрыт когда показываем эффект) */}
				{fileUrl && !isImage && (
					<video
						ref={videoRef}
						crossOrigin='anonymous'
						src={fileUrl}
						loop
						muted
						playsInline
						style={showSource
							? mediaStyle
							: { position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }
						}
					/>
				)}

				{/* 🟡 Live keyed approximation — client-side canvas over checkerboard */}
				<canvas
					ref={keyingCanvasRef}
					style={{
						...mediaStyle,
						...checkerboardStyle,
						display: showCanvas ? 'block' : 'none',
						pointerEvents: 'none',
					}}
				/>

				{/* 🟢 Accurate ffmpeg frame — swapped in on pause for the cached cell */}
				{showGreen && frameUrl && (
					<img
						src={frameUrl}
						style={{ ...mediaStyle, pointerEvents: 'none' }}
						alt='Accurate preview'
					/>
				)}

				{/* Fidelity indicator */}
				{fileUrl && hasKnownSize && <PreviewStateDot state={dotState} showLabel />}

				{!fileUrl && (
					<div style={{
						position: 'absolute',
						inset: 0,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						color: 'rgba(255,255,255,0.2)',
						fontSize: 13,
						pointerEvents: 'none',
					}}>
						Select file to preview
					</div>
				)}

				{/* Zoom indicator */}
				<div style={{
					position: 'absolute', bottom: 4, right: 8,
					color: '#444', fontSize: 10, fontFamily: 'monospace',
					pointerEvents: 'none',
				}}>
					{Math.round(transform.scale * 100)}%
				</div>
			</div>

			{/* Controls — render-bar timeline replaces the thin progress bar */}
			<PreviewToolbar
				ref={toolbarRef}
				playing={playing}
				onTogglePlay={togglePlay}
				onSeek={seekTo}
				showPlayback={!isImage}
				showFrameStep
				onStepFrame={stepFrame}
				height={isImage ? CONTROLS_H / 2 : CONTROLS_H}
				progressSlot={!isImage ? (
					<PreviewTimeline
						ref={timelineRef}
						duration={duration}
						cellCount={cellCount}
						cellStates={cellStates}
						onSeek={seekTo}
					/>
				) : undefined}
			/>
		</div>
	);
}
