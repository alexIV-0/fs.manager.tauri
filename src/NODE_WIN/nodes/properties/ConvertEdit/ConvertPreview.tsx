// src/NODE_WIN/nodes/properties/ConvertEdit/ConvertPreview.tsx
//
// Left panel: original video/image playback + converted frame preview.
// - Video plays via <video> for navigation (pick the right frame)
// - Converted preview is rendered live on a <canvas> (client-side, no ffmpeg) —
//   same approach as the ffSwitch (VideoAdjust) preview. See convertPreviewCanvas.ts.
// - Toggle between "Original" and "Converted" modes
// - Zoom: scroll wheel, Pan: middle mouse drag, Double-click: fit to view

import { useRef, useState, useEffect, useCallback } from 'react';
import { toFileUrl } from '@/Utils/mediaUtils';
import { ConvertSettings, FALLBACK_IMAGE_FORMATS } from './types';
import { renderConvertPreview } from './convertPreviewCanvas';
import { checkerboardStyle } from '@/Utils/CheckerboardBg';
import { typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import ConvertHandleOverlay from './ConvertHandleOverlay';
import PreviewToolbar, { type PreviewToolbarHandle } from '../PreviewToolbar';

const CONTROLS_H = 84;
const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

interface ConvertPreviewProps {
	filePath: string;
	settings: ConvertSettings;
	/** Fires when the timecode changes so the panel can show it */
	onTimecodeChange?: (tc: number) => void;
	/** Called when interactive handles change a filter value */
	onSettingsChange?: (s: ConvertSettings) => void;
	/** Fires once when the source file dimensions become known */
	onOrigSizeDetected?: (w: number, h: number) => void;
}

export default function ConvertPreview({ filePath, settings, onTimecodeChange, onSettingsChange, onOrigSizeDetected }: ConvertPreviewProps) {
	const containerRef    = useRef<HTMLDivElement>(null);
	const previewAreaRef  = useRef<HTMLDivElement>(null);
	const videoRef        = useRef<HTMLVideoElement>(null);
	const imgRef          = useRef<HTMLImageElement>(null);
	const convertedCanvasRef = useRef<HTMLCanvasElement>(null);
	const toolbarRef      = useRef<PreviewToolbarHandle>(null);
	const rafRef          = useRef<number>(0);
	const durationRef     = useRef(0);

	const [playing, setPlaying] = useState(false);
	const [mode,    setMode]    = useState<'original' | 'converted'>('original');
	const modeRef = useRef(mode);
	modeRef.current = mode;

	// ── Converted output size (from the rendered canvas) ───────────────────
	const [convertedSize, setConvertedSize] = useState<{ w: number; h: number } | null>(null);
	const convertedSizeRef = useRef(convertedSize);
	convertedSizeRef.current = convertedSize;

	// ── Original image size (for static image files) ───────────────────────
	const [origImageSize, setOrigImageSize] = useState<{ w: number; h: number } | null>(null);
	const origImageSizeRef = useRef(origImageSize);
	origImageSizeRef.current = origImageSize;

	// ── Original video size (from loadedmetadata) ──────────────────────────
	const [origVideoSize, setOrigVideoSize] = useState<{ w: number; h: number } | null>(null);

	// ── Auto-fit guard: only fit to view on first load per file ───────────
	const hasAutoFitRef = useRef(false);

	// ── Zoom / Pan ─────────────────────────────────────────────────────────
	const [transform, setTransform]      = useState({ scale: 1, offsetX: 0, offsetY: 0 });
	const transformRef                   = useRef(transform);
	transformRef.current                 = transform;
	const isPanningRef                   = useRef(false);
	const lastPanPosRef                  = useRef({ x: 0, y: 0 });

	// ── Store + derived outputMode ─────────────────────────────────────────
	const fileTypes    = typeOfFile_store((s) => s.patternStore);

	// Computed at render time so both the overlay and the canvas renderer can use it
	const imageExts  = fileTypes.find((e) => e.id === 'image')?.path ?? FALLBACK_IMAGE_FORMATS;
	const audioExts  = fileTypes.find((e) => e.id === 'audio')?.path ?? [];
	const outputExt  = settings.outputExtension.toLowerCase();
	const outputMode: 'image' | 'video' | 'audio' =
		imageExts.includes(outputExt) ? 'image' :
		audioExts.includes(outputExt) ? 'audio' :
		'video';
	const outputModeRef = useRef(outputMode);
	outputModeRef.current = outputMode;

	const fileUrl = filePath ? toFileUrl(filePath) : '';

	const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'tga', 'dpx']);
	const fileExt    = filePath.split('.').pop()?.toLowerCase() ?? '';
	const isImage    = IMAGE_EXTS.has(fileExt);

	const settingsRef = useRef(settings);
	settingsRef.current = settings;

	// Reset sizes and auto-fit guard on file change
	useEffect(() => {
		setOrigImageSize(null);
		origImageSizeRef.current = null;
		setOrigVideoSize(null);
		setConvertedSize(null);
		convertedSizeRef.current = null;
		hasAutoFitRef.current = false;
	}, [filePath]);

	// ── Fit to view ─────────────────────────────────────────────────────────

	const fitToView = useCallback(() => {
		const area = previewAreaRef.current;
		if (!area) return;
		const v     = videoRef.current;
		const kSize = convertedSizeRef.current;
		const oSize = origImageSizeRef.current;
		const srcW  = (modeRef.current === 'converted' ? kSize?.w : undefined) ?? oSize?.w ?? v?.videoWidth  ?? kSize?.w ?? 0;
		const srcH  = (modeRef.current === 'converted' ? kSize?.h : undefined) ?? oSize?.h ?? v?.videoHeight ?? kSize?.h ?? 0;
		if (!srcW || !srcH) return;
		const scale = Math.min((area.clientWidth - 20) / srcW, (area.clientHeight - 20) / srcH);
		const t = {
			scale,
			offsetX: (area.clientWidth  - srcW * scale) / 2,
			offsetY: (area.clientHeight - srcH * scale) / 2,
		};
		transformRef.current = t;
		setTransform(t);
	}, []);

	// ── Video metadata / size detection ───────────────────────────────────

	const [playbackError, setPlaybackError] = useState(false);

	useEffect(() => {
		if (!fileUrl || isImage) return;
		const v = videoRef.current;
		if (!v) return;
		setPlaybackError(false);
		const onMeta = () => {
			durationRef.current = v.duration;
			setOrigVideoSize({ w: v.videoWidth, h: v.videoHeight });
			onOrigSizeDetected?.(v.videoWidth, v.videoHeight);
			// A hidden, paused video doesn't reliably decode a frame for the canvas in
			// WKWebView. Autoplay (muted+loop) keeps decoded frames flowing — same proven
			// approach as the ffSwitch/VideoAdjust preview. User can pause/seek afterwards.
			v.play().catch(() => { /* ignore autoplay rejection */ });
			if (!hasAutoFitRef.current) {
				hasAutoFitRef.current = true;
				requestAnimationFrame(fitToView);
			}
		};
		const onError = () => setPlaybackError(true);
		v.addEventListener('loadedmetadata', onMeta, { once: true });
		v.addEventListener('error', onError);
		return () => {
			v.removeEventListener('loadedmetadata', onMeta);
			v.removeEventListener('error', onError);
		};
	}, [fileUrl, isImage, fitToView, onOrigSizeDetected]);

	// ── Sync playing state ─────────────────────────────────────────────────

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

	// ── Draw converted frame onto the canvas (client-side, no ffmpeg) ──────

	const drawConverted = useCallback(() => {
		const cvs = convertedCanvasRef.current;
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

		const rendered = renderConvertPreview(source, sw, sh, settingsRef.current, outputModeRef.current);
		if (!rendered) return;

		if (cvs.width !== rendered.width || cvs.height !== rendered.height) {
			cvs.width = rendered.width;
			cvs.height = rendered.height;
		}
		const ctx = cvs.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, cvs.width, cvs.height);
		ctx.drawImage(rendered, 0, 0);

		const prev = convertedSizeRef.current;
		if (!prev || prev.w !== rendered.width || prev.h !== rendered.height) {
			const size = { w: rendered.width, h: rendered.height };
			convertedSizeRef.current = size;
			setConvertedSize(size);
			// Re-fit on first load or when output dimensions change.
			if (!hasAutoFitRef.current || !prev || prev.w !== size.w || prev.h !== size.h) {
				hasAutoFitRef.current = true;
				requestAnimationFrame(() => fitToView());
			}
		}
	}, [isImage, fitToView]);

	// ── RAF loop: progress bar + live converted render ─────────────────────

	useEffect(() => {
		const loop = () => {
			const v = videoRef.current;
			if (v && v.duration > 0) {
				toolbarRef.current?.update(v.currentTime, v.duration);
			}
			if (modeRef.current === 'converted') drawConverted();
			rafRef.current = requestAnimationFrame(loop);
		};
		rafRef.current = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(rafRef.current);
	}, [drawConverted]);

	// Auto-switch to converted mode when settings change so the user sees the effect.
	const settingsStr = JSON.stringify(settings);
	useEffect(() => {
		if (!filePath) return;
		setMode('converted');
	}, [settingsStr, filePath]);

	// ── Seek ───────────────────────────────────────────────────────────────

	const seekTo = useCallback((ratio: number) => {
		const v = videoRef.current;
		if (!v) return;
		const t = ratio * durationRef.current;
		v.currentTime = t;
		onTimecodeChange?.(t);
	}, [onTimecodeChange]);

	const togglePlay = useCallback(() => {
		const v = videoRef.current;
		if (!v) return;
		if (v.paused) v.play().catch(() => {}); else v.pause();
	}, []);

	const stepFrame = useCallback((dir: 1 | -1) => {
		const v = videoRef.current;
		if (!v) return;
		v.pause();
		v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + dir * (1 / 30)));
		onTimecodeChange?.(v.currentTime);
	}, [onTimecodeChange]);

	// ── Zoom ───────────────────────────────────────────────────────────────

	useEffect(() => {
		const area = previewAreaRef.current;
		if (!area) return;
		const handleWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect  = area.getBoundingClientRect();
			const mx    = e.clientX - rect.left;
			const my    = e.clientY - rect.top;
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

	// ── Pan (middle mouse) ─────────────────────────────────────────────────

	useEffect(() => {
		const area = previewAreaRef.current;
		if (!area) return;
		const onDown = (e: MouseEvent) => {
			if (e.button !== 1) return;
			e.preventDefault();
			isPanningRef.current = true;
			lastPanPosRef.current = { x: e.clientX, y: e.clientY };
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
		const onUp = (e: MouseEvent) => { if (e.button === 1) isPanningRef.current = false; };
		area.addEventListener('mousedown', onDown);
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup',   onUp);
		return () => {
			area.removeEventListener('mousedown', onDown);
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup',   onUp);
		};
	}, []);

	// ── Display dimensions ─────────────────────────────────────────────────

	const v        = videoRef.current;
	const vidW     = v?.videoWidth  || 1920;
	const vidH     = v?.videoHeight || 1080;
	const displayW = mode === 'converted' && convertedSize ? convertedSize.w : (origImageSize?.w ?? vidW);
	const displayH = mode === 'converted' && convertedSize ? convertedSize.h : (origImageSize?.h ?? vidH);

	// Original frame dimensions for the frame-boundary outline
	const origW = origImageSize?.w ?? origVideoSize?.w ?? 0;
	const origH = origImageSize?.h ?? origVideoSize?.h ?? 0;

	const mediaStyle: React.CSSProperties = {
		position: 'absolute',
		left:     transform.offsetX,
		top:      transform.offsetY,
		width:    displayW * transform.scale,
		height:   displayH * transform.scale,
		imageRendering: 'auto',
	};

	const hasConverted = mode === 'converted' && !!convertedSize;

	// ── Render ─────────────────────────────────────────────────────────────

	return (
		<div
			ref={containerRef}
			style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#111111' }}
		>
			{/* Preview area */}
			<div
				ref={previewAreaRef}
				style={{
					flex: 1, position: 'relative', overflow: 'hidden', cursor: 'default',
					background: '#111111',
				}}
				onDoubleClick={fitToView}
			>
				{/* Frame background — checkerboard + border */}
				{fileUrl && (origW > 0 || hasConverted) && (
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

				{/* Interactive scale / crop / position handles */}
				{onSettingsChange && (
					<ConvertHandleOverlay
						settings={settings}
						outputMode={outputMode}
						previewMode={mode}
						origW={origW}
						origH={origH}
						displayW={displayW}
						displayH={displayH}
						transform={transform}
						onSettingsChange={onSettingsChange}
					/>
				)}

				{/* Static image — always mounted (display source for both modes) */}
				{fileUrl && isImage && (
					<img
						ref={imgRef}
						crossOrigin='anonymous'
						src={fileUrl}
						onLoad={(e) => {
							const img  = e.currentTarget;
							const size = { w: img.naturalWidth, h: img.naturalHeight };
							setOrigImageSize(size);
							origImageSizeRef.current = size;
							onOrigSizeDetected?.(img.naturalWidth, img.naturalHeight);
							if (!hasAutoFitRef.current) {
								hasAutoFitRef.current = true;
								requestAnimationFrame(() => fitToView());
							}
						}}
						style={mode === 'original'
							? { ...mediaStyle, zIndex: 1 }
							: { position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }
						}
						alt='Original'
					/>
				)}

				{/* Video element — always mounted for timecode/dimensions/converted source */}
				{fileUrl && !isImage && (
					<video
						ref={videoRef}
						crossOrigin='anonymous'
						src={fileUrl}
						loop
						muted
						playsInline
						preload='auto'
						style={mode === 'original'
							? { ...mediaStyle, zIndex: 1 }
							: { position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }
						}
					/>
				)}

				{/* Converted preview — live canvas; checkerboard shows alpha through transparent pixels */}
				<canvas
					ref={convertedCanvasRef}
					style={{
						...mediaStyle,
						...checkerboardStyle,
						zIndex: 1,
						display: hasConverted ? 'block' : 'none',
					}}
				/>

				{mode === 'original' && !isImage && fileUrl && playbackError && (
					<div style={{
						position: 'absolute', inset: 0, zIndex: 2,
						display: 'flex', alignItems: 'center', justifyContent: 'center',
						color: 'rgba(255,180,120,0.85)', fontSize: 12, pointerEvents: 'none',
						textAlign: 'center', padding: 16,
					}}>
						Preview playback not supported for this codec.<br/>
						Switch to “Converted Preview” to view a rendered frame.
					</div>
				)}

				{!fileUrl && (
					<div style={{
						position: 'absolute', inset: 0, zIndex: 2,
						display: 'flex', alignItems: 'center', justifyContent: 'center',
						color: 'rgba(255,255,255,0.3)', fontSize: 13, pointerEvents: 'none',
					}}>
						Select file to preview
					</div>
				)}

				{/* Zoom indicator */}
				<div style={{
					position: 'absolute', bottom: 4, right: 8, zIndex: 3,
					color: 'rgba(255,255,255,0.35)', fontSize: 10, fontFamily: 'monospace', pointerEvents: 'none',
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
						{(['original', 'converted'] as const).map((m) => (
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
								{m === 'original' ? 'Original' : 'Converted Preview'}
							</button>
						))}
					</div>
				}
			/>
		</div>
	);
}
