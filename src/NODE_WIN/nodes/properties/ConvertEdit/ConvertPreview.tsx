// src/NODE_WIN/nodes/properties/ConvertEdit/ConvertPreview.tsx
//
// Left panel: converted-frame preview with the unified render-bar workflow (same as
// KeyingPreview). Live client-side canvas approximation (🟡) → accurate ffmpeg frame
// swapped in on pause (🟢). The old Original/Converted toggle is gone — fidelity is
// shown by the corner dot, not chosen. Render-bar timeline shows cached cells & scrubs.
// Interactive scale/crop/position handles (ConvertHandleOverlay) stay.

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useWavesurfer } from '@wavesurfer/react';
import { toFileUrl } from '@/Utils/mediaUtils';
import { commands, unwrap } from '@/Utils/specta';
import type { PreviewRenderSpec } from '@/bindings';
import { ConvertSettings, FALLBACK_IMAGE_FORMATS, buildPreviewFilterString, buildAudioFilterString } from './types';
import { renderConvertPreview } from './convertPreviewCanvas';
import { checkerboardStyle } from '@/Utils/CheckerboardBg';
import { typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import ConvertHandleOverlay from './ConvertHandleOverlay';
import PreviewToolbar, { type PreviewToolbarHandle } from '../PreviewToolbar';
import PreviewTimeline, { type PreviewTimelineHandle } from '../PreviewTimeline';
import PreviewStateDot from '../PreviewStateDot';
import { usePreviewCache } from '../usePreviewCache';
import { PreviewState } from '../previewState';

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
	const timelineRef     = useRef<PreviewTimelineHandle>(null);
	const rafRef          = useRef<number>(0);
	const durationRef     = useRef(0);

	const [playing, setPlaying] = useState(false);
	const [duration, setDuration] = useState(0);
	// View toggle: 'original' for editing crop on the source frame, 'converted' (Result)
	// for the rendered output where the accurate-frame engine lives.
	const [mode, setMode] = useState<'converted' | 'compare'>('converted');
	const [wipeX, setWipeX] = useState(50); // % положение полосы сравнения (режим compare)
	const wipeGeomRef = useRef({ offsetX: 0, offsetY: 0, scale: 1, displayW: 1, displayH: 1 });
	const regionRef = useRef<{ start: number; end: number } | null>(null); // выбранный регион на вейвформе
	const regionPlayRef = useRef(false); // идёт ли зацикленное проигрывание региона
	const audioRef = useRef<HTMLAudioElement>(null); // плеер отрендеренного аудио-региона
	const [audioMode, setAudioMode] = useState<'original' | 'processed'>('processed');
	const audioModeRef = useRef(audioMode);
	audioModeRef.current = audioMode;
	const [audioErr, setAudioErr] = useState<string | null>(null);
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

	// ── Filtergraph (single source of truth — same builder as the export) ───
	const settingsStr = JSON.stringify(settings);
	const filterGraph = useMemo(
		() => buildPreviewFilterString(settings, outputMode),
		[settingsStr, outputMode], // eslint-disable-line react-hooks/exhaustive-deps
	);
	// Audio output has no frame to render; an empty graph means "no visible change".
	const hasEffect = outputMode !== 'audio' && filterGraph.length > 0;

	const cellCount = useMemo(
		() => (duration > 0 ? Math.min(600, Math.max(20, Math.round(duration * 4))) : 1),
		[duration],
	);

	const buildSpec = useCallback(
		(time: number): PreviewRenderSpec | null => {
			if (!filePath || !hasEffect) return null;
			return {
				inputs: [{ path: filePath, seek: time }],
				filterGraph,
				complex: false,
				outLabel: null,
				time,
				maxDim: null,
				namespace: 'convert',
			};
		},
		[filePath, hasEffect, filterGraph],
	);

	const { cellStates, frameUrl, frameState, requestFrame } = usePreviewCache({
		duration,
		cellCount,
		buildSpec,
		graphKey: `${filePath}|${outputMode}|${filterGraph}`,
	});

	// Второй пайплайн: оригинал через ffmpeg (пустой фильтрграф) — для кадр-в-кадр Compare
	// (тот же декодер, что и у результата → нет рассинхрона браузер/ffmpeg).
	const buildOrigSpec = useCallback(
		(time: number): PreviewRenderSpec | null =>
			filePath ? { inputs: [{ path: filePath, seek: time }], filterGraph: '', complex: false, outLabel: null, time, maxDim: null, namespace: 'convert-orig' } : null,
		[filePath],
	);
	const origPreview = usePreviewCache({ duration, cellCount, buildSpec: buildOrigSpec, graphKey: `${filePath}|orig` });

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

	// ── Video metadata / size detection ───────────────────────────────────

	const [playbackError, setPlaybackError] = useState(false);

	useEffect(() => {
		if (!fileUrl || isImage) return;
		const v = videoRef.current;
		if (!v) return;
		setPlaybackError(false);
		const onMeta = () => {
			durationRef.current = v.duration;
			setDuration(v.duration);
			setOrigVideoSize({ w: v.videoWidth, h: v.videoHeight });
			onOrigSizeDetected?.(v.videoWidth, v.videoHeight);
			// A hidden, paused video doesn't reliably decode a frame for the canvas in
			// WKWebView. Autoplay (muted+loop) keeps decoded frames flowing — same proven
			// approach as the ffSwitch/VideoAdjust preview. User can pause/seek afterwards.
			// Декодируем первый кадр, но НЕ оставляем воспроизведение — стартуем на паузе.
			v.play().then(() => v.pause()).catch(() => {});
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

	// ── Sync playing state + request an accurate frame on pause ─────────────

	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;
		const onPlay  = () => setPlaying(true);
		const onPause = () => {
			setPlaying(false);
			requestFrame(v.currentTime);
			if (modeRef.current === 'compare') origPreview.requestFrame(v.currentTime);
		};
		setPlaying(!v.paused);
		v.addEventListener('play', onPlay);
		v.addEventListener('pause', onPause);
		return () => {
			v.removeEventListener('play', onPlay);
			v.removeEventListener('pause', onPause);
		};
	}, [fileUrl, requestFrame]);

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

	// ── RAF loop: progress + timeline playhead + live converted render ──────

	useEffect(() => {
		const loop = () => {
			const v = videoRef.current;
			if (v && v.duration > 0) {
				const r = regionRef.current;
				if (regionPlayRef.current && r && !v.paused && v.currentTime >= r.end) v.currentTime = r.start;
				toolbarRef.current?.update(v.currentTime, v.duration);
				timelineRef.current?.update(v.currentTime, v.duration);
			}
			drawConverted();
			rafRef.current = requestAnimationFrame(loop);
		};
		rafRef.current = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(rafRef.current);
	}, [drawConverted]);

	// Пробел: play/pause. Регион выбран → играем аудио региона (зациклено, со звуком);
	// нет региона → играем видео целиком с оригинальным звуком.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== 'Space') return;
			const el = e.target as HTMLElement | null;
			const tag = el?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
			e.preventDefault();
			const v = videoRef.current;
			const a = audioRef.current;
			// Что-то играет → стоп всё.
			if ((a && !a.paused) || (v && !v.paused)) {
				a?.pause();
				if (v) { v.pause(); v.muted = true; }
				regionPlayRef.current = false;
				return;
			}
			const r = regionRef.current;
			if (r && a && filePath) {
				// Регион → играем выбранный режим (Original / Filtered).
				playRegionAudio(audioModeRef.current);
			} else if (v) {
				// Нет региона → видео целиком с оригинальным звуком.
				v.muted = false;
				regionPlayRef.current = false;
				v.play().catch(() => {});
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [filePath]);

	// Auto-switch to Result view when settings change so the user sees the effect.
	useEffect(() => {
		if (!filePath) return;
		// настройки изменились — текущий режим (Result/Compare) не трогаем
	}, [settingsStr, filePath]);

	// ── Re-request the accurate frame when graph / file / duration / view changes ──

	useEffect(() => {
		if (!filePath || !hasEffect) return;
		if (!isImage && duration <= 0) return; // video: wait for metadata (duration)
		requestFrame(videoRef.current?.currentTime ?? 0);
		if (mode === 'compare') origPreview.requestFrame(videoRef.current?.currentTime ?? 0);
	}, [filterGraph, filePath, duration, hasEffect, isImage, outputMode, mode, requestFrame]);

	// ── Seek ───────────────────────────────────────────────────────────────

	const seekTo = useCallback((ratio: number) => {
		const v = videoRef.current;
		if (!v) return;
		regionPlayRef.current = false;
		audioRef.current?.pause();
		const t = ratio * durationRef.current;
		v.currentTime = t;
		onTimecodeChange?.(t);
		requestFrame(t);
		if (modeRef.current === 'compare') origPreview.requestFrame(t);
	}, [onTimecodeChange, requestFrame]);

	const handleRegion = useCallback((r: { start: number; end: number } | null) => {
		regionRef.current = r;
		regionPlayRef.current = false;
		audioRef.current?.pause();
	}, []);

	// Рендер + проигрывание аудио региона в выбранном режиме: 'processed' = с -af фильтрами,
	// 'original' = пустая цепочка (исходный участок). Один путь через preview_render_audio.
	const playRegionAudio = useCallback((m: 'original' | 'processed') => {
		const r = regionRef.current;
		const a = audioRef.current;
		if (!r || !a || !filePath) return;
		const filter = m === 'processed' ? buildAudioFilterString(settingsRef.current.audio) : '';
		commands
			.previewRenderAudio({ path: filePath, start: r.start, duration: Math.max(0.05, r.end - r.start), filter })
			.then((res) => {
				const out = unwrap(res);
				if (!audioRef.current) return;
				setAudioErr(null);
				audioRef.current.src = toFileUrl(out.path);
				audioRef.current.loop = true;
				audioRef.current.currentTime = 0;
				audioRef.current.play().catch(() => {});
			})
			.catch((err) => setAudioErr(String((err && (err as { message?: string }).message) || err)));
	}, [filePath]);

	const handlePlayMode = useCallback((m: 'original' | 'processed') => {
		videoRef.current?.pause();
		setAudioMode(m);
		audioModeRef.current = m;
		playRegionAudio(m);
	}, [playRegionAudio]);

	// Авто-сброс сообщения об ошибке аудио-превью.
	useEffect(() => {
		if (!audioErr) return;
		const t = window.setTimeout(() => setAudioErr(null), 6000);
		return () => window.clearTimeout(t);
	}, [audioErr]);

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
		requestFrame(v.currentTime);
		if (modeRef.current === 'compare') origPreview.requestFrame(v.currentTime);
	}, [onTimecodeChange, requestFrame]);

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
	const isCompare = mode === 'compare';
	// Активен crop-фильтр → показываем исходник с ручками (правка кропа), иначе результат.
	const cropActive = (outputMode === 'image' ? settings.image.filters : settings.video.filters).some((f) => f.type === 'crop' && f.enabled !== false);
	const cropEdit = mode === 'converted' && cropActive;
	const processedView = isCompare || (mode === 'converted' && !cropActive);
	const displayW = processedView && convertedSize ? convertedSize.w : (origImageSize?.w ?? vidW);
	const displayH = processedView && convertedSize ? convertedSize.h : (origImageSize?.h ?? vidH);

	// Original frame dimensions for the frame-boundary outline / handles
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
	wipeGeomRef.current = { offsetX: transform.offsetX, offsetY: transform.offsetY, scale: transform.scale, displayW, displayH };

	// ── Display rule per view ──────────────────────────────────────────────
	// Original view → source frame (+ crop handles). Result view → 🟡 live canvas,
	// swapped to 🟢 accurate ffmpeg frame on pause when an effect is active.
	const engineActive = processedView && hasEffect;
	const showGreen  = engineActive && !playing && frameState === 'cached' && !!frameUrl;
	const showCanvas = processedView && !showGreen;
	// Исходник (браузерный <video>/<img>) — база ТОЛЬКО при правке кропа; иначе скрыт.
	// В Compare оригинал берётся не отсюда, а из ffmpeg (origPreview) — кадр-в-кадр.
	const sourceStyle: React.CSSProperties = cropEdit
		? { ...mediaStyle, zIndex: 1 }
		: { position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' };
	// Перетаскивание полосы сравнения.
	const onWipeDown = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const move = (ev: MouseEvent) => {
			const area = previewAreaRef.current;
			if (!area) return;
			const g = wipeGeomRef.current;
			const w = g.displayW * g.scale;
			if (w <= 0) return;
			const x = ev.clientX - area.getBoundingClientRect().left - g.offsetX;
			setWipeX(Math.max(0, Math.min(100, (x / w) * 100)));
		};
		const up = () => {
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', up);
		};
		window.addEventListener('mousemove', move);
		window.addEventListener('mouseup', up);
	};
	const dotState: PreviewState =
		cropEdit ? 'original' : (!hasEffect ? 'original' : (showGreen ? 'cached' : 'approx'));

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
				{fileUrl && (origW > 0 || convertedSize) && (
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
				{onSettingsChange && !isCompare && outputMode !== 'audio' && (
					<ConvertHandleOverlay
						settings={settings}
						outputMode={outputMode}
						previewMode={cropEdit ? 'original' : 'converted'}
						origW={origW}
						origH={origH}
						displayW={displayW}
						displayH={displayH}
						transform={transform}
						onSettingsChange={onSettingsChange}
					/>
				)}

				{/* Static image — always mounted (display source / canvas source) */}
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
						style={sourceStyle}
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
						style={sourceStyle}
					/>
				)}

				{/* 🟡 Live converted approximation — client-side canvas over checkerboard */}
				<canvas
					ref={convertedCanvasRef}
					style={{
						...mediaStyle,
						...checkerboardStyle,
						zIndex: 1,
						display: showCanvas ? 'block' : 'none',
					}}
				/>

				{/* 🟢 Accurate ffmpeg frame — swapped in on pause for the cached cell */}
				{showGreen && frameUrl && (
					<img
						src={frameUrl}
						style={{ ...mediaStyle, zIndex: 1, pointerEvents: 'none' }}
						alt='Accurate preview'
					/>
				)}

				{/* Compare: оригинал через ffmpeg (кадр-в-кадр), слева от полосы.
				    Обрезка контейнером width+overflow (надёжнее clip-path в WKWebView). */}
				{isCompare && origPreview.frameUrl && (
					<div
						style={{
							position: 'absolute',
							left: transform.offsetX,
							top: transform.offsetY,
							width: Math.max(0, displayW * transform.scale * (wipeX / 100)),
							height: displayH * transform.scale,
							overflow: 'hidden',
							zIndex: 2,
							pointerEvents: 'none',
						}}
					>
						<img
							src={origPreview.frameUrl}
							style={{ position: 'absolute', left: 0, top: 0, width: displayW * transform.scale, height: displayH * transform.scale }}
							alt='Original'
						/>
					</div>
				)}

				{/* Compare wipe: polosa + side labels */}
				{isCompare && fileUrl && (
					<>
						<div style={{ position: 'absolute', left: transform.offsetX + 4, top: transform.offsetY + 4, zIndex: 3, padding: '1px 4px', fontSize: 9, borderRadius: 3, background: 'rgba(0,0,0,0.6)', color: '#8ec8f0', pointerEvents: 'none' }}>Original</div>
						<div style={{ position: 'absolute', left: transform.offsetX + displayW * transform.scale - 46, top: transform.offsetY + 4, zIndex: 3, padding: '1px 4px', fontSize: 9, borderRadius: 3, background: 'rgba(0,0,0,0.6)', color: '#a6e3a1', pointerEvents: 'none' }}>Result</div>
						<div
							onMouseDown={onWipeDown}
							style={{
								position: 'absolute',
								left: transform.offsetX + displayW * transform.scale * (wipeX / 100) - 1,
								top: transform.offsetY,
								width: 2,
								height: displayH * transform.scale,
								background: '#8ec8f0',
								cursor: 'ew-resize',
								zIndex: 3,
							}}
						>
							<div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 16, height: 16, borderRadius: '50%', background: '#8ec8f0', border: '2px solid #0a0a0a' }} />
						</div>
					</>
				)}

				{/* Audio output → вейвформа источника вместо видео-превью */}
				{outputMode === 'audio' && filePath && <ConvertAudioWave filePath={filePath} />}

				{/* Скрытый плеер отрендеренного аудио-региона (превью аудио-фильтров) */}
				<audio ref={audioRef} style={{ display: 'none' }} />

				{/* Fidelity indicator */}
				{fileUrl && (origW > 0 || convertedSize) && <PreviewStateDot state={dotState} showLabel />}

				{!isImage && fileUrl && playbackError && (
					<div style={{
						position: 'absolute', inset: 0, zIndex: 2,
						display: 'flex', alignItems: 'center', justifyContent: 'center',
						color: 'rgba(255,180,120,0.85)', fontSize: 12, pointerEvents: 'none',
						textAlign: 'center', padding: 16,
					}}>
						Preview playback not supported for this codec.<br/>
						Adjust settings to render a frame.
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

				{/* Ошибка аудио-превью (напр. фильтра нет в сборке ffmpeg) */}
				{audioErr && (
					<div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 7, background: 'rgba(120,20,20,0.92)', color: '#ffe', fontSize: 11, padding: '4px 10px', borderRadius: 4, maxWidth: '90%', textAlign: 'center', pointerEvents: 'none' }}>
						Аудио-превью не отрисовалось: {audioErr}
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

			{/* Controls — render-bar timeline replaces the thin progress bar */}
			<PreviewToolbar
				ref={toolbarRef}
				playing={playing}
				onTogglePlay={togglePlay}
				onSeek={seekTo}
				showPlayback={!isImage && outputMode !== 'audio'}
				showFrameStep
				onStepFrame={stepFrame}
				height={isImage ? CONTROLS_H / 2 : undefined}
				progressSlot={!isImage && outputMode !== 'audio' ? (
					<PreviewTimeline
						ref={timelineRef}
						duration={duration}
						cellCount={cellCount}
						cellStates={cellStates}
						onSeek={seekTo}
						audioUrl={filePath ? toFileUrl(filePath) : undefined}
						onRegion={handleRegion}
						audioMode={audioMode}
						onPlayMode={handlePlayMode}
					/>
				) : undefined}
				bottomSlot={
					<div style={{ display: 'flex', gap: 4 }}>
						{(['converted', 'compare'] as const).map((m) => (
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
									outline: 'none',
								}}
								title={m === 'compare' ? 'Сравнение оригинал/результат — тащи полосу' : 'Результат — точный кадр на паузе'}
							>
								{m === 'compare' ? 'Compare' : 'Result'}
							</button>
						))}
					</div>
				}
			/>
		</div>
	);
}

// Вейвформа источника для аудио-вывода (вместо видео-превью). Переиспользует wavesurfer
// (как PREVIEW_WIN/AudioPreview). Клик/драг по волне = seek.
function ConvertAudioWave({ filePath }: { filePath: string }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const { wavesurfer, isPlaying } = useWavesurfer({
		container: containerRef,
		url: toFileUrl(filePath),
		height: 150,
		waveColor: '#3a4a52',
		progressColor: '#4fc3f7',
		cursorColor: '#fff',
		cursorWidth: 1,
		barWidth: 2,
		barGap: 1,
		barRadius: 2,
		dragToSeek: true,
		normalize: true,
	});
	return (
		<div style={{ position: 'absolute', inset: 0, zIndex: 6, background: '#0d0d0d', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 24px' }}>
			<div ref={containerRef} style={{ width: '100%', cursor: 'pointer' }} />
			<div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
				<button
					onClick={() => wavesurfer?.playPause()}
					style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid #3a3a3a', background: '#252525', color: '#ddd', cursor: 'pointer', outline: 'none' }}
				>
					{isPlaying ? '⏸' : '▶'}
				</button>
				<span style={{ color: '#777', fontSize: 11, fontFamily: 'monospace' }}>Audio output — waveform (no video preview)</span>
			</div>
		</div>
	);
}
