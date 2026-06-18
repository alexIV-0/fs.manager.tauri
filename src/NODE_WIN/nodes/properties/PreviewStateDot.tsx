// src/NODE_WIN/nodes/properties/PreviewStateDot.tsx
//
// Corner indicator showing the fidelity of the frame currently on screen:
//   ⚪ original — source, no effects (always instant)
//   🟡 approx   — fast approximation shown / accurate frame rendering in background
//   🟢 cached   — accurate ffmpeg frame == final export
//
// This replaces the per-plugin "Original / Preview" toggle buttons: instead of the
// user choosing what to see, they always see the best available and the dot tells
// them how trustworthy it is. Drops into the top corner of any preview surface.

import { CSSProperties } from 'react';
import { PreviewState, PREVIEW_STATE_COLOR, PREVIEW_STATE_LABEL } from './previewState';

interface PreviewStateDotProps {
	state: PreviewState;
	/** Show the text label beside the dot. Default false (dot only, label in tooltip). */
	showLabel?: boolean;
	/** Override / extend positioning. Defaults to top-right corner. */
	style?: CSSProperties;
}

export default function PreviewStateDot({ state, showLabel = false, style }: PreviewStateDotProps) {
	const color = PREVIEW_STATE_COLOR[state];
	const label = PREVIEW_STATE_LABEL[state];
	const pulsing = state === 'approx';

	return (
		<div
			title={label}
			style={{
				position: 'absolute',
				top: 8,
				right: 8,
				display: 'flex',
				alignItems: 'center',
				gap: 5,
				padding: showLabel ? '2px 7px 2px 6px' : 2,
				borderRadius: 10,
				background: '#000000a0',
				pointerEvents: 'none',
				zIndex: 5,
				...style,
			}}
		>
			<span
				style={{
					width: 8,
					height: 8,
					borderRadius: '50%',
					background: color,
					boxShadow: `0 0 4px ${color}`,
					animation: pulsing ? 'fsmPreviewPulse 1s ease-in-out infinite' : undefined,
				}}
			/>
			{showLabel && <span style={{ fontSize: 10, color: '#ddd', whiteSpace: 'nowrap' }}>{label}</span>}

			{pulsing && (
				<style>{`@keyframes fsmPreviewPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
			)}
		</div>
	);
}
