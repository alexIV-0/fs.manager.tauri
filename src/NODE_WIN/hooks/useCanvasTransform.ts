// src/NODE_WIN/nodes/properties/TitleEdit/useCanvasTransform.ts

import { useRef, useState, useCallback, useEffect } from 'react';

export interface Transform {
	scale: number;
	offsetX: number;
	offsetY: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 5;

interface UseCanvasTransformProps {
	canvasRef: React.RefObject<HTMLCanvasElement | null>;
	containerRef: React.RefObject<HTMLDivElement | null>;
	videoWidth: number;
	videoHeight: number;
	onTransformChange: () => void; // вызывается после изменения — триггер перерисовки
}

export function useCanvasTransform({
	canvasRef,
	containerRef,
	videoWidth,
	videoHeight,
	onTransformChange,
}: UseCanvasTransformProps) {
	const transformRef = useRef<Transform>({ scale: 1, offsetX: 0, offsetY: 0 });
	const isPanningRef = useRef(false);
	const lastPanPosRef = useRef({ x: 0, y: 0 });
	const [transform, setTransform] = useState<Transform>({ scale: 1, offsetX: 0, offsetY: 0 });

	const applyTransform = useCallback(
		(t: Transform) => {
			transformRef.current = t;
			setTransform(t);
			onTransformChange();
		},
		[onTransformChange],
	);

	// ── Fit to container ────────────────────────────────────────────────────────

	const fitToContainer = useCallback(() => {
		if (!containerRef.current) return;
		const containerW = containerRef.current.clientWidth;
		const containerH = containerRef.current.clientHeight;

		const scaleX = (containerW - 40) / videoWidth;
		const scaleY = (containerH - 40) / videoHeight;
		const scale = Math.min(scaleX, scaleY);

		applyTransform({
			scale,
			offsetX: (containerW - videoWidth * scale) / 2,
			offsetY: (containerH - videoHeight * scale) / 2,
		});
	}, [containerRef, videoWidth, videoHeight, applyTransform]);

	// ── Zoom ────────────────────────────────────────────────────────────────────

	const handleWheel = useCallback(
		(e: WheelEvent) => {
			e.preventDefault();
			const canvas = canvasRef.current;
			if (!canvas) return;

			const rect = canvas.getBoundingClientRect();
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;

			const delta = e.deltaY > 0 ? 0.9 : 1.1;
			const { scale, offsetX, offsetY } = transformRef.current;
			const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * delta));

			applyTransform({
				scale: newScale,
				offsetX: mouseX - (mouseX - offsetX) * (newScale / scale),
				offsetY: mouseY - (mouseY - offsetY) * (newScale / scale),
			});
		},
		[canvasRef, applyTransform],
	);

	// ── Pan (средняя кнопка) ────────────────────────────────────────────────────

	const handleMouseDown = useCallback((e: MouseEvent) => {
		if (e.button === 1) {
			e.preventDefault();
			isPanningRef.current = true;
			lastPanPosRef.current = { x: e.clientX, y: e.clientY };
		}
	}, []);

	const handleMouseMove = useCallback(
		(e: MouseEvent) => {
			if (!isPanningRef.current) return;
			const dx = e.clientX - lastPanPosRef.current.x;
			const dy = e.clientY - lastPanPosRef.current.y;
			lastPanPosRef.current = { x: e.clientX, y: e.clientY };

			const { scale, offsetX, offsetY } = transformRef.current;
			applyTransform({ scale, offsetX: offsetX + dx, offsetY: offsetY + dy });
		},
		[applyTransform],
	);

	const handleMouseUp = useCallback((e: MouseEvent) => {
		if (e.button === 1) isPanningRef.current = false;
	}, []);

	// ── Подписка событий ────────────────────────────────────────────────────────

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		canvas.addEventListener('wheel', handleWheel, { passive: false });
		canvas.addEventListener('mousedown', handleMouseDown);
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);

		return () => {
			canvas.removeEventListener('wheel', handleWheel);
			canvas.removeEventListener('mousedown', handleMouseDown);
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	}, [handleWheel, handleMouseDown, handleMouseMove, handleMouseUp]);

	return { transform, transformRef, fitToContainer };
}
