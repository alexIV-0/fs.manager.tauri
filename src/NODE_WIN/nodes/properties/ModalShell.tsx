// src/NODE_WIN/nodes/properties/ModalShell.tsx

import { ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { X, Maximize2, Minimize2, Save } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { ResizeDirection } from './TextEdit/types';
import { ResizeHandle } from './TextEdit/ResizeHandle';

export interface ModalShellConfig {
	defaultSize?: { width: number; height: number };
	minWidth?: number;
	minHeight?: number;
	defaultPanelWidth?: number;
	minPanelWidth?: number;
	maxPanelWidth?: number;
}

interface ModalShellProps {
	title: string;
	onClose: () => void;
	onSave: () => void;
	config?: ModalShellConfig;
	/** Element rendered before the title/center area (e.g. presets button) */
	headerLeft?: ReactNode;
	/** Replaces the default title Typography — must include flex: 1 */
	headerCenter?: ReactNode;
	/** Extra content between center and action buttons (e.g. eyedropper hint) */
	headerExtra?: ReactNode;
	/** Canvas / preview area that fills the left body column */
	canvasSlot: ReactNode;
	/** Settings panel — receives current panelWidth so it can set its own width prop */
	panelSlot: (panelWidth: number) => ReactNode;
}

export default function ModalShell({
	title,
	onClose,
	onSave,
	config = {},
	headerLeft,
	headerCenter,
	headerExtra,
	canvasSlot,
	panelSlot,
}: ModalShellProps) {
	const {
		defaultSize = { width: 1060, height: 680 },
		minWidth = 700,
		minHeight = 460,
		defaultPanelWidth = 300,
		minPanelWidth = 240,
		maxPanelWidth = 480,
	} = config;

	const [isFullscreen, setIsFullscreen] = useState(false);
	const [modalSize, setModalSize] = useState(defaultSize);
	const [panelWidth, setPanelWidth] = useState(defaultPanelWidth);

	const modalSizeRef = useRef(defaultSize);
	const panelWidthRef = useRef(defaultPanelWidth);

	const resizingModalRef = useRef<{
		dir: ResizeDirection;
		startX: number;
		startY: number;
		startW: number;
		startH: number;
	} | null>(null);
	const resizingPanelRef = useRef(false);
	const resizingPanelStartX = useRef(0);
	const resizingPanelStartW = useRef(0);

	// Keep constraint refs stable so the mousemove effect needs no deps
	const minWidthRef = useRef(minWidth);
	const minHeightRef = useRef(minHeight);
	const minPanelWidthRef = useRef(minPanelWidth);
	const maxPanelWidthRef = useRef(maxPanelWidth);

	useEffect(() => { modalSizeRef.current = modalSize; }, [modalSize]);
	useEffect(() => { panelWidthRef.current = panelWidth; }, [panelWidth]);

	const border = greyColor(25);
	const bg = greyColor(12);
	const bgHeader = greyColor(18);
	const defColor = greyColor(80);
	const labelColor = greyColor(55);

	const handleModalResizeMouseDown = useCallback((e: React.MouseEvent, dir: ResizeDirection) => {
		e.preventDefault();
		e.stopPropagation();
		resizingModalRef.current = {
			dir,
			startX: e.clientX,
			startY: e.clientY,
			startW: modalSizeRef.current.width,
			startH: modalSizeRef.current.height,
		};
	}, []);

	const handlePanelResizeMouseDown = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		resizingPanelRef.current = true;
		resizingPanelStartX.current = e.clientX;
		resizingPanelStartW.current = panelWidthRef.current;
	}, []);

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (resizingModalRef.current) {
				const { dir, startX, startY, startW, startH } = resizingModalRef.current;
				const dx = e.clientX - startX;
				const dy = e.clientY - startY;
				let nw = startW, nh = startH;
				if (dir === 'e' || dir === 'ne' || dir === 'se') nw = Math.max(minWidthRef.current, startW + dx * 2);
				if (dir === 'w' || dir === 'nw' || dir === 'sw') nw = Math.max(minWidthRef.current, startW - dx * 2);
				if (dir === 's' || dir === 'se' || dir === 'sw') nh = Math.max(minHeightRef.current, startH + dy * 2);
				if (dir === 'n' || dir === 'ne' || dir === 'nw') nh = Math.max(minHeightRef.current, startH - dy * 2);
				setModalSize({ width: Math.round(nw), height: Math.round(nh) });
			}
			if (resizingPanelRef.current) {
				const delta = resizingPanelStartX.current - e.clientX;
				const nw = Math.min(maxPanelWidthRef.current, Math.max(minPanelWidthRef.current, resizingPanelStartW.current + delta));
				setPanelWidth(Math.round(nw));
			}
		};
		const onMouseUp = () => {
			resizingModalRef.current = null;
			resizingPanelRef.current = false;
		};
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
		return () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		};
	}, []);

	const modalStyle: React.CSSProperties = isFullscreen
		? { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999 }
		: {
				position: 'fixed',
				top: '50%',
				left: '50%',
				transform: 'translate(-50%, -50%)',
				width: modalSize.width,
				height: modalSize.height,
				zIndex: 9999,
			};

	return createPortal(
		<>
			{/* Backdrop */}
			<div
				onClick={onClose}
				style={{ position: 'fixed', inset: 0, zIndex: 9998, backgroundColor: 'rgba(0,0,0,0.55)' }}
			/>

			{/* Modal window */}
			<Box
				onClick={(e) => e.stopPropagation()}
				sx={{
					...modalStyle,
					display: 'flex',
					flexDirection: 'column',
					backgroundColor: bg,
					border: `1px solid ${border}`,
					borderRadius: isFullscreen ? 0 : '6px',
					overflow: 'hidden',
					boxShadow: '0 8px 40px rgba(0,0,0,0.75)',
				}}
			>
				{/* Resize handles */}
				{!isFullscreen &&
					(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDirection[]).map((dir) => (
						<ResizeHandle key={dir} direction={dir} onMouseDown={handleModalResizeMouseDown} />
					))}

				{/* ── Header ─────────────────────────────────────────────── */}
				<Box
					sx={{
						display: 'flex',
						alignItems: 'center',
						height: 40,
						px: 1.5,
						flexShrink: 0,
						backgroundColor: bgHeader,
						borderBottom: `1px solid ${border}`,
						gap: 1,
					}}
				>
					{headerLeft}

					{headerCenter ?? (
						<Typography fontSize={13} fontWeight={500} color={defColor} sx={{ flex: 1 }}>
							{title}
						</Typography>
					)}

					{headerExtra}

					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
						<Tooltip title={isFullscreen ? 'Restore' : 'Fullscreen'}>
							<IconButton
								size='small'
								onClick={() => setIsFullscreen((p) => !p)}
								sx={{ color: labelColor, '&:hover': { color: defColor } }}
							>
								{isFullscreen ? <Minimize2 size={16} strokeWidth={1.5} /> : <Maximize2 size={16} strokeWidth={1.5} />}
							</IconButton>
						</Tooltip>

						<Box
							component='button'
							onClick={onSave}
							sx={{
								display: 'inline-flex',
								alignItems: 'center',
								gap: '4px',
								px: 1.5,
								py: '3px',
								borderRadius: '3px',
								fontSize: 11,
								cursor: 'pointer',
								border: `1px solid ${greyColor(40)}`,
								backgroundColor: greyColor(30),
								color: '#fff',
								'&:hover': { backgroundColor: greyColor(38) },
							}}
						>
							<Save size={13} /> Save
						</Box>

						<IconButton size='small' onClick={onClose} sx={{ color: labelColor, '&:hover': { color: defColor } }}>
							<X size={16} strokeWidth={1.5} />
						</IconButton>
					</Box>
				</Box>

				{/* ── Body ───────────────────────────────────────────────── */}
				<Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
					{/* Canvas / preview (left) */}
					<Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
						{canvasSlot}
					</Box>

					{/* Panel resize handle */}
					<Box
						onMouseDown={handlePanelResizeMouseDown}
						sx={{
							width: 6,
							cursor: 'ew-resize',
							flexShrink: 0,
							backgroundColor: 'transparent',
							transition: 'background-color 0.15s',
							'&:hover': { backgroundColor: greyColor(30) },
						}}
					/>

					{/* Settings panel (right) */}
					{panelSlot(panelWidth)}
				</Box>
			</Box>
		</>,
		document.body,
	);
}
