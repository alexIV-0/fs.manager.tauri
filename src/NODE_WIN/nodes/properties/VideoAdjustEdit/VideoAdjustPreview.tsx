// src/NODE_WIN/nodes/properties/VideoAdjustEdit/VideoAdjustPreview.tsx
//
// Canvas-based live preview:
//   • One <video> per layer — all copies read from it → guaranteed sync
//   • BG: cover + ctx.filter (blur/brightness/contrast/saturate) + hFlip
//   • Blur fix: blurPad — draw with padding + ctx.clip → no vignette
//   • FG: space-evenly + fitPercent + drop shadow (ctx.shadow*)
//   • Progress bar: direct DOM update from RAF (60fps, no React re-render)
//   • Pan/zoom: scroll wheel + middle mouse drag, double-click to fit
//   • Frame border + checkerboard background around canvas frame

import { useRef, useState, useEffect, useCallback } from 'react';
import { VideoAdjustSettings, defaultFgShadow } from './types';
import { toFileUrl } from '@/Utils/mediaUtils';
import { applyBlur, applyColorAdjust } from '@/Utils/canvasFilters';
import { checkerboardStyle } from '@/Utils/CheckerboardBg';
import PreviewToolbar, { type PreviewToolbarHandle } from '../PreviewToolbar';

const CONTROLS_H = 52;
const MIN_SCALE = 0.05;
const MAX_SCALE = 10;

function hexToRgba(hex: string, opacity: number): string {
	const h = (hex || '#000000').replace('#', '').padEnd(6, '0');
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return `rgba(${r},${g},${b},${opacity})`;
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
	const rafRef        = useRef<number>(0);
	const settingsRef   = useRef(settings);
	settingsRef.current = settings;
	const durationRef   = useRef(0);

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
			v.play().catch(() => {});
		};
		v.addEventListener('loadedmetadata', onMeta, { once: true });
		return () => v.removeEventListener('loadedmetadata', onMeta);
	}, [fgUrl, bgUrl]);

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

			// ctx.filter is a no-op in WKWebView, so blur/colour are applied by pixel
			// helpers (taint-safe — the source <video> has crossOrigin="anonymous").
			// When no adjustment is active, draw straight to the main canvas (fast path).
			const hasColor = (adj.brightness || 0) !== 0 || adj.contrast !== 1 || adj.saturation !== 1;
			const hasFilter = adj.blur > 0 || hasColor;

			const bgOff = hasFilter ? document.createElement('canvas') : null;
			if (bgOff) { bgOff.width = fw; bgOff.height = fh; }
			const bctx = bgOff ? bgOff.getContext('2d') : ctx;
			if (bctx) {
				for (let i = 0; i < bgCopies; i++) {
					const cellX = isPortrait ? 0                              : Math.round(i * fw / bgCopies);
					const cellY = isPortrait ? Math.round(i * fh / bgCopies) : 0;
					const cellW = isPortrait ? fw                             : Math.round(fw / bgCopies);
					const cellH = isPortrait ? Math.round(fh / bgCopies)      : fh;

					const coverScale = Math.max(cellW / bgV.videoWidth, cellH / bgV.videoHeight);
					const renderW    = bgV.videoWidth  * coverScale;
					const renderH    = bgV.videoHeight * coverScale;
					const renderX    = cellX + (cellW - renderW) / 2;
					const renderY    = cellY + (cellH - renderH) / 2;

					bctx.save();
					bctx.beginPath();
					bctx.rect(cellX, cellY, cellW, cellH);
					bctx.clip();
					if (adj.hFlip) {
						bctx.translate(renderX + renderW / 2, renderY + renderH / 2);
						bctx.scale(-1, 1);
						bctx.drawImage(bgV, -renderW / 2, -renderH / 2, renderW, renderH);
					} else {
						bctx.drawImage(bgV, renderX, renderY, renderW, renderH);
					}
					bctx.restore();
				}

				if (bgOff) {
					applyBlur(bgOff, adj.blur);
					applyColorAdjust(bgOff, {
						brightnessMul: 1 + (adj.brightness || 0),
						contrast: adj.contrast,
						saturation: adj.saturation,
					});
					ctx.drawImage(bgOff, 0, 0);
				}
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

				if (shadow.enabled) {
					const sp = shadow.blur * 2 + Math.abs(shadow.offsetX) + Math.abs(shadow.offsetY) + 4;
					ctx.save();
					ctx.beginPath();
					ctx.rect(
						clipLeft  - sp + Math.min(0, shadow.offsetX),
						clipTop   - sp + Math.min(0, shadow.offsetY),
						Math.round(clipW) + sp * 2 + Math.abs(shadow.offsetX),
						Math.round(clipH) + sp * 2 + Math.abs(shadow.offsetY),
					);
					ctx.clip();
					ctx.shadowBlur    = shadow.blur;
					ctx.shadowColor   = hexToRgba(shadow.color || '#000000', shadow.opacity ?? 0.6);
					ctx.shadowOffsetX = shadow.offsetX;
					ctx.shadowOffsetY = shadow.offsetY;
					ctx.drawImage(fgV, renderLeft, renderTop, renderW, renderH);
					ctx.shadowBlur    = 0;
					ctx.shadowColor   = 'transparent';
					ctx.shadowOffsetX = 0;
					ctx.shadowOffsetY = 0;
					ctx.restore();
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
	}, []);

	// ── Render ────────────────────────────────────────────────────────────────────

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

				{/* Canvas */}
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
					}}
				/>

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
				height={CONTROLS_H}
				rightSlot={
					<span style={{ color: '#333', fontSize: 10, fontFamily: 'monospace' }}>
						{fw} × {fh}
					</span>
				}
			/>
		</div>
	);
}
