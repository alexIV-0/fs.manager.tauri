import { memo } from 'react';
import { X, Maximize2, Minimize2, BookmarkPlus, FolderOpen, Play, Loader2 } from 'lucide-react';
import { TextEditModalProps, ResizeDirection } from './types';
import { LANGUAGES, PRESETS } from './constants';
import { ResizeHandle } from './ResizeHandle';
import { greyColor } from '@/Store/Color/grayColor';

function TextEditModal({
	label,
	language,
	isFullscreen,
	modalSize,
	anchorPos,
	editorRef,
	onClose,
	onSave,
	onLanguageChange,
	onToggleFullscreen,
	onApplyPreset,
	onResizeMouseDown,
	onSavePreset,
	onLoadPreset,
	bgModal,
	bgHeader,
	borderColor,
	defColor,
	runnable,
	running,
	runResult,
	onRun,
	onClearRun,
}: TextEditModalProps) {
	const grey12 = greyColor(12);
	const grey20 = greyColor(20);
	const grey28 = greyColor(28);
	const grey35 = greyColor(35);
	const grey45 = greyColor(45);
	const grey55 = greyColor(55);
	const grey60 = greyColor(60);
	const grey65 = greyColor(65);

	const btnBase: React.CSSProperties = {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		padding: '2px 8px',
		borderRadius: 3,
		fontSize: 11,
		cursor: 'pointer',
		border: `1px solid ${grey28}`,
		backgroundColor: grey20,
		color: grey60,
		userSelect: 'none',
		gap: 4,
	};

	const divider = <div style={{ width: 1, height: 16, backgroundColor: grey28, flexShrink: 0 }} />;

	const getModalStyle = (): React.CSSProperties => {
		if (isFullscreen) {
			return { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999 };
		}
		if (anchorPos) {
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const left = Math.min(Math.max(anchorPos.x - modalSize.width / 2, 8), vw - modalSize.width - 8);
			const top = Math.min(Math.max(anchorPos.y - modalSize.height / 2, 8), vh - modalSize.height - 8);
			return { position: 'fixed', left, top, width: modalSize.width, height: modalSize.height, zIndex: 9999 };
		}
		return {
			position: 'fixed',
			top: '50%',
			left: '50%',
			transform: 'translate(-50%, -50%)',
			width: modalSize.width,
			height: modalSize.height,
			zIndex: 9999,
		};
	};

	return (
		<>
			<style>{`@keyframes teSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
			<div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9998, backgroundColor: 'rgba(0,0,0,0.45)' }} />
			<div
				style={{
					...getModalStyle(),
					display: 'flex',
					flexDirection: 'column',
					backgroundColor: bgModal,
					border: `1px solid ${borderColor}`,
					borderRadius: isFullscreen ? 0 : 6,
					overflow: 'hidden',
					boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
				}}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Resize handles */}
				{!isFullscreen &&
					(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDirection[]).map((dir) => (
						<ResizeHandle key={dir} direction={dir} onMouseDown={onResizeMouseDown} />
					))}

				{/* ── Строка 1: имя, размеры, fullscreen, close ── */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 8,
						padding: '0 12px',
						height: 36,
						flexShrink: 0,
						backgroundColor: bgHeader,
						borderBottom: `1px solid ${borderColor}`,
					}}
				>
					<span
						style={{
							fontSize: 13,
							fontWeight: 500,
							color: defColor,
							whiteSpace: 'nowrap',
							flex: 1,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
						}}
					>
						{label || 'Text Editor'}
					</span>

					<div style={{ display: 'flex', gap: 4 }}>
						{(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((preset) => (
							<div key={preset} style={btnBase} onClick={() => onApplyPreset(preset)}>
								{preset}
							</div>
						))}
					</div>

					{divider}

					<button onClick={onToggleFullscreen} title={isFullscreen ? 'Restore' : 'Fullscreen'} style={{ ...btnBase, padding: '3px 6px' }}>
						{isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
					</button>

					<button onClick={onClose} style={{ ...btnBase, padding: '3px 6px' }}>
						<X size={14} />
					</button>
				</div>

				{/* ── Строка 2: язык, Save/Load Preset, Save ── */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 8,
						padding: '0 12px',
						height: 34,
						flexShrink: 0,
						backgroundColor: bgHeader,
						borderBottom: `1px solid ${borderColor}`,
					}}
				>
					<select
						value={language}
						onChange={(e) => onLanguageChange(e.target.value as any)}
						style={{
							fontSize: 12,
							backgroundColor: grey20,
							color: grey65,
							border: `1px solid ${grey28}`,
							borderRadius: 3,
							padding: '2px 18px 2px 4px',
							cursor: 'pointer',
							outline: 'none',
							appearance: 'none',
							WebkitAppearance: 'none',
							backgroundImage: "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23888'/%3E%3C%2Fsvg%3E\")",
							backgroundRepeat: 'no-repeat',
							backgroundPosition: 'right 4px center',
						}}
					>
						{LANGUAGES.map((lang) => (
							<option key={lang.value} value={lang.value}>
								{lang.label}
							</option>
						))}
					</select>

					{divider}

					<div onClick={onSavePreset} title='Save as preset' style={btnBase}>
						<BookmarkPlus size={12} />
						<span>Save Preset</span>
					</div>

					<div onClick={onLoadPreset} title='Load preset' style={btnBase}>
						<FolderOpen size={12} />
						<span>Load Preset</span>
					</div>

					<div style={{ flex: 1 }} />

					{runnable && onRun && (
						<div
							onClick={running ? undefined : onRun}
							title='Выполнить код с текущими значениями входов'
							style={{
								...btnBase,
								backgroundColor: '#1f3a24',
								border: `1px solid #2e7d32`,
								color: '#a5d6a7',
								padding: '3px 12px',
								fontSize: 12,
								cursor: running ? 'default' : 'pointer',
								opacity: running ? 0.6 : 1,
							}}
						>
							{running ? <Loader2 size={12} style={{ animation: 'teSpin 0.8s linear infinite' }} /> : <Play size={12} />}
							<span>Run</span>
						</div>
					)}

					<div
						onClick={onSave}
						style={{
							...btnBase,
							backgroundColor: grey35,
							border: `1px solid ${grey45}`,
							color: '#fff',
							padding: '3px 16px',
							fontSize: 12,
						}}
					>
						Save
					</div>
				</div>

				{/* Editor */}
				<div
					ref={editorRef}
					style={{ flex: 1, overflow: 'hidden', minHeight: 80 }}
					onKeyDown={(e) => e.stopPropagation()}
					onKeyUp={(e) => e.stopPropagation()}
					onKeyPress={(e) => e.stopPropagation()}
				/>

				{/* ── Панель результата (runnable-режим) ── */}
				{runnable && runResult && (
					<div
						style={{
							flexShrink: 0,
							height: 150,
							display: 'flex',
							flexDirection: 'column',
							borderTop: `1px solid ${borderColor}`,
							backgroundColor: grey12,
						}}
					>
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 8,
								padding: '0 12px',
								height: 26,
								flexShrink: 0,
								backgroundColor: bgHeader,
								borderBottom: `1px solid ${borderColor}`,
							}}
						>
							<span style={{ fontSize: 11, fontWeight: 600, color: runResult.ok ? '#a5d6a7' : '#ef9a9a' }}>
								{runResult.ok ? '● Результат' : '● Ошибка'}
							</span>
							<span style={{ fontSize: 10, color: grey55 }}>{runResult.durationMs} ms</span>
							{runResult.unavailable.length > 0 && (
								<span style={{ fontSize: 10, color: '#e6b422' }} title='Эти входы — коннекторы; их значение придёт из пайплайна, в тесте они undefined'>
									⚠ входы недоступны в тесте: {runResult.unavailable.join(', ')}
								</span>
							)}
							<div style={{ flex: 1 }} />
							{onClearRun && (
								<button onClick={onClearRun} style={{ ...btnBase, padding: '2px 6px' }} title='Скрыть'>
									<X size={12} />
								</button>
							)}
						</div>
						<div
							style={{
								flex: 1,
								overflow: 'auto',
								padding: '6px 12px',
								fontFamily: 'monospace',
								fontSize: 11,
								lineHeight: 1.5,
								whiteSpace: 'pre-wrap',
								wordBreak: 'break-word',
							}}
						>
							{runResult.logs.length > 0 && (
								<div style={{ color: grey60, marginBottom: 6 }}>
									{runResult.logs.map((line, i) => (
										<div key={i}>
											<span style={{ color: grey45, userSelect: 'none' }}>› </span>
											{line}
										</div>
									))}
								</div>
							)}
							{runResult.ok ? (
								<div style={{ color: '#c8e6c9' }}>{formatResult(runResult.result)}</div>
							) : (
								<div style={{ color: '#ef9a9a' }}>{runResult.error}</div>
							)}
						</div>
					</div>
				)}
			</div>
		</>
	);
}

// Красивый вывод результата: строку — как есть, остальное — JSON с отступами.
function formatResult(value: unknown): string {
	if (typeof value === 'undefined') return 'undefined  (код ничего не вернул — используй return)';
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export default memo(TextEditModal);
