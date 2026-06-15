// src/NODE_WIN/nodes/properties/PreviewTimeline.tsx
//
// Render-bar scrubber for ffmpeg-filter previews. The timeline is a GRID OF CELLS —
// one cell per render unit (a single frame when cellCount ≈ duration*fps, or a chunk
// for a coarser grid). You render a frame → its cell lights up; adjacent same-colour
// cells visually merge into a strip:
//
//   cells:   . . . ▓ ▓ ▓ . . ▒ ▒ . . . . . . . . . .     ▓ green=cached
//            └──── one rendered frame = one cell ────┘    ▒ amber=approx
//                                                          . original = bare track
//   ┌──────────────────────────────────────────────────┐
//   │            ▼ playhead (imperative, RAF)            │  ← scrub track
//   └──────────────────────────────────────────────────┘
//
// Like PreviewToolbar, the playhead is positioned imperatively from the parent RAF
// loop via update(currentTime, duration) — no re-render per frame. `cellStates` is a
// sparse map (index → state); it changes only on cache events (preview-progress), and
// mergeCells() collapses it to a few strips so the DOM stays tiny even for long clips.

import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from 'react';
import { formatTime } from '@/Utils/mediaUtils';
import { PreviewState, PREVIEW_STATE_COLOR, mergeCells } from './previewState';

export interface PreviewTimelineHandle {
	/** Call from the RAF loop to move the playhead without React re-renders. */
	update(currentTime: number, duration: number): void;
}

interface PreviewTimelineProps {
	/** Clip duration in seconds — drives cell + playhead layout. */
	duration: number;
	/** Number of cells the bar is divided into. ≈ duration*fps for per-frame, fewer for chunked. */
	cellCount: number;
	/** Sparse cell index → state. Missing indices render as bare track (original). */
	cellStates?: Record<number, PreviewState>;
	/** Called with a 0–1 ratio when the user clicks or drags. */
	onSeek: (ratio: number) => void;
	/** Height of the coloured render-bar in px. Default 8. */
	barHeight?: number;
	/** Show a floating time label under the cursor on hover. Default true. */
	showHoverTime?: boolean;
}

const PreviewTimeline = forwardRef<PreviewTimelineHandle, PreviewTimelineProps>(function PreviewTimeline(
	{ duration, cellCount, cellStates = {}, onSeek, barHeight = 8, showHoverTime = true },
	ref,
) {
	const trackRef = useRef<HTMLDivElement>(null);
	const playheadRef = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);
	const [hoverRatio, setHoverRatio] = useState<number | null>(null);

	// Adjacent same-state cells collapse into a handful of strips.
	const runs = useMemo(
		() => mergeCells(cellStates, duration, cellCount),
		[cellStates, duration, cellCount],
	);

	useImperativeHandle(ref, () => ({
		update(currentTime: number, dur: number) {
			if (dur <= 0 || !playheadRef.current) return;
			const pct = Math.max(0, Math.min(100, (currentTime / dur) * 100));
			playheadRef.current.style.left = `${pct}%`;
		},
	}));

	// Drag-to-scrub — window listeners so the cursor can leave the track mid-drag.
	useEffect(() => {
		const ratioAt = (clientX: number) => {
			const rect = trackRef.current?.getBoundingClientRect();
			if (!rect) return 0;
			return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		};
		const onMove = (e: MouseEvent) => {
			if (!draggingRef.current) return;
			onSeek(ratioAt(e.clientX));
		};
		const onUp = () => {
			draggingRef.current = false;
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	}, [onSeek]);

	const ratioFromEvent = (clientX: number) => {
		const rect = trackRef.current?.getBoundingClientRect();
		if (!rect) return 0;
		return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
	};

	const pct = (t: number) => (duration > 0 ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0);

	return (
		<div style={{ position: 'relative', userSelect: 'none' }}>
			{/* Render-bar — bare track is "original"; rendered cells paint over it. */}
			<div style={{ position: 'relative', height: barHeight, background: '#1c1c1c', borderRadius: 2, overflow: 'hidden' }}>
				{duration > 0 &&
					runs.map((run, i) => {
						const left = pct(run.start);
						const width = Math.max(0, pct(run.end) - left);
						if (width <= 0) return null;
						return (
							<div
								key={`${i}-${run.start}`}
								title={`${formatTime(run.start)} – ${formatTime(run.end)}`}
								style={{
									position: 'absolute',
									left: `${left}%`,
									width: `${width}%`,
									minWidth: 2, // a lone rendered cell stays visible as a small square
									top: 0,
									bottom: 0,
									background: PREVIEW_STATE_COLOR[run.state],
									opacity: run.state === 'original' ? 0.35 : 0.9,
								}}
							/>
						);
					})}
			</div>

			{/* Scrub track + playhead. */}
			<div
				ref={trackRef}
				onMouseDown={(e) => {
					draggingRef.current = true;
					onSeek(ratioFromEvent(e.clientX));
				}}
				onMouseMove={(e) => {
					if (showHoverTime) setHoverRatio(ratioFromEvent(e.clientX));
				}}
				onMouseLeave={() => setHoverRatio(null)}
				style={{ position: 'relative', height: 16, display: 'flex', alignItems: 'center', cursor: 'pointer', marginTop: 2 }}
			>
				<div style={{ position: 'absolute', width: '100%', height: 2, background: '#2a2a2a', borderRadius: 2 }} />

				{/* Playhead (imperatively positioned). */}
				<div
					ref={playheadRef}
					style={{
						position: 'absolute',
						left: '0%',
						top: 0,
						bottom: 0,
						transform: 'translateX(-50%)',
						pointerEvents: 'none',
					}}
				>
					<div style={{ width: 1, height: '100%', background: '#5a9fd4', margin: '0 auto' }} />
					<div
						style={{
							position: 'absolute',
							top: '50%',
							left: '50%',
							transform: 'translate(-50%, -50%)',
							width: 10,
							height: 10,
							borderRadius: '50%',
							background: '#ccc',
						}}
					/>
				</div>

				{/* Hover time label. */}
				{showHoverTime && hoverRatio !== null && duration > 0 && (
					<div
						style={{
							position: 'absolute',
							left: `${hoverRatio * 100}%`,
							top: -22,
							transform: 'translateX(-50%)',
							background: '#000a',
							color: '#ddd',
							fontSize: 10,
							fontFamily: 'monospace',
							padding: '1px 4px',
							borderRadius: 3,
							pointerEvents: 'none',
							whiteSpace: 'nowrap',
						}}
					>
						{formatTime(hoverRatio * duration)}
					</div>
				)}
			</div>
		</div>
	);
});

export default PreviewTimeline;
