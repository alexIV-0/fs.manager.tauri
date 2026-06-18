// src/NODE_WIN/nodes/properties/usePreviewCache.ts
//
// The shared "green tier" engine behind the render-bar preview. Plugin-agnostic: it
// only needs a buildSpec(time) that produces an ffmpeg render-spec (the per-plugin
// filtergraph builder lives in the plugin). It manages:
//
//   • a render QUEUE with a concurrency cap (so dragging a slider doesn't fork 50 ffmpegs)
//   • per-cell state for PreviewTimeline (approx 🟡 while rendering → cached 🟢 when done)
//   • frameState / frameUrl for the on-screen frame + corner dot
//   • cache invalidation when the filtergraph changes (graphKey), with a generation guard
//     so stale in-flight renders from a previous graph can't poison the new cell map.
//
// Each cell renders its CENTRE time (deterministic per cell → stable disk-cache reuse).
// Caching itself is in Rust (preview_render_frame, keyed by spec hash + source mtime);
// this hook only tracks which cells we've already resolved a URL for.

import { useCallback, useEffect, useRef, useState } from 'react';
import { commands, unwrap } from '@/Utils/specta';
import { toFileUrl } from '@/Utils/mediaUtils';
import type { PreviewRenderSpec } from '@/bindings';
import { PreviewState, cellForTime } from './previewState';

interface UsePreviewCacheArgs {
	/** Clip duration in seconds. */
	duration: number;
	/** Timeline grid resolution (cells). One cell = one render unit. */
	cellCount: number;
	/**
	 * Build the render spec for a given time, or null if nothing to render
	 * (no file selected, empty filtergraph, etc.). Keep this referentially fresh —
	 * the hook always calls the latest version via a ref.
	 */
	buildSpec: (time: number) => PreviewRenderSpec | null;
	/**
	 * Opaque string that changes whenever the filtergraph changes (e.g. JSON of the
	 * settings that affect the graph). Bumping it invalidates the cell map.
	 */
	graphKey: string;
	/** Max concurrent ffmpeg renders. Default 2. */
	maxConcurrent?: number;
	/** Debounce (ms) before a non-cached cell is actually enqueued. Default 200. */
	debounceMs?: number;
}

export interface UsePreviewCacheResult {
	/** Cell index → state, for <PreviewTimeline cellStates>. */
	cellStates: Record<number, PreviewState>;
	/** asset-URL of the cached frame to show for the current cell, or null. */
	frameUrl: string | null;
	/** Fidelity of the on-screen frame, for <PreviewStateDot>. */
	frameState: PreviewState;
	/** Call on seek / playhead move: shows the cached frame if ready, else queues a render. */
	requestFrame: (time: number) => void;
}

export function usePreviewCache({
	duration,
	cellCount,
	buildSpec,
	graphKey,
	maxConcurrent = 2,
	debounceMs = 200,
}: UsePreviewCacheArgs): UsePreviewCacheResult {
	const [cellStates, setCellStates] = useState<Record<number, PreviewState>>({});
	const [frameUrl, setFrameUrl] = useState<string | null>(null);
	const [frameState, setFrameState] = useState<PreviewState>('original');

	// Latest-value refs so async callbacks never close over stale props.
	const buildSpecRef = useRef(buildSpec);
	buildSpecRef.current = buildSpec;
	const durationRef = useRef(duration);
	durationRef.current = duration;
	const cellCountRef = useRef(cellCount);
	cellCountRef.current = cellCount;

	const urlByCell = useRef<Map<number, string>>(new Map());
	const inflight = useRef<Set<number>>(new Set());
	const queue = useRef<number[]>([]);
	const activeRef = useRef(0);
	const currentCellRef = useRef(-1);
	const genRef = useRef(0); // bumped on invalidation; guards stale async results
	const debounceTimer = useRef<number | null>(null);

	const cellCenterTime = (idx: number) => {
		const cc = cellCountRef.current;
		return cc > 0 ? ((idx + 0.5) * durationRef.current) / cc : 0;
	};

	const pump = useCallback(() => {
		while (activeRef.current < maxConcurrent && queue.current.length > 0) {
			const idx = queue.current.shift()!;
			if (inflight.current.has(idx) || urlByCell.current.has(idx)) continue;

			const spec = buildSpecRef.current(cellCenterTime(idx));
			if (!spec) continue;

			const gen = genRef.current;
			inflight.current.add(idx);
			activeRef.current += 1;
			setCellStates((prev) => (prev[idx] === 'cached' ? prev : { ...prev, [idx]: 'approx' }));

			commands
				.previewRenderFrame(spec)
				.then((r) => {
					if (gen !== genRef.current) return; // graph changed mid-flight — drop
					const res = unwrap(r);
					const url = toFileUrl(res.path);
					urlByCell.current.set(idx, url);
					setCellStates((prev) => ({ ...prev, [idx]: 'cached' }));
					if (currentCellRef.current === idx) {
						setFrameUrl(url);
						setFrameState('cached');
					}
				})
				.catch((err) => {
					if (gen !== genRef.current) return;
					setCellStates((prev) => {
						const next = { ...prev };
						delete next[idx];
						return next;
					});
					console.warn('[preview] render failed:', err);
				})
				.finally(() => {
					inflight.current.delete(idx);
					if (gen === genRef.current) {
						activeRef.current = Math.max(0, activeRef.current - 1);
						pump();
					}
				});
		}
	}, [maxConcurrent]);

	const requestFrame = useCallback(
		(time: number) => {
			const cc = cellCountRef.current;
			// duration may legitimately be 0 (still image = single cell at t=0); only cellCount must be valid.
			if (cc <= 0) return;
			const idx = cellForTime(time, durationRef.current, cc);
			currentCellRef.current = idx;

			// Already have an accurate frame for this cell → swap instantly.
			const cachedUrl = urlByCell.current.get(idx);
			if (cachedUrl) {
				setFrameUrl(cachedUrl);
				setFrameState('cached');
				return;
			}

			// Not cached: the on-screen approximation (client-side canvas) is the truth
			// the user sees now; mark the dot accordingly and queue an accurate render.
			setFrameState('approx');
			if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
			debounceTimer.current = window.setTimeout(() => {
				debounceTimer.current = null;
				if (!inflight.current.has(idx) && !urlByCell.current.has(idx)) {
					queue.current.push(idx);
					pump();
				}
			}, debounceMs);
		},
		[debounceMs, pump],
	);

	// Filtergraph changed → everything previously rendered is stale.
	useEffect(() => {
		genRef.current += 1;
		queue.current = [];
		inflight.current.clear();
		urlByCell.current.clear();
		activeRef.current = 0;
		if (debounceTimer.current !== null) {
			window.clearTimeout(debounceTimer.current);
			debounceTimer.current = null;
		}
		setCellStates({});
		setFrameUrl(null);
		setFrameState('original');
		// The caller re-requests the current frame (it owns the playhead time) — keeping
		// the hook driven solely by requestFrame avoids a double-fire on graph changes.
	}, [graphKey]);

	// Cleanup pending timer on unmount.
	useEffect(
		() => () => {
			if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
		},
		[],
	);

	return { cellStates, frameUrl, frameState, requestFrame };
}
