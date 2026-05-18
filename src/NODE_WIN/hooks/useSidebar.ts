// src/NODE_WIN/components/Sidebar/useSidebar.ts
import { useCallback, useEffect, useRef, useState } from 'react';

export type SidebarMode = 'on' | 'off' | 'auto';

const MIN_WIDTH = 160;
const MAX_WIDTH = 400;
export const PEEK_WIDTH = 24;

const STORAGE_KEY = 'sidebar_prefs';

function loadPrefs(): { mode: SidebarMode; width: number } {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw);
	} catch {}
	return { mode: 'on', width: 220 };
}

function savePrefs(mode: SidebarMode, width: number) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, width }));
}

export function useSidebar() {
	const prefs = useRef(loadPrefs());

	const [mode, setModeState] = useState<SidebarMode>(prefs.current.mode);
	const [width, setWidthState] = useState(prefs.current.width);
	const [isVisible, setIsVisible] = useState(prefs.current.mode === 'on');

	// Сохраняем при изменении
	const setMode = useCallback(
		(m: SidebarMode) => {
			setModeState(m);
			savePrefs(m, width);
		},
		[width],
	);

	const setWidth = useCallback(
		(w: number) => {
			setWidthState(w);
			savePrefs(mode, w);
		},
		[mode],
	);

	// Resize логика
	const isResizing = useRef(false);
	const startX = useRef(0);
	const startWidth = useRef(0);

	const onResizeStart = useCallback(
		(e: React.MouseEvent) => {
			isResizing.current = true;
			startX.current = e.clientX;
			startWidth.current = width;
			e.preventDefault();
		},
		[width],
	);

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!isResizing.current) return;
			const delta = startX.current - e.clientX;
			const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
			setWidth(newWidth);
		};

		const onMouseUp = () => {
			isResizing.current = false;
		};

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
		return () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		};
	}, [setWidth]);

	// Видимость в зависимости от режима
	useEffect(() => {
		if (mode === 'on') setIsVisible(true);
		if (mode === 'off') setIsVisible(false);
		if (mode === 'auto') setIsVisible(false);
	}, [mode]);

	// AUTO — наведение на полоску
	const onPeekEnter = useCallback(() => {
		if (mode === 'auto') setIsVisible(true);
	}, [mode]);

	const onPeekLeave = useCallback(() => {
		if (mode === 'auto') setIsVisible(false);
	}, [mode]);

	// OFF — клик по полоске
	const onPeekClick = useCallback(() => {
		if (mode === 'off') setIsVisible((v) => !v);
	}, [mode]);

	// Закрыть при клике вне в режиме OFF
	const sidebarRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (mode !== 'off') return;
		const handler = (e: MouseEvent) => {
			if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
				setIsVisible(false);
			}
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [mode]);

	return {
		mode,
		setMode,
		width,
		isVisible,
		onResizeStart,
		onPeekEnter,
		onPeekLeave,
		onPeekClick,
		sidebarRef,
	};
}
