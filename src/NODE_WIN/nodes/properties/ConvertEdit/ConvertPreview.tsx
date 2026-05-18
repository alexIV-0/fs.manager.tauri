// src/NODE_WIN/nodes/properties/ConvertEdit/ConvertPreview.tsx
//
// Left panel: original video/image playback + converted frame preview.
// - Video plays via <video> for navigation (pick the right frame)
// - Converted preview is a static PNG from ffmpeg via IPC
// - Toggle between "Original" and "Converted" modes
// - Zoom: scroll wheel, Pan: middle mouse drag, Double-click: fit to view

import { useRef, useState, useEffect, useCallback } from 'react';
import { toFileUrl } from '@/Utils/mediaUtils';
import { ConvertSettings, buildPreviewFilterString, FALLBACK_IMAGE_FORMATS } from './types';
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
	const containerRef   = useRef<HTMLDivElement>(null);
	const previewAreaRef = useRef<HTMLDivElement>(null);
	const videoRef       = useRef<HTMLVideoElement>(null);
	const toolbarRef     = useRef<PreviewToolbarHandle>(null);
	const rafRef         = useRef<number>(0);
	const durationRef    = useRef(0);

	const [playing,      setPlaying]      = useState(false);
	const [mode,         setMode]         = useState<'original' | 'converted'>('original');
	const [convertedImg, setConvertedImg] = useState<string>('');
	const [loading,      setLoading]      = useState(false);

	// ── Image size of the converted PNG ────────────────────────────────────
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
	const fileTypesRef = useRef(fileTypes);
	fileTypesRef.current = fileTypes;

	// Computed at render time so both the overlay and requestConvertPreview can use it
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

	// Reset sizes and auto-fit guard on file change
	useEffect(() => {
		setOrigImageSize(null);
		origImageSizeRef.current = null;
		setOrigVideoSize(null);
		hasAutoFitRef.current = false;
	}, [filePath]);

	// ── Fit to view ─────────────────────────────────────────────────────────

	const fitToView = useCallback(() => {
		const area = previewAreaRef.current;
		if (!area) return;
		const v     = videoRef.current;
		const kSize = convertedSizeRef.current;
		const oSize = origImageSizeRef.current;
		const srcW  = kSize?.w ?? oSize?.w ?? v?.videoWidth  ?? 0;
		const srcH  = kSize?.h ?? oSize?.h ?? v?.videoHeight ?? 0;
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

	// ── Autoplay on file load ───────────────────────────────────────────────

	const [playbackError, setPlaybackError] = useState(false);

	useEffect(() => {
		if (!fileUrl) return;
		const v = videoRef.current;
		if (!v) return;
		setPlaybackError(false);
		const onMeta = () => {
			durationRef.current = v.duration;
			setOrigVideoSize({ w: v.videoWidth, h: v.videoHeight });
			onOrigSizeDetected?.(v.videoWidth, v.videoHeight);
			// No autoplay — user starts playback manually.
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
	}, [fileUrl, fitToView]);

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

	// ── RAF loop for progress bar ──────────────────────────────────────────

	useEffect(() => {
		const loop = () => {
			const v = videoRef.current;
			if (v && v.duration > 0) {
				toolbarRef.current?.update(v.currentTime, v.duration);
			}
			rafRef.current = requestAnimationFrame(loop);
		};
		rafRef.current = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(rafRef.current);
	}, []);

	// ── Update offscreen tracking when converted image arrives ─────────────

	useEffect(() => {
		if (!convertedImg) {
			setConvertedSize(null);
			return;
		}
		const img   = new Image();
		img.onload  = () => {
			const size = { w: img.naturalWidth, h: img.naturalHeight };
			const prev = convertedSizeRef.current;
			setConvertedSize(size);
			convertedSizeRef.current = size;
			// Re-fit when: first load OR output dimensions changed (e.g. Frame size changed).
			// Do NOT re-fit for filter changes that keep the same dimensions (blur, eq, etc.).
			const dimsChanged = !prev || prev.w !== size.w || prev.h !== size.h;
			if (!hasAutoFitRef.current || dimsChanged) {
				hasAutoFitRef.current = true;
				requestAnimationFrame(() => fitToView());
			}
		};
		img.src = convertedImg;
	}, [convertedImg, fitToView]);

	// ── Request converted preview via IPC ──────────────────────────────────

	const filePathRef  = useRef(filePath);
	const settingsRef  = useRef(settings);
	filePathRef.current  = filePath;
	settingsRef.current  = settings;

	const origVideoSizeRef = useRef(origVideoSize);
	origVideoSizeRef.current = origVideoSize;

	const requestConvertPreview = useCallback(async () => {
		const fp = filePathRef.current;
		const s  = settingsRef.current;
		if (!fp) return;

		// Resolve frame.mode='original' → fixed source dims so Position / cover-fill work consistently.
		const srcW = origVideoSizeRef.current?.w ?? origImageSizeRef.current?.w ?? 0;
		const srcH = origVideoSizeRef.current?.h ?? origImageSizeRef.current?.h ?? 0;
		const resolved: ConvertSettings = s.video.frame.mode === 'original' && srcW > 0 && srcH > 0
			? { ...s, video: { ...s.video, frame: { ...s.video.frame, mode: 'fixed', width: srcW, height: srcH } } }
			: s;

		const filterString = buildPreviewFilterString(resolved, outputModeRef.current);
		const v  = videoRef.current;
		const tc = v ? v.currentTime : 0;
		setLoading(true);

		try {
			const result = await (window as any).electronAPI.invoke('convert-preview', {
				filePath: fp,
				timecode: tc,
				filterString: filterString || 'null',
			});
			setConvertedImg(result || '');
		} catch {
			setConvertedImg('');
		} finally {
			setLoading(false);
		}
	}, []);

	// Auto-switch to converted mode and refresh when settings change
	const settingsStr = JSON.stringify(settings);
	useEffect(() => {
		if (!filePath) return;
		setMode('converted');
		requestConvertPreview();
	}, [settingsStr, filePath]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (mode === 'converted') requestConvertPreview();
	}, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

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
				{fileUrl && (origW > 0 || !!convertedImg) && (
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

				{/* Static image (original mode) */}
				{fileUrl && isImage && mode === 'original' && (
					<img
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
						style={{ ...mediaStyle, zIndex: 1 }}
						alt='Original'
					/>
				)}

				{/* Video element — always mounted for timecode/dimensions */}
				{fileUrl && !isImage && (
					<video
						ref={videoRef}
						src={fileUrl}
						loop
						muted
						playsInline
						style={mode === 'original'
							? { ...mediaStyle, zIndex: 1 }
							: { position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }
						}
					/>
				)}

				{/* Converted preview — checkerboard shows alpha through transparent pixels */}
				{mode === 'converted' && convertedImg && (
					<img
						src={convertedImg}
						style={{ ...mediaStyle, ...checkerboardStyle, zIndex: 1 }}
						alt='Converted preview'
					/>
				)}

				{mode === 'converted' && loading && (
					<div style={{
						position: 'absolute', inset: 0, zIndex: 2,
						display: 'flex', alignItems: 'center', justifyContent: 'center',
						color: 'rgba(255,255,255,0.5)', fontSize: 12, pointerEvents: 'none',
					}}>
						Processing…
					</div>
				)}

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
						color: 'rgba(0,0,0,0.4)', fontSize: 13, pointerEvents: 'none',
					}}>
						Select file to preview
					</div>
				)}

				{/* Zoom indicator */}
				<div style={{
					position: 'absolute', bottom: 4, right: 8, zIndex: 3,
					color: 'rgba(0,0,0,0.4)', fontSize: 10, fontFamily: 'monospace', pointerEvents: 'none',
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
				rightSlot={
					<button
						onClick={requestConvertPreview}
						style={{
							padding: '2px 8px', borderRadius: 3,
							border: '1px solid #333', background: '#252525', color: '#888',
							cursor: 'pointer', fontSize: 10, outline: 'none',
						}}
						title='Refresh converted frame at current timecode'
					>
						↺ Refresh
					</button>
				}
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
