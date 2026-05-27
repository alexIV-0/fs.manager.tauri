// src/NODE_WIN/nodes/properties/KeyingEdit/KeyingPreview.tsx
//
// Left panel: original video/image playback + keyed frame preview.
// - Video plays via <video> for navigation (find the right frame)
// - Keyed preview is rendered live on a <canvas> (client-side, no ffmpeg) —
//   same approach as the Convert / ffSwitch previews. See keyingPreviewCanvas.ts.
// - Toggle between "Original" and "Keying" modes
// - Eyedropper: click on original frame → pick color
// - Zoom: scroll wheel, Pan: middle mouse drag, Double-click: fit to view

import { useRef, useState, useEffect, useCallback } from 'react';
import { toFileUrl } from '@/Utils/mediaUtils';
import { KeyingSettings } from './types';
import { renderKeyingPreview } from './keyingPreviewCanvas';
import { checkerboardStyle } from '@/Utils/CheckerboardBg';
import PreviewToolbar, { type PreviewToolbarHandle } from '../PreviewToolbar';

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
	const rafRef         = useRef<number>(0);
	const durationRef    = useRef(0);

	const [playing, setPlaying] = useState(false);
	const [mode, setMode] = useState<'original' | 'keying'>('original');
	const modeRef = useRef(mode);
	modeRef.current = mode;

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

	// ── Fit to container ─────────────────────────────────────────────────────

	const fitToView = useCallback(() => {
		const area = previewAreaRef.current;
		if (!area) return;

		const v = videoRef.current;
		const kSize = keyedImageSizeRef.current;
		const oSize = origImageSizeRef.current;
		const srcW = (modeRef.current === 'keying' ? kSize?.w : undefined) ?? oSize?.w ?? v?.videoWidth ?? kSize?.w ?? 0;
		const srcH = (modeRef.current === 'keying' ? kSize?.h : undefined) ?? oSize?.h ?? v?.videoHeight ?? kSize?.h ?? 0;
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
			v.play().catch(() => {});
			if (!hasAutoFitRef.current) {
				hasAutoFitRef.current = true;
				requestAnimationFrame(fitToView);
			}
		};
		v.addEventListener('loadedmetadata', onMeta, { once: true });
		return () => v.removeEventListener('loadedmetadata', onMeta);
	}, [fileUrl, isImage, fitToView]);

	// ── Sync playing state ────────────────────────────────────────────────────

	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;
		const onPlay  = () => setPlaying(true);
		const onPause = () => setPlaying(false);
		setPlaying(!v.paused);
		v.addEventListener('play', onPlay);
		v.addEventListener('pause', onPause);
		return () => {
			v.removeEventListener('play', onPlay);
			v.removeEventListener('pause', onPause);
		};
	}, [fileUrl]);

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

	// ── RAF loop: progress bar + live keyed render ─────────────────────────

	useEffect(() => {
		const loop = () => {
			const v = videoRef.current;
			if (v && v.duration > 0) {
				toolbarRef.current?.update(v.currentTime, v.duration);
			}
			if (modeRef.current === 'keying') drawKeyed();
			rafRef.current = requestAnimationFrame(loop);
		};
		rafRef.current = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(rafRef.current);
	}, [drawKeyed]);

	// Сбрасываем hover при уходе с keying-режима
	useEffect(() => {
		if (mode !== 'keying') onPixelHover?.(null);
	}, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Auto-switch to keying mode when settings change ─────────────────────

	const settingsStr = JSON.stringify(settings);
	useEffect(() => {
		if (!filePath) return;
		setMode('keying');
	}, [settingsStr, filePath]);

	// ── Seek ──────────────────────────────────────────────────────────────────

	const seekTo = useCallback((ratio: number) => {
		const v = videoRef.current;
		if (!v) return;
		const t = ratio * durationRef.current;
		v.currentTime = t;
		onTimecodeChange?.(t);
	}, [onTimecodeChange]);

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
	}, [onTimecodeChange]);

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
		if (mode !== 'keying' || !onPixelHover) return;
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
	}, [mode, onPixelHover]);

	const handlePreviewMouseLeave = useCallback(() => {
		cancelAnimationFrame(rafHoverRef.current);
		onPixelHover?.(null);
	}, [onPixelHover]);

	// ── Compute display style ────────────────────────────────────────────────

	const v = videoRef.current;
	const vidW = v?.videoWidth || 1920;
	const vidH = v?.videoHeight || 1080;

	const displayW = (mode === 'keying' && keyedImageSize)
		? keyedImageSize.w
		: (origImageSize?.w ?? vidW);
	const displayH = (mode === 'keying' && keyedImageSize)
		? keyedImageSize.h
		: (origImageSize?.h ?? vidH);

	const mediaStyle: React.CSSProperties = {
		position: 'absolute',
		left: transform.offsetX,
		top: transform.offsetY,
		width: displayW * transform.scale,
		height: displayH * transform.scale,
		imageRendering: 'auto',
	};

	const hasKeyed = mode === 'keying' && !!keyedImageSize;

	// ── Render ────────────────────────────────────────────────────────────────

	const hasKnownSize = origImageSize !== null || (videoRef.current?.videoWidth ?? 0) > 0 || keyedImageSize !== null;

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

				{/* Static image — always mounted (display source for both modes) */}
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
						style={mode === 'original'
							? mediaStyle
							: { position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }
						}
						alt='Original'
					/>
				)}

				{/* <video> всегда в DOM для получения videoWidth/timecode (скрыт для картинок) */}
				{fileUrl && !isImage && (
					<video
						ref={videoRef}
						crossOrigin='anonymous'
						src={fileUrl}
						loop
						muted
						playsInline
						style={mode === 'original'
							? mediaStyle
							: { position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }
						}
					/>
				)}

				{/* Keyed preview — live canvas; checkerboard shows alpha through transparent pixels */}
				<canvas
					ref={keyingCanvasRef}
					style={{
						...mediaStyle,
						...checkerboardStyle,
						display: hasKeyed ? 'block' : 'none',
						pointerEvents: 'none',
					}}
				/>

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

			{/* Controls */}
			<PreviewToolbar
				ref={toolbarRef}
				playing={playing}
				onTogglePlay={togglePlay}
				onSeek={seekTo}
				showPlayback={!isImage}
				showFrameStep
				onStepFrame={stepFrame}
				height={isImage ? CONTROLS_H / 2 : CONTROLS_H}
				bottomSlot={
					<div style={{ display: 'flex', gap: 4 }}>
						{(['original', 'keying'] as const).map((m) => (
							<button
								key={m}
								onClick={() => setMode(m)}
								style={{
									flex: 1, padding: '3px 8px', fontSize: 10,
									fontWeight: mode === m ? 600 : 400,
									cursor: 'pointer', borderRadius: 3,
									border: `1px solid ${mode === m ? '#5a9fd4' : '#333'}`,
									background: mode === m ? '#1e3a5f' : '#1a1a1a',
									color: mode === m ? '#8ec8f0' : '#666',
									outline: 'none', textTransform: 'capitalize',
								}}
							>
								{m === 'original' ? 'Original' : 'Keying Preview'}
							</button>
						))}
					</div>
				}
			/>
		</div>
	);
}
