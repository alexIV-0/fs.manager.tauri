// src/NODE_WIN/nodes/properties/PreviewToolbar.tsx
//
// Reusable playback controls bar shared by ConvertPreview, KeyingPreview, VideoAdjustPreview.
// The parent RAF loop drives progress updates via the imperative handle.

import { forwardRef, useRef, useEffect, useImperativeHandle, ReactNode } from 'react';
import { formatTime } from '@/Utils/mediaUtils';

export interface PreviewToolbarHandle {
	/** Call from the RAF loop to update progress bar and time display without React re-renders. */
	update(currentTime: number, duration: number): void;
}

interface PreviewToolbarProps {
	playing: boolean;
	onTogglePlay: () => void;
	/** Called with a 0–1 ratio when the user drags or clicks the progress bar. */
	onSeek: (ratio: number) => void;

	/** When false, hides the progress bar and playback row (for image files). Default: true. */
	showPlayback?: boolean;
	/** Show ◀ ▶ frame step buttons next to play. Default: false. */
	showFrameStep?: boolean;
	onStepFrame?: (dir: 1 | -1) => void;
	/** Rendered at the far right of the playback row (e.g. Refresh button, format label). */
	rightSlot?: ReactNode;
	/** Rendered as an extra row below the playback row (e.g. mode toggle buttons). */
	bottomSlot?: ReactNode;
	/** Replaces the built-in thin progress bar (e.g. with a render-bar timeline). The
	 *  built-in `update()` still drives the time display; drive the slot's playhead yourself. */
	progressSlot?: ReactNode;

	/** Explicit container height in px. When omitted the container auto-sizes to content. */
	height?: number;
}

const PreviewToolbar = forwardRef<PreviewToolbarHandle, PreviewToolbarProps>(function PreviewToolbar(
	{ playing, onTogglePlay, onSeek, showPlayback = true, showFrameStep, onStepFrame, rightSlot, bottomSlot, progressSlot, height },
	ref,
) {
	const progressBarRef   = useRef<HTMLDivElement>(null);
	const progressFillRef  = useRef<HTMLDivElement>(null);
	const progressThumbRef = useRef<HTMLDivElement>(null);
	const timeDisplayRef   = useRef<HTMLSpanElement>(null);
	const draggingRef      = useRef(false);

	useImperativeHandle(ref, () => ({
		update(currentTime: number, duration: number) {
			if (duration <= 0) return;
			const pct = (currentTime / duration) * 100;
			if (progressFillRef.current)  progressFillRef.current.style.width = `${pct}%`;
			if (progressThumbRef.current) progressThumbRef.current.style.left  = `${pct}%`;
			if (timeDisplayRef.current) {
				timeDisplayRef.current.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
			}
		},
	}));

	// Progress bar drag — lives here so parents need no drag refs/effects.
	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (!draggingRef.current || !progressBarRef.current) return;
			const rect = progressBarRef.current.getBoundingClientRect();
			onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
		};
		const onUp = () => { draggingRef.current = false; };
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	}, [onSeek]);

	return (
		<div style={{
			height,
			background: '#141414',
			borderTop: '1px solid #222',
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'center',
			padding: '0 16px',
			gap: 5,
			flexShrink: 0,
		}}>
			{showPlayback && (
				<>
					{/* Progress bar — built-in thin bar, or a caller-provided render-bar timeline. */}
					{progressSlot ?? (
						<div
							ref={progressBarRef}
							onMouseDown={(e) => {
								draggingRef.current = true;
								const rect = e.currentTarget.getBoundingClientRect();
								onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
							}}
							style={{ position: 'relative', height: 16, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
						>
							<div style={{ position: 'absolute', width: '100%', height: 3, background: '#2a2a2a', borderRadius: 2 }}>
								<div ref={progressFillRef} style={{ width: '0%', height: '100%', background: '#5a9fd4', borderRadius: 2 }} />
							</div>
							<div
								ref={progressThumbRef}
								style={{
									position: 'absolute', left: '0%', top: '50%',
									transform: 'translate(-50%, -50%)',
									width: 10, height: 10, borderRadius: '50%', background: '#ccc',
									pointerEvents: 'none',
								}}
							/>
						</div>
					)}

					{/* Playback row */}
					<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
						<button
							onClick={onTogglePlay}
							style={{
								width: 26, height: 26, borderRadius: '50%',
								border: '1px solid #333', background: '#252525', color: '#ccc',
								cursor: 'pointer', display: 'flex', alignItems: 'center',
								justifyContent: 'center', fontSize: 10, flexShrink: 0, outline: 'none',
							}}
						>
							{playing ? '⏸' : '▶'}
						</button>

						{showFrameStep && onStepFrame && (
							<>
								<button
									onClick={() => onStepFrame(-1)}
									style={{ width: 22, height: 22, borderRadius: 3, border: '1px solid #333', background: '#252525', color: '#888', cursor: 'pointer', fontSize: 10, outline: 'none' }}
									title='Previous frame'
								>◀</button>
								<button
									onClick={() => onStepFrame(1)}
									style={{ width: 22, height: 22, borderRadius: 3, border: '1px solid #333', background: '#252525', color: '#888', cursor: 'pointer', fontSize: 10, outline: 'none' }}
									title='Next frame'
								>▶</button>
							</>
						)}

						<span ref={timeDisplayRef} style={{ color: '#555', fontSize: 11, fontFamily: 'monospace' }}>
							0:00 / 0:00
						</span>

						<span style={{ flex: 1 }} />
						{rightSlot}
					</div>
				</>
			)}

			{bottomSlot}
		</div>
	);
});

export default PreviewToolbar;
