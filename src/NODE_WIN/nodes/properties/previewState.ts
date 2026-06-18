// src/NODE_WIN/nodes/properties/previewState.ts
//
// Shared state model for the ffmpeg-filter preview render-bar.
// Mirrors the NLE render-bar convention (Premiere/Resolve) the way we designed it:
//
//   original — source frame, no effects applied. Always instantly available;
//              what plays back outside cached ranges. (the "white" dot)
//   approx   — a fast client-side approximation is on screen, OR an accurate
//              ffmpeg frame is being rendered in the background. (the "yellow" dot)
//   cached   — an accurate ffmpeg-rendered frame is ready and == what the final
//              export will produce. (the "green" dot)
//
// Two distinct UI surfaces consume this:
//   • PreviewStateDot     — fidelity of the frame on screen RIGHT NOW (corner dot).
//   • PreviewTimeline      — cache coverage across the clip (the render-bar segments).

export type PreviewState = 'original' | 'approx' | 'cached';

/**
 * A run of one or more adjacent cells sharing a state, in seconds.
 * Produced by mergeCells() and consumed by PreviewTimeline for cheap rendering —
 * thousands of rendered frames collapse to a handful of coloured strips.
 */
export interface PreviewSegment {
	/** Start time in seconds (inclusive). */
	start: number;
	/** End time in seconds (exclusive). */
	end: number;
	state: PreviewState;
}

/**
 * The timeline is a grid of `cellCount` equal cells; one cell = one render unit
 * (a single frame when cellCount ≈ duration*fps, or a chunk for coarser grids).
 * Map a clip time to its cell index.
 */
export function cellForTime(t: number, duration: number, cellCount: number): number {
	if (duration <= 0 || cellCount <= 0) return 0;
	return Math.max(0, Math.min(cellCount - 1, Math.floor((t / duration) * cellCount)));
}

/** Inverse of cellForTime — the [start, end) seconds covered by a cell. */
export function cellTimeRange(idx: number, duration: number, cellCount: number): [number, number] {
	const w = cellCount > 0 ? duration / cellCount : 0;
	return [idx * w, (idx + 1) * w];
}

/**
 * Collapse a sparse cell→state map into contiguous same-state runs (in seconds).
 * Cost is O(rendered cells), not O(cellCount), so a 9000-frame clip with 10 rendered
 * frames produces ≤10 runs. Cells absent from the map are "original" (bare track).
 */
export function mergeCells(
	cellStates: Record<number, PreviewState>,
	duration: number,
	cellCount: number,
): PreviewSegment[] {
	const cells = Object.keys(cellStates)
		.map((k) => Number(k))
		.filter((i) => Number.isFinite(i) && i >= 0 && i < cellCount)
		.sort((a, b) => a - b);

	const runs: { s: number; e: number; state: PreviewState }[] = [];
	for (const idx of cells) {
		const state = cellStates[idx];
		const last = runs[runs.length - 1];
		if (last && last.state === state && last.e === idx) last.e = idx + 1;
		else runs.push({ s: idx, e: idx + 1, state });
	}

	const w = cellCount > 0 ? duration / cellCount : 0;
	return runs.map((r) => ({ start: r.s * w, end: r.e * w, state: r.state }));
}

/** Render-bar / dot colours. `original` is a light grey that reads as "raw / white". */
export const PREVIEW_STATE_COLOR: Record<PreviewState, string> = {
	original: '#c9ced3',
	approx: '#e0a82e',
	cached: '#46b450',
};

/** Human labels (RU) for tooltips / legends. */
export const PREVIEW_STATE_LABEL: Record<PreviewState, string> = {
	original: 'Оригинал',
	approx: 'Приближение / считается…',
	cached: 'Готово — точный кадр',
};

/**
 * Per-filter preview tier. Determines whether we can show a live client-side
 * approximation while the user drags sliders, or whether the only honest preview
 * is a background ffmpeg render.
 *
 *   live   — point/spatial filters (eq, chromakey, despill, curves, blur…):
 *            approximate instantly on canvas/WebGL, then confirm with a green frame.
 *   render — temporal/multi-frame filters (vidstab, deflicker, hqdn3d, bwdif,
 *            minterpolate…): no meaningful single-frame approximation exists;
 *            the dot stays `approx` until the ffmpeg frame lands.
 */
export type FilterPreviewTier = 'live' | 'render';

/**
 * The frame on screen is only as accurate as the weakest filter in the chain.
 * If every active filter is `live`, an approximation faithfully represents the
 * result; if any filter is `render`, the approximation is incomplete and the user
 * must wait for the cached (green) frame to see the truth.
 */
export function chainPreviewTier(tiers: FilterPreviewTier[]): FilterPreviewTier {
	return tiers.some((t) => t === 'render') ? 'render' : 'live';
}
