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
import { useWavesurfer } from '@wavesurfer/react';
import RegionsPlugin from 'wavesurfer.js/plugins/regions';
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
	/** asset-URL аудио/видео файла — рисуем полную вейвформу под таймлайном. */
	audioUrl?: string;
	/** Выбор региона на вейвформе (drag): {start,end} в секундах или null при сбросе. */
	onRegion?: (r: { start: number; end: number } | null) => void;
	/** Текущий режим проигрывания региона (подсветка кнопок). */
	audioMode?: 'original' | 'processed';
	/** Клик по кнопке Orig/Filtered на регионе → проиграть этот режим. */
	onPlayMode?: (m: 'original' | 'processed') => void;
}

const PreviewTimeline = forwardRef<PreviewTimelineHandle, PreviewTimelineProps>(function PreviewTimeline(
	{ duration, cellCount, cellStates = {}, onSeek, barHeight = 8, showHoverTime = true, audioUrl, onRegion, audioMode, onPlayMode },
	ref,
) {
	const trackRef = useRef<HTMLDivElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const playheadRef = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);
	const [hoverRatio, setHoverRatio] = useState<number | null>(null);
	const [trackW, setTrackW] = useState(0);

	// Adjacent same-state cells collapse into a handful of strips.
	const runs = useMemo(
		() => mergeCells(cellStates, duration, cellCount),
		[cellStates, duration, cellCount],
	);

	// Линейка времени по ширине: минорные тики всегда видны, подписи прорежены «по-умному».
	const ruler = useMemo(() => {
		if (duration <= 0 || trackW <= 0) return { minor: [] as number[], labels: [] as number[] };
		const pxPerSec = trackW / duration;
		const nice = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
		const labelStep = nice.find((s) => s * pxPerSec >= 55) ?? 3600;
		const minorStep = nice.find((s) => s * pxPerSec >= 9) ?? labelStep;
		const minor: number[] = [];
		for (let t = 0; t <= duration + 1e-6; t += minorStep) minor.push(t);
		const labels: number[] = [];
		for (let t = 0; t <= duration + 1e-6; t += labelStep) labels.push(t);
		return { minor, labels };
	}, [duration, trackW]);

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

	// Ширина линейки → «умная» плотность подписей.
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const upd = () => setTrackW(el.clientWidth);
		upd();
		const ro = new ResizeObserver(upd);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const ratioFromEvent = (clientX: number) => {
		const rect = trackRef.current?.getBoundingClientRect();
		if (!rect) return 0;
		return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
	};

	const pct = (t: number) => (duration > 0 ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0);

	return (
		<div ref={rootRef} style={{ position: 'relative', userSelect: 'none' }}>
			{/* Линейка времени: минорные тики + «умные» подписи (зависят от ширины) */}
			{ruler.minor.length > 0 && (
				<div style={{ position: 'relative', height: 14, marginBottom: 1, background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), rgba(0,0,0,0))' }}>
					{ruler.minor.map((t) => (
						<div key={`m${t}`} style={{ position: 'absolute', left: `${pct(t)}%`, bottom: 0, width: 1, height: 4, background: '#3a3a3a' }} />
					))}
					{ruler.labels.map((t) => (
						<span key={`l${t}`} style={{ position: 'absolute', left: `${pct(t)}%`, top: 0, transform: 'translateX(-50%)', fontSize: 9, color: '#777', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
							{formatTime(t)}
						</span>
					))}
				</div>
			)}

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

			{/* Полная вейвформа аудио под таймлайном */}
			{audioUrl && duration > 0 && <TimelineWave url={audioUrl} height={36} duration={duration} onSeek={onSeek} onRegion={onRegion} audioMode={audioMode} onPlayMode={onPlayMode} />}
		</div>
	);
});

// Статичная вейвформа всей дорожки (без интерактива — seek через scrub-трек выше).
function TimelineWave({ url, height, duration, onSeek, onRegion, audioMode, onPlayMode }: { url: string; height: number; duration: number; onSeek: (ratio: number) => void; onRegion?: (r: { start: number; end: number } | null) => void; audioMode?: 'original' | 'processed'; onPlayMode?: (m: 'original' | 'processed') => void }) {
	const ref = useRef<HTMLDivElement>(null);
	const regions = useMemo(() => RegionsPlugin.create(), []);
	const plugins = useMemo(() => [regions], [regions]);
	const [reg, setReg] = useState<{ start: number; end: number } | null>(null);
	const { wavesurfer } = useWavesurfer({
		container: ref,
		url,
		height,
		waveColor: '#37474f',
		progressColor: '#4a6572',
		cursorColor: '#5a9fd4',
		cursorWidth: 1,
		barWidth: 1,
		barGap: 0,
		interact: true,
		normalize: true,
		plugins,
	});
	// Клик → перенос плейхеда + сброс региона; drag → выбор региона (для превью аудио).
	useEffect(() => {
		if (!wavesurfer) return;
		const disableDrag = regions.enableDragSelection({ color: 'rgba(90,159,212,0.18)' });
		const onCreated = (region: any) => {
			regions.getRegions().forEach((r: any) => { if (r.id !== region.id) r.remove(); });
			const v = { start: region.start, end: region.end };
			setReg(v);
			onRegion?.(v);
		};
		const onUpdated = (region: any) => { const v = { start: region.start, end: region.end }; setReg(v); onRegion?.(v); };
		const onRemoved = () => { if (regions.getRegions().length === 0) { setReg(null); onRegion?.(null); } };
		const onInteraction = (newTime: number) => {
			const d = duration > 0 ? duration : wavesurfer.getDuration();
			if (d > 0) onSeek(Math.max(0, Math.min(1, newTime / d)));
			regions.clearRegions();
			setReg(null);
			onRegion?.(null);
		};
		regions.on('region-created', onCreated);
		regions.on('region-updated', onUpdated);
		regions.on('region-removed', onRemoved);
		wavesurfer.on('interaction', onInteraction);
		return () => {
			disableDrag?.();
			regions.un('region-created', onCreated);
			regions.un('region-updated', onUpdated);
			regions.un('region-removed', onRemoved);
			wavesurfer.un('interaction', onInteraction);
		};
	}, [wavesurfer, regions, duration, onSeek, onRegion]);

	const leftPct = reg && duration > 0 ? (reg.start / duration) * 100 : 0;
	const widthPct = reg && duration > 0 ? Math.max(0, ((reg.end - reg.start) / duration) * 100) : 0;
	const centerPct = leftPct + widthPct / 2;

	return (
		<div style={{ position: 'relative', width: '100%', marginTop: 4 }}>
			<div ref={ref} style={{ width: '100%', opacity: 0.85, cursor: 'pointer' }} />
			{reg && duration > 0 && (
				<>
					{/* Зелёная полоса под регионом — диапазон проигрывания. */}
					<div style={{ position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, bottom: 0, height: 3, background: '#4ade80', pointerEvents: 'none' }} />
					{/* 2 кнопки по центру региона (могут выходить за его пределы). */}
					<div style={{ position: 'absolute', left: `${centerPct}%`, top: 1, transform: 'translateX(-50%)', display: 'flex', gap: 3, zIndex: 5 }}>
						<button
							type='button'
							onClick={(e) => { e.stopPropagation(); onPlayMode?.('original'); }}
							title='Проиграть оригинал участка'
							style={{ padding: '1px 6px', fontSize: 9, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap', outline: 'none', border: `1px solid ${audioMode === 'original' ? '#4ade80' : '#3a3a3a'}`, background: audioMode === 'original' ? 'rgba(74,222,128,0.18)' : 'rgba(20,20,20,0.85)', color: audioMode === 'original' ? '#86efac' : '#aaa' }}
						>▶ Orig</button>
						<button
							type='button'
							onClick={(e) => { e.stopPropagation(); onPlayMode?.('processed'); }}
							title='Проиграть участок с аудио-фильтрами'
							style={{ padding: '1px 6px', fontSize: 9, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap', outline: 'none', border: `1px solid ${audioMode === 'processed' ? '#4ade80' : '#3a3a3a'}`, background: audioMode === 'processed' ? 'rgba(74,222,128,0.18)' : 'rgba(20,20,20,0.85)', color: audioMode === 'processed' ? '#86efac' : '#aaa' }}
						>▶ Filtered</button>
					</div>
				</>
			)}
		</div>
	);
}

export default PreviewTimeline;
