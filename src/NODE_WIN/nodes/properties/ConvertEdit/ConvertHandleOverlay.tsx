// src/NODE_WIN/nodes/properties/ConvertEdit/ConvertHandleOverlay.tsx
//
// Interactive handles overlay for Scale/Resize, Crop, and Position filters.
// Rendered on top of the ConvertPreview viewport.
//
// Converted mode: ONE unified frame (scale size + position offset).
//   - Resize handles → update Scale filter
//   - Body drag      → update Position filter
// Original mode: Crop overlay (dark mask + handles)

import React, { useCallback, useEffect, useRef } from 'react';
import {
	ConvertSettings,
	FilterScale,
	FilterCrop,
	FilterPosition,
	VideoFilterItem,
	ImageFilterItem,
	getScaledSourceDims,
} from './types';

// ── Handle layout ──────────────────────────────────────────────────────────────

const HANDLES = [
	{ id: 'nw', cx: 0,   cy: 0,   cursor: 'nwse-resize' },
	{ id: 'n',  cx: 0.5, cy: 0,   cursor: 'ns-resize'   },
	{ id: 'ne', cx: 1,   cy: 0,   cursor: 'nesw-resize' },
	{ id: 'e',  cx: 1,   cy: 0.5, cursor: 'ew-resize'   },
	{ id: 'se', cx: 1,   cy: 1,   cursor: 'nwse-resize' },
	{ id: 's',  cx: 0.5, cy: 1,   cursor: 'ns-resize'   },
	{ id: 'sw', cx: 0,   cy: 1,   cursor: 'nesw-resize' },
	{ id: 'w',  cx: 0,   cy: 0.5, cursor: 'ew-resize'   },
] as const;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OverlayTransform {
	scale: number;
	offsetX: number;
	offsetY: number;
}

export interface ConvertHandleOverlayProps {
	settings: ConvertSettings;
	outputMode: 'image' | 'video' | 'audio';
	previewMode: 'original' | 'converted';
	origW: number;
	origH: number;
	displayW: number;
	displayH: number;
	transform: OverlayTransform;
	onSettingsChange: (s: ConvertSettings) => void;
}

// ── Geometry helpers ───────────────────────────────────────────────────────────

interface Box { x: number; y: number; w: number; h: number }

function getCropBox(
	f: FilterCrop,
	origW: number,
	origH: number,
	t: OverlayTransform,
): Box & { ix: number; iy: number; iw: number; ih: number } {
	const ix = f.unit === 'pct' ? origW * f.x / 100 : f.x;
	const iy = f.unit === 'pct' ? origH * f.y / 100 : f.y;
	const iw = f.unit === 'pct' ? origW * f.w / 100 : f.w;
	const ih = f.unit === 'pct' ? origH * f.h / 100 : f.h;
	return {
		x: t.offsetX + ix * t.scale,
		y: t.offsetY + iy * t.scale,
		w: iw * t.scale,
		h: ih * t.scale,
		ix, iy, iw, ih,
	};
}

// ── Settings update helper ─────────────────────────────────────────────────────

function applyFilter(
	settings: ConvertSettings,
	outputMode: 'image' | 'video' | 'audio',
	newFilter: VideoFilterItem | ImageFilterItem,
	cb: (s: ConvertSettings) => void,
) {
	if (outputMode === 'image') {
		cb({
			...settings,
			image: {
				...settings.image,
				filters: settings.image.filters.map((f) =>
					f.id === newFilter.id ? (newFilter as ImageFilterItem) : f,
				),
			},
		});
	} else {
		cb({
			...settings,
			video: {
				...settings.video,
				filters: settings.video.filters.map((f) =>
					f.id === newFilter.id ? (newFilter as VideoFilterItem) : f,
				),
			},
		});
	}
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ConvertHandleOverlay({
	settings,
	outputMode,
	previewMode,
	origW,
	origH,
	displayW,
	displayH,
	transform,
	onSettingsChange,
}: ConvertHandleOverlayProps) {
	if (!origW || !origH) return null;

	const filters: (VideoFilterItem | ImageFilterItem)[] =
		outputMode === 'image' ? settings.image.filters : settings.video.filters;

	const scaleFilter = filters.find(
		(f) => f.type === 'scale' && f.enabled !== false,
	) as FilterScale | undefined;
	const cropFilter = filters.find(
		(f) => f.type === 'crop' && f.enabled !== false,
	) as FilterCrop | undefined;
	const posFilter = filters.find(
		(f) => f.type === 'position' && f.enabled !== false,
	) as FilterPosition | undefined;

	const showScale    = previewMode === 'converted' && !!scaleFilter && scaleFilter.mode !== 'original';
	const showPosition = previewMode === 'converted' && !!posFilter;
	const showCrop     = previewMode === 'original'  && !!cropFilter;
	const showUnified  = previewMode === 'converted' && (showScale || showPosition);

	// ── Stable refs ───────────────────────────────────────────────────────────────
	const settingsRef    = useRef(settings);    settingsRef.current    = settings;
	const outputModeRef  = useRef(outputMode);  outputModeRef.current  = outputMode;
	const origWRef       = useRef(origW);       origWRef.current       = origW;
	const origHRef       = useRef(origH);       origHRef.current       = origH;
	const displayWRef    = useRef(displayW);    displayWRef.current    = displayW;
	const displayHRef    = useRef(displayH);    displayHRef.current    = displayH;
	const transformRef   = useRef(transform);   transformRef.current   = transform;

	// ── Drag state ─────────────────────────────────────────────────────────────────
	const dragRef = useRef<{
		filterType: 'scale' | 'crop' | 'position';
		handle: string;
		startX: number;
		startY: number;
		startFilter: FilterScale | FilterCrop | FilterPosition;
	} | null>(null);

	// ── Mouse down ─────────────────────────────────────────────────────────────────
	const handleMouseDown = useCallback((
		e: React.MouseEvent,
		filterType: 'scale' | 'crop' | 'position',
		handle: string,
	) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();

		const om = outputModeRef.current;
		const fs = om === 'image'
			? settingsRef.current.image.filters
			: settingsRef.current.video.filters;
		const flt = fs.find((f) => f.type === filterType);
		if (!flt) return;

		dragRef.current = {
			filterType,
			handle,
			startX: e.clientX,
			startY: e.clientY,
			startFilter: { ...flt } as FilterScale | FilterCrop | FilterPosition,
		};
	}, []);

	// ── Global drag handlers ───────────────────────────────────────────────────────
	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			const drag = dragRef.current;
			if (!drag) return;

			const { filterType, handle, startX, startY, startFilter } = drag;
			const vScale = transformRef.current.scale;
			const dx = (e.clientX - startX) / vScale;
			const dy = (e.clientY - startY) / vScale;
			const oW = origWRef.current;
			const oH = origHRef.current;
			const s  = settingsRef.current;
			const om = outputModeRef.current;

			// ── Scale drag ────────────────────────────────────────────────────────────
			if (filterType === 'scale') {
				const f = startFilter as FilterScale;
				if (f.mode === 'original') return;

				// Symmetric (center-anchored)
				const dw = handle.includes('e') ? dx * 2 : handle.includes('w') ? -dx * 2 : 0;
				const dh = handle.includes('s') ? dy * 2 : handle.includes('n') ? -dy * 2 : 0;

				let newFilter: FilterScale;
				if (f.mode === 'pct') {
					const curW = oW * f.widthPct / 100;
					const curH = f.lockAspect ? (curW * oH / oW) : (oH * f.heightPct / 100);
					const newWPct = Math.round(Math.max(1, Math.min(400, (curW + dw) / oW * 100)) * 100) / 100;
					if (f.lockAspect) {
						newFilter = { ...f, widthPct: newWPct, heightPct: newWPct };
					} else {
						const newHPct = Math.round(Math.max(1, Math.min(400, (curH + dh) / oH * 100)) * 100) / 100;
						newFilter = { ...f, widthPct: newWPct, heightPct: newHPct };
					}
				} else {
					const newFW = Math.max(4, Math.round(f.fixedW + dw));
					if (f.lockAspect) {
						newFilter = { ...f, fixedW: newFW, fixedH: Math.max(4, Math.round(newFW * oH / oW)) };
					} else {
						const newFH = Math.max(4, Math.round(f.fixedH + dh));
						newFilter = { ...f, fixedW: newFW, fixedH: newFH };
					}
				}
				applyFilter(s, om, newFilter, onSettingsChange);
			}

			// ── Crop drag ─────────────────────────────────────────────────────────────
			if (filterType === 'crop') {
				const f = startFilter as FilterCrop;
				const inPct = f.unit === 'pct';
				const ix0 = inPct ? oW * f.x / 100 : f.x;
				const iy0 = inPct ? oH * f.y / 100 : f.y;
				const iw0 = inPct ? oW * f.w / 100 : f.w;
				const ih0 = inPct ? oH * f.h / 100 : f.h;

				let ix = ix0, iy = iy0, iw = iw0, ih = ih0;

				if (handle === 'move') {
					ix = Math.max(0, Math.min(oW - iw0, ix0 + dx));
					iy = Math.max(0, Math.min(oH - ih0, iy0 + dy));
				} else {
					const minW = oW * 0.01;
					const minH = oH * 0.01;
					if (handle.includes('e')) iw = Math.max(minW, iw0 + dx);
					if (handle.includes('w')) {
						ix = Math.min(ix0 + iw0 - minW, ix0 + dx);
						iw = ix0 + iw0 - ix;
					}
					if (handle.includes('s')) ih = Math.max(minH, ih0 + dy);
					if (handle.includes('n')) {
						iy = Math.min(iy0 + ih0 - minH, iy0 + dy);
						ih = iy0 + ih0 - iy;
					}
					ix = Math.max(0, ix);
					iy = Math.max(0, iy);
					iw = Math.min(oW - ix, iw);
					ih = Math.min(oH - iy, ih);
				}

				let newFilter: FilterCrop;
				if (inPct) {
					newFilter = {
						...f,
						x: Math.round(ix / oW * 10000) / 100,
						y: Math.round(iy / oH * 10000) / 100,
						w: Math.round(iw / oW * 10000) / 100,
						h: Math.round(ih / oH * 10000) / 100,
					};
				} else {
					newFilter = {
						...f,
						x: Math.round(ix), y: Math.round(iy),
						w: Math.max(1, Math.round(iw)), h: Math.max(1, Math.round(ih)),
					};
				}
				applyFilter(s, om, newFilter, onSettingsChange);
			}

			// ── Position drag ─────────────────────────────────────────────────────────
			if (filterType === 'position') {
				const f = startFilter as unknown as FilterPosition;
				const cW = displayWRef.current;
				const cH = displayHRef.current;
				const fs2 = om === 'image' ? s.image.filters : s.video.filters;
				const dims = getScaledSourceDims(fs2, oW, oH);
				const rangeX = cW - dims.w;
				const rangeY = cH - dims.h;

				// When source fills the frame (rangeX/Y = 0), use frame size as virtual
				// range so xPct still updates. This takes effect when scale is (re)enabled.
				const effRangeX = rangeX !== 0 ? rangeX : cW;
				const effRangeY = rangeY !== 0 ? rangeY : cH;

				const curX = effRangeX * f.xPct / 100;
				const curY = effRangeY * f.yPct / 100;
				const newXPct = Math.round((curX + dx) / effRangeX * 1000) / 10;
				const newYPct = Math.round((curY + dy) / effRangeY * 1000) / 10;
				applyFilter(s, om, { ...f, xPct: newXPct, yPct: newYPct }, onSettingsChange);
			}
		};

		const onUp = () => { dragRef.current = null; };
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	}, [onSettingsChange]);

	// ── Compute unified frame box ─────────────────────────────────────────────────
	const unifiedBox: Box | null = (() => {
		if (!showUnified) return null;
		const t   = transform;
		const dims = getScaledSourceDims(filters, origW, origH);
		const pW  = dims.w * t.scale;
		const pH  = dims.h * t.scale;
		const cWscr = displayW * t.scale;
		const cHscr = displayH * t.scale;
		const cX = t.offsetX;
		const cY = t.offsetY;

		let imgX: number, imgY: number;
		if (posFilter) {
			const rangeX = cWscr - pW;
			const rangeY = cHscr - pH;
			// Use frame size as visual range when source fills frame exactly (same fallback as drag handler)
			const effRangeX = rangeX !== 0 ? rangeX : cWscr;
			const effRangeY = rangeY !== 0 ? rangeY : cHscr;
			imgX = cX + effRangeX * posFilter.xPct / 100;
			imgY = cY + effRangeY * posFilter.yPct / 100;
		} else {
			imgX = cX + (cWscr - pW) / 2;
			imgY = cY + (cHscr - pH) / 2;
		}
		return { x: imgX, y: imgY, w: pW, h: pH };
	})();

	// ── Crop geometry ─────────────────────────────────────────────────────────────
	const cropBox = (showCrop && cropFilter)
		? getCropBox(cropFilter, origW, origH, transform)
		: null;

	const fX = transform.offsetX;
	const fY = transform.offsetY;
	const fW = origW * transform.scale;
	const fH = origH * transform.scale;

	// ── Handle dots renderer ───────────────────────────────────────────────────────
	const renderHandles = (box: Box, filterType: 'scale' | 'crop', dotColor: string) =>
		HANDLES.map(({ id, cx, cy, cursor }) => (
			<div
				key={id}
				onMouseDown={(e) => handleMouseDown(e, filterType, id)}
				style={{
					position:   'absolute',
					left:       box.x + cx * box.w - 5,
					top:        box.y + cy * box.h - 5,
					width:  10, height: 10,
					background: dotColor,
					border:     '1px solid rgba(0,0,0,0.6)',
					borderRadius: id.length === 2 ? 2 : 8,
					cursor,
					pointerEvents: 'auto',
					zIndex: 20,
					boxSizing: 'border-box',
				}}
			/>
		));

	// ── Render ──────────────────────────────────────────────────────────────────────
	return (
		<div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}>

			{/* ── Unified frame (converted mode) ──────────────────────────────── */}
			{unifiedBox && (() => {
				const dims = getScaledSourceDims(filters, origW, origH);
				return (
					<>
						{/* Frame border */}
						<div style={{
							position: 'absolute',
							left: unifiedBox.x, top: unifiedBox.y,
							width: unifiedBox.w, height: unifiedBox.h,
							border: '1px solid rgba(255,255,255,0.65)',
							pointerEvents: 'none', boxSizing: 'border-box',
						}} />

						{/* Body drag (position filter) */}
						{showPosition && posFilter && (
							<div
								onMouseDown={(e) => handleMouseDown(e, 'position', 'move')}
								style={{
									position: 'absolute',
									left: unifiedBox.x, top: unifiedBox.y,
									width: unifiedBox.w, height: unifiedBox.h,
									cursor: 'move', pointerEvents: 'auto', zIndex: 15,
								}}
							/>
						)}

						{/* Resize handles (scale filter) */}
						{showScale && scaleFilter && renderHandles(unifiedBox, 'scale', 'white')}

						{/* Dims label */}
						<div style={{
							position: 'absolute',
							left: unifiedBox.x + 5, top: unifiedBox.y + 4,
							fontSize: 9, color: 'rgba(255,255,255,0.45)',
							pointerEvents: 'none', fontFamily: 'monospace',
						}}>
							{Math.round(dims.w)}×{Math.round(dims.h)}
						</div>
					</>
				);
			})()}

			{/* ── Crop overlay (original mode) ───────────────────────────────── */}
			{cropBox && (() => {
				const cx = Math.max(fX, cropBox.x);
				const cy = Math.max(fY, cropBox.y);
				const cR = Math.min(fX + fW, cropBox.x + cropBox.w);
				const cB = Math.min(fY + fH, cropBox.y + cropBox.h);
				const dark = 'rgba(0,0,0,0.55)';
				return (
					<>
						{/* Dark mask outside crop region */}
						<div style={{ position: 'absolute', left: fX, top: fY,    width: fW,                        height: Math.max(0, cy - fY),    background: dark, pointerEvents: 'none' }} />
						<div style={{ position: 'absolute', left: fX, top: cB,    width: fW,                        height: Math.max(0, fY+fH - cB), background: dark, pointerEvents: 'none' }} />
						<div style={{ position: 'absolute', left: fX, top: cy,    width: Math.max(0, cx - fX),      height: Math.max(0, cB - cy),    background: dark, pointerEvents: 'none' }} />
						<div style={{ position: 'absolute', left: cR, top: cy,    width: Math.max(0, fX+fW - cR),   height: Math.max(0, cB - cy),    background: dark, pointerEvents: 'none' }} />

						{/* Crop border */}
						<div style={{
							position: 'absolute',
							left: cropBox.x, top: cropBox.y, width: cropBox.w, height: cropBox.h,
							border: '1px solid rgba(255,255,255,0.85)',
							pointerEvents: 'none', boxSizing: 'border-box',
						}} />

						{/* Rule-of-thirds grid */}
						{[1, 2].map((i) => (
							<React.Fragment key={i}>
								<div style={{ position: 'absolute', left: cropBox.x + cropBox.w * i / 3, top: cropBox.y, width: 1, height: cropBox.h, background: 'rgba(255,255,255,0.18)', pointerEvents: 'none' }} />
								<div style={{ position: 'absolute', left: cropBox.x, top: cropBox.y + cropBox.h * i / 3, width: cropBox.w, height: 1, background: 'rgba(255,255,255,0.18)', pointerEvents: 'none' }} />
							</React.Fragment>
						))}

						{/* Center drag */}
						<div
							onMouseDown={(e) => handleMouseDown(e, 'crop', 'move')}
							style={{
								position: 'absolute',
								left: cropBox.x, top: cropBox.y, width: cropBox.w, height: cropBox.h,
								cursor: 'move', pointerEvents: 'auto',
							}}
						/>

						{renderHandles(cropBox, 'crop', 'white')}
					</>
				);
			})()}
		</div>
	);
}
