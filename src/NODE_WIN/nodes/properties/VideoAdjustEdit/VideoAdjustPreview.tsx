// src/NODE_WIN/nodes/properties/VideoAdjustEdit/VideoAdjustPreview.tsx
//
// Canvas-based live preview:
//   • One <video> per layer — all copies read from it → guaranteed sync
//   • BG: плитка за плиткой (cover → boxblur → eq → hFlip), как в графе ffmpeg
//   • FG: space-evenly + fitPercent + слой тени (color+pad+boxblur, как в графе)
//   • Progress bar: direct DOM update from RAF (60fps, no React re-render)
//   • Pan/zoom: scroll wheel + middle mouse drag, double-click to fit
//   • Frame border + checkerboard background around canvas frame
//
// Живой канвас обязан показывать то же, что даст рендер: каждый шаг здесь — эмуляция
// КОНКРЕТНОГО фильтра из `ffSwitchGraph` (см. Utils/canvasFilters), а не «похожий» CSS-эффект.
// Не заменять обратно на ctx.filter / ctx.shadow*: первый в WKWebView не работает вовсе,
// второй даёт свою математику размытия и расходится с ffmpeg.

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { VideoAdjustSettings, FgShadowSettings, defaultFgShadow } from './types';
import { toFileUrl } from '@/Utils/mediaUtils';
import type { PreviewRenderSpec } from '@/bindings';
import { applyBoxBlur, applyFfmpegEq, makeShadowLayer } from '@/Utils/canvasFilters';
import { checkerboardStyle } from '@/Utils/CheckerboardBg';
import { buildFfSwitchGraph, bgBlurRadius, shadowGeometry } from '@/Utils/ffmpegGraphs/ffSwitchGraph';
import PreviewToolbar, { type PreviewToolbarHandle } from '../PreviewToolbar';
import PreviewTimeline, { type PreviewTimelineHandle } from '../PreviewTimeline';
import PreviewStateDot from '../PreviewStateDot';
import { usePreviewCache } from '../usePreviewCache';
import { PreviewState } from '../previewState';

const CONTROLS_H = 52;
const MIN_SCALE = 0.05;
const MAX_SCALE = 10;

/**
 * Буфер под BG-плитку. Плитки считаются по отдельности (как отдельные ветки графа), а
 * канвасы переиспользуются между кадрами — в RAF-цикле аллокации на кадр слишком дороги.
 */
function cellBuffer(cache: React.MutableRefObject<HTMLCanvasElement[]>, i: number, w: number, h: number): HTMLCanvasElement {
	let c = cache.current[i];
	if (!c) {
		c = document.createElement('canvas');
		cache.current[i] = c;
	}
	if (c.width !== w || c.height !== h) {
		c.width = w;
		c.height = h;
	}
	return c;
}

/** Слой тени зависит только от настроек и размера слота → считаем один раз и кэшируем. */
function shadowLayerFor(
	cache: React.MutableRefObject<{ key: string; canvas: HTMLCanvasElement } | null>,
	shadow: FgShadowSettings,
	w: number,
	h: number,
): HTMLCanvasElement {
	const g = shadowGeometry(shadow, w, h);
	// Раздувание входит в ключ через размер слоя: `g.width/height` уже с ним.
	const key = `${shadow.color}|${shadow.opacity}|${g.radius}|${g.power}|${g.width}x${g.height}`;
	if (cache.current?.key === key) return cache.current.canvas;
	const canvas = makeShadowLayer({
		color: shadow.color || '#000000',
		opacity: shadow.opacity ?? 0.6,
		width: g.width,
		height: g.height,
		pad: g.pad,
		radius: g.radius,
		power: g.power,
	});
	cache.current = { key, canvas };
	return canvas;
}

interface Props {
	fgFilePath: string;
	bgFilePath: string;
	settings: VideoAdjustSettings;
}

export default function VideoAdjustPreview({ fgFilePath, bgFilePath, settings }: Props) {
	const containerRef  = useRef<HTMLDivElement>(null);
	const previewAreaRef = useRef<HTMLDivElement>(null);
	const canvasRef     = useRef<HTMLCanvasElement>(null);
	const fgVideoRef    = useRef<HTMLVideoElement>(null);
	const bgVideoRef    = useRef<HTMLVideoElement>(null);
	const toolbarRef    = useRef<PreviewToolbarHandle>(null);
	const timelineRef   = useRef<PreviewTimelineHandle>(null);
	const rafRef        = useRef<number>(0);
	const settingsRef   = useRef(settings);
	settingsRef.current = settings;
	const durationRef   = useRef(0);
	const bgCellsRef    = useRef<HTMLCanvasElement[]>([]);
	const shadowRef     = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);

	const [duration, setDuration] = useState(0);
	// On-demand accurate frame: off → live canvas; on → render the exact ffmpeg composite.
	const [accurate, setAccurate] = useState(false);
	const accurateRef = useRef(accurate);
	accurateRef.current = accurate;
	const [fgDim, setFgDim] = useState<{ w: number; h: number } | null>(null);
	const [bgDim, setBgDim] = useState<{ w: number; h: number } | null>(null);

	// ── Pan/zoom ─────────────────────────────────────────────────────────────────

	const [transform, setTransform] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
	const transformRef = useRef(transform);
	transformRef.current = transform;
	const isPanningRef   = useRef(false);
	const lastPanPosRef  = useRef({ x: 0, y: 0 });

	const [playing, setPlaying] = useState(false);

	// ── URLs ──────────────────────────────────────────────────────────────────────

	const fgUrl    = fgFilePath ? toFileUrl(fgFilePath) : '';
	const bgUrlRaw = settings.useFgAsBg ? fgUrl : (bgFilePath ? toFileUrl(bgFilePath) : '');
	const bgUrl    = settings.useFgAsBg ? '' : bgUrlRaw;

	// ── Fit to view ───────────────────────────────────────────────────────────────

	const [fw, fh] = settings.finalFormat;
	const fwRef = useRef(fw);
	const fhRef = useRef(fh);
	fwRef.current = fw;
	fhRef.current = fh;

	// ── Accurate-frame engine (same builder as the ffSwitch export) ─────────────
	const settingsStr = JSON.stringify(settings);
	const graph = useMemo(() => {
		if (!fgDim) return null;
		const fgCopies = Math.max(1, settings.fg.copies);
		const fgDims = Array.from({ length: fgCopies }, () => ({ width: fgDim.w, height: fgDim.h }));
		const bgDims = settings.useFgAsBg
			? { width: fgDim.w, height: fgDim.h }
			: (bgDim ? { width: bgDim.w, height: bgDim.h } : null);
		return buildFfSwitchGraph({ settings, fgDims, bgDims, duration: 1 });
	}, [settingsStr, fgDim, bgDim]); // eslint-disable-line react-hooks/exhaustive-deps

	const cellCount = useMemo(
		() => (duration > 0 ? Math.min(600, Math.max(20, Math.round(duration * 4))) : 1),
		[duration],
	);

	const buildSpec = useCallback(
		(time: number): PreviewRenderSpec | null => {
			if (!fgFilePath || !graph) return null;
			const inputs = Array.from({ length: graph.fgInputCount }, () => ({ path: fgFilePath, seek: time }));
			if (graph.hasBgInput) {
				const bgPath = settings.useFgAsBg ? fgFilePath : bgFilePath;
				if (!bgPath) return null;
				inputs.push({ path: bgPath, seek: time });
			}
			return {
				inputs,
				filterGraph: graph.filterComplex,
				complex: true,
				outLabel: graph.outLabel,
				time,
				maxDim: null,
				namespace: 'ffswitch',
			};
		},
		[fgFilePath, bgFilePath, graph, settings.useFgAsBg],
	);

	const { cellStates, frameUrl, frameState, requestFrame } = usePreviewCache({
		duration,
		cellCount,
		buildSpec,
		graphKey: `${fgFilePath}|${bgFilePath}|${graph?.filterComplex ?? ''}`,
	});

	const fitToView = useCallback(() => {
		const area = previewAreaRef.current;
		if (!area) return;
		const fw = fwRef.current;
		const fh = fhRef.current;
		if (!fw || !fh) return;
		const areaW = area.clientWidth;
		const areaH = area.clientHeight;
		const scale = Math.min((areaW - 20) / fw, (areaH - 20) / fh);
		const t = {
			scale,
			offsetX: (areaW - fw * scale) / 2,
			offsetY: (areaH - fh * scale) / 2,
		};
		transformRef.current = t;
		setTransform(t);
	}, []);

	// ── Container resize → re-fit ─────────────────────────────────────────────────

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => fitToView());
		ro.observe(el);
		fitToView();
		return () => ro.disconnect();
	}, [fitToView]);

	// ── Re-fit when format changes ────────────────────────────────────────────────

	useEffect(() => {
		fitToView();
	}, [fw, fh, fitToView]);

	// ── Autoplay при выборе FG файла ──────────────────────────────────────────────

	useEffect(() => {
		if (!fgUrl) return;
		const v = fgVideoRef.current;
		if (!v) return;
		const onMeta = () => {
			durationRef.current = v.duration;
			setDuration(v.duration);
			v.play().catch(() => {});
			const bgV = bgVideoRef.current;
			if (bgV && bgUrl) bgV.play().catch(() => {});
		};
		v.addEventListener('loadedmetadata', onMeta, { once: true });
		return () => v.removeEventListener('loadedmetadata', onMeta);
	}, [fgUrl, bgUrl]);

	// ── Autoplay при выборе BG файла (без FG) ────────────────────────────────────

	useEffect(() => {
		if (fgUrl || !bgUrl) return;
		const v = bgVideoRef.current;
		if (!v) return;
		const onMeta = () => {
			durationRef.current = v.duration;
			setDuration(v.duration);
			v.play().catch(() => {});
		};
		v.addEventListener('loadedmetadata', onMeta, { once: true });
		return () => v.removeEventListener('loadedmetadata', onMeta);
	}, [fgUrl, bgUrl]);

	// ── Track source dimensions for the accurate-frame graph ────────────────────

	useEffect(() => {
		if (!fgUrl) { setFgDim(null); return; }
		const v = fgVideoRef.current;
		if (!v) return;
		const onMeta = () => setFgDim({ w: v.videoWidth, h: v.videoHeight });
		if (v.videoWidth > 0) onMeta();
		v.addEventListener('loadedmetadata', onMeta, { once: true });
		return () => v.removeEventListener('loadedmetadata', onMeta);
	}, [fgUrl]);

	useEffect(() => {
		if (!bgUrl) { setBgDim(null); return; }
		const v = bgVideoRef.current;
		if (!v) return;
		const onMeta = () => setBgDim({ w: v.videoWidth, h: v.videoHeight });
		if (v.videoWidth > 0) onMeta();
		v.addEventListener('loadedmetadata', onMeta, { once: true });
		return () => v.removeEventListener('loadedmetadata', onMeta);
	}, [bgUrl]);

	// ── Sync playing state ────────────────────────────────────────────────────────

	useEffect(() => {
		const v = (fgUrl ? fgVideoRef.current : null) ?? bgVideoRef.current;
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
	}, [fgUrl, bgUrl]);

	// ── Draw ──────────────────────────────────────────────────────────────────────

	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const s = settingsRef.current;
		const [fw, fh] = s.finalFormat;
		const isPortrait = fh >= fw;

		const fgV = fgVideoRef.current;
		const bgV = s.useFgAsBg ? fgV : bgVideoRef.current;

		ctx.fillStyle = s.bgColor || '#000000';
		ctx.fillRect(0, 0, fw, fh);

		// ── BG layer ──────────────────────────────────────────────────────────────

		if (bgV && bgV.readyState >= 2 && bgV.videoWidth > 0) {
			const bgCopies = Math.max(1, s.bg.copies);
			const adj       = s.bg.adjust;
			const blurR     = bgBlurRadius(adj.blur);

			// В графе каждая плитка — своя ветка: scale → crop → boxblur → eq → hflip.
			// Поэтому и здесь плитка считается в своём буфере: блюр НЕ течёт через границы
			// плиток (при bg.copies > 1 общий блюр по всему кадру давал шов не как в рендере).
			const cellW = isPortrait ? fw                        : Math.round(fw / bgCopies);
			const cellH = isPortrait ? Math.round(fh / bgCopies) : fh;

			// Пиксельные операции стоят O(площади), а RAF даёт ~16 мс на кадр. Размытый фон
			// всё равно теряет детали, поэтому при активном блюре плитка считается в
			// уменьшенном буфере (k ≈ radius/4): радиус масштабируется вместе с ней, лишняя
			// мягкость от обратного растягивания — единицы процентов от самого блюра.
			// Без блюра уменьшать нельзя — фон резкий, и это было бы видно.
			const k = blurR >= 1 ? Math.max(2, Math.min(8, Math.floor(blurR / 4))) : 1;
			const bufW = Math.max(1, Math.round(cellW / k));
			const bufH = Math.max(1, Math.round(cellH / k));

			for (let i = 0; i < bgCopies; i++) {
				const cellX = isPortrait ? 0            : i * cellW;
				const cellY = isPortrait ? i * cellH    : 0;

				const buf  = cellBuffer(bgCellsRef, i, bufW, bufH);
				const bctx = buf.getContext('2d');
				if (!bctx) continue;

				// cover — то же, что `scale=` по большей стороне + центральный crop
				const coverScale = Math.max(bufW / bgV.videoWidth, bufH / bgV.videoHeight);
				const renderW    = bgV.videoWidth  * coverScale;
				const renderH    = bgV.videoHeight * coverScale;

				bctx.save();
				bctx.translate(bufW / 2, bufH / 2);
				if (adj.hFlip) bctx.scale(-1, 1);
				bctx.drawImage(bgV, -renderW / 2, -renderH / 2, renderW, renderH);
				bctx.restore();

				applyBoxBlur(buf, Math.max(1, Math.round(blurR / k)), 1);
				applyFfmpegEq(buf, {
					brightness: adj.brightness || 0,
					contrast: adj.contrast,
					saturation: adj.saturation,
				});
				ctx.drawImage(buf, 0, 0, bufW, bufH, cellX, cellY, cellW, cellH);
			}
		}

		// ── FG layer ──────────────────────────────────────────────────────────────

		if (fgV && fgV.readyState >= 2 && fgV.videoWidth > 0) {
			const fgCopies = Math.max(1, s.fg.copies);
			const fitPct   = Math.min(100, Math.max(0, s.fg.fitPercent)) / 100;
			const shadow   = s.fg.shadow ?? defaultFgShadow();
			const vidW     = fgV.videoWidth;
			const vidH     = fgV.videoHeight;

			const fgAreaW = isPortrait ? fw : fw / fgCopies;
			const fgAreaH = isPortrait ? fh / fgCopies : fh;

			const scaleFit  = Math.min(fgAreaW / vidW, fgAreaH / vidH);
			const scaleFill = Math.max(fgAreaW / vidW, fgAreaH / vidH);
			const fgScale   = scaleFit + (scaleFill - scaleFit) * fitPct;

			const renderW = vidW * fgScale;
			const renderH = vidH * fgScale;
			const clipW   = Math.min(renderW, fgAreaW);
			const clipH   = Math.min(renderH, fgAreaH);

			const totalW = isPortrait ? clipW : fgCopies * clipW;
			const totalH = isPortrait ? fgCopies * clipH : clipH;
			const gapX = isPortrait ? (fw - clipW) / 2 : (fw - totalW) / (fgCopies + 1);
			const gapY = isPortrait ? (fh - totalH) / (fgCopies + 1) : (fh - clipH) / 2;

			for (let i = 0; i < fgCopies; i++) {
				const clipLeft   = Math.round(isPortrait ? gapX : gapX + i * (clipW + gapX));
				const clipTop    = Math.round(isPortrait ? gapY + i * (clipH + gapY) : gapY);
				const renderLeft = clipLeft - (renderW - clipW) / 2;
				const renderTop  = clipTop  - (renderH - clipH) / 2;

				// Тень — готовый размытый слой (как отдельный вход графа), а не ctx.shadow*:
				// у канваса своя математика размытия, да и в WKWebView она вела себя иначе.
				if (shadow.enabled && (shadow.opacity ?? 0) > 0) {
					const layer = shadowLayerFor(shadowRef, shadow, Math.round(clipW), Math.round(clipH));
					// Смещение целиком в `dx/dy`: там уже и offset, и раздувание, и pad под блюр —
					// считать их здесь второй раз значит однажды разойтись с графом.
					const { dx, dy } = shadowGeometry(shadow, Math.round(clipW), Math.round(clipH));
					ctx.drawImage(layer, clipLeft + dx, clipTop + dy);
				}

				ctx.save();
				ctx.beginPath();
				ctx.rect(clipLeft, clipTop, Math.round(clipW), Math.round(clipH));
				ctx.clip();
				ctx.drawImage(fgV, renderLeft, renderTop, renderW, renderH);
				ctx.restore();
			}
		}

		// ── Update toolbar progress ────────────────────────────────────────────────

		const masterV =
			(fgV && fgV.duration > 0) ? fgV :
			(bgVideoRef.current && bgVideoRef.current.duration > 0) ? bgVideoRef.current :
			null;

		if (masterV && masterV.duration > 0) {
			durationRef.current = masterV.duration;
			toolbarRef.current?.update(masterV.currentTime, masterV.duration);
			timelineRef.current?.update(masterV.currentTime, masterV.duration);
		}
	}, []);

	// ── RAF loop ──────────────────────────────────────────────────────────────────

	useEffect(() => {
		const loop = () => {
			draw();
			rafRef.current = requestAnimationFrame(loop);
		};
		rafRef.current = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(rafRef.current);
	}, [draw]);

	// ── Scroll wheel zoom ─────────────────────────────────────────────────────────

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

	// ── Middle mouse pan ──────────────────────────────────────────────────────────

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
		window.addEventListener('mouseup', onUp);
		return () => {
			area.removeEventListener('mousedown', onDown);
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	}, []);

	// ── Play / Pause ──────────────────────────────────────────────────────────────

	const togglePlay = useCallback(() => {
		const fgV = fgVideoRef.current;
		const bgV = bgVideoRef.current;
		const master = (fgV && fgV.src) ? fgV : bgV;
		if (!master) return;
		if (master.paused) {
			master.play().catch(() => {});
			if (fgV?.src && bgV?.src) bgV.play().catch(() => {});
		} else {
			master.pause();
			if (fgV?.src && bgV?.src) bgV.pause();
		}
	}, []);

	const seekTo = useCallback((ratio: number) => {
		const t = ratio * durationRef.current;
		const fgV = fgVideoRef.current;
		const bgV = bgVideoRef.current;
		if (fgV?.src) fgV.currentTime = t;
		if (bgV?.src) bgV.currentTime = t;
		if (accurateRef.current) requestFrame(t);
	}, [requestFrame]);

	// On-demand accurate frame: toggle on → pause + render the current frame.
	const toggleAccurate = useCallback(() => {
		setAccurate((prev) => {
			const next = !prev;
			if (next) {
				fgVideoRef.current?.pause();
				bgVideoRef.current?.pause();
				const t = (fgVideoRef.current ?? bgVideoRef.current)?.currentTime ?? 0;
				requestFrame(t);
			}
			return next;
		});
	}, [requestFrame]);

	// Re-render the accurate frame when the graph changes while accurate mode is on.
	useEffect(() => {
		if (!accurate || !graph) return;
		const t = (fgVideoRef.current ?? bgVideoRef.current)?.currentTime ?? 0;
		requestFrame(t);
	}, [graph, accurate, requestFrame]);

	// ── Render ────────────────────────────────────────────────────────────────────

	// On-demand accurate frame: 🟢 shown when ready, else live canvas (🟡 while rendering).
	const showGreen = accurate && frameState === 'cached' && !!frameUrl;
	const dotState: PreviewState = showGreen ? 'cached' : 'approx';

	return (
		<div
			ref={containerRef}
			style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#111111' }}
		>
			{/* Hidden video elements */}
			{fgUrl && <video ref={fgVideoRef} crossOrigin='anonymous' src={fgUrl} loop muted playsInline style={{ display: 'none' }} />}
			{bgUrl && <video ref={bgVideoRef} crossOrigin='anonymous' src={bgUrl} loop muted playsInline style={{ display: 'none' }} />}

			{/* Preview area with pan/zoom */}
			<div
				ref={previewAreaRef}
				style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
				onDoubleClick={fitToView}
			>
				{/* Frame background — checkerboard + border */}
				<div style={{
					position: 'absolute',
					left: transform.offsetX,
					top: transform.offsetY,
					width: fw * transform.scale,
					height: fh * transform.scale,
					...checkerboardStyle,
					border: '1px solid rgba(255,255,255,0.12)',
					boxSizing: 'border-box',
				}} />

				{/* Canvas (🟡 live approximation) */}
				<canvas
					ref={canvasRef}
					width={fw}
					height={fh}
					style={{
						position: 'absolute',
						left: transform.offsetX,
						top: transform.offsetY,
						width: fw * transform.scale,
						height: fh * transform.scale,
						imageRendering: 'auto',
						display: showGreen ? 'none' : 'block',
					}}
				/>

				{/* 🟢 Accurate ffmpeg composite (on-demand) */}
				{showGreen && frameUrl && (
					<img
						src={frameUrl}
						style={{
							position: 'absolute',
							left: transform.offsetX,
							top: transform.offsetY,
							width: fw * transform.scale,
							height: fh * transform.scale,
							imageRendering: 'auto',
							pointerEvents: 'none',
						}}
						alt='Accurate preview'
					/>
				)}

				{/* Fidelity indicator — only while accurate mode is on */}
				{accurate && (fgUrl || bgUrlRaw) && <PreviewStateDot state={dotState} showLabel />}

				{!fgUrl && !bgUrlRaw && (
					<div style={{
						position: 'absolute', inset: 0,
						display: 'flex', alignItems: 'center', justifyContent: 'center',
						color: 'rgba(255,255,255,0.2)', fontSize: 13,
						pointerEvents: 'none', textAlign: 'center', padding: 16,
					}}>
						Select FG file to preview
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
				height={CONTROLS_H + 44}
				progressSlot={
					<PreviewTimeline
						ref={timelineRef}
						duration={duration}
						cellCount={cellCount}
						cellStates={cellStates}
						onSeek={seekTo}
					/>
				}
				rightSlot={
					<span style={{ color: '#333', fontSize: 10, fontFamily: 'monospace' }}>
						{fw} × {fh}
					</span>
				}
				bottomSlot={
					<button
						onClick={toggleAccurate}
						disabled={!graph}
						style={{
							padding: '3px 8px', fontSize: 10,
							fontWeight: accurate ? 600 : 400,
							cursor: graph ? 'pointer' : 'default',
							borderRadius: 3,
							border: `1px solid ${accurate ? '#46b450' : '#333'}`,
							background: accurate ? '#1e3a24' : '#1a1a1a',
							color: accurate ? '#8fe0a0' : (graph ? '#888' : '#555'),
							outline: 'none',
						}}
						title='Render the exact ffmpeg composite for the current frame'
					>
						{accurate ? '🟢 Точный кадр: вкл' : 'Точный кадр'}
					</button>
				}
			/>
		</div>
	);
}
