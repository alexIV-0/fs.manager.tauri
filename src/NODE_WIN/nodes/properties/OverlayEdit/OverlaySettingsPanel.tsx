// src/NODE_WIN/nodes/properties/OverlayEdit/OverlaySettingsPanel.tsx

import { memo } from 'react';
import { Box, Typography, Divider } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { OverlayFormatSettings } from './types';
import PanelSlider from '../PanelSlider';
import { SectionLabel, CheckboxRow, FilePickerButton } from '../PanelUI';
import { NumInput } from '@/components/NumInput';

// ── 3×3 position presets ───────────────────────────────────────────────────

const PRESETS_9 = [
	{ id: 'tl', symbol: '↖' },
	{ id: 'tc', symbol: '↑' },
	{ id: 'tr', symbol: '↗' },
	{ id: 'ml', symbol: '←' },
	{ id: 'cc', symbol: '+' },
	{ id: 'mr', symbol: '→' },
	{ id: 'bl', symbol: '↙' },
	{ id: 'bc', symbol: '↓' },
	{ id: 'br', symbol: '↘' },
] as const;

type PresetId = (typeof PRESETS_9)[number]['id'];

function applyPreset(id: PresetId, s: OverlayFormatSettings): OverlayFormatSettings {
	const { bgWidth, bgHeight, scaleW, scaleH } = s;
	let posX = s.posX;
	let posY = s.posY;
	switch (id) {
		case 'tl': posX = 0; posY = 0; break;
		case 'tc': posX = (bgWidth - scaleW) / 2; posY = 0; break;
		case 'tr': posX = bgWidth - scaleW; posY = 0; break;
		case 'ml': posX = 0; posY = (bgHeight - scaleH) / 2; break;
		case 'cc': posX = (bgWidth - scaleW) / 2; posY = (bgHeight - scaleH) / 2; break;
		case 'mr': posX = bgWidth - scaleW; posY = (bgHeight - scaleH) / 2; break;
		case 'bl': posX = 0; posY = bgHeight - scaleH; break;
		case 'bc': posX = (bgWidth - scaleW) / 2; posY = bgHeight - scaleH; break;
		case 'br': posX = bgWidth - scaleW; posY = bgHeight - scaleH; break;
	}
	return { ...s, posX: parseFloat(posX.toFixed(2)), posY: parseFloat(posY.toFixed(2)) };
}

function detectActivePreset(s: OverlayFormatSettings): PresetId | null {
	const { bgWidth, bgHeight, scaleW, scaleH, posX, posY } = s;
	const TOL = 1.5;
	const expected: Record<PresetId, [number, number]> = {
		tl: [0, 0],
		tc: [(bgWidth - scaleW) / 2, 0],
		tr: [bgWidth - scaleW, 0],
		ml: [0, (bgHeight - scaleH) / 2],
		cc: [(bgWidth - scaleW) / 2, (bgHeight - scaleH) / 2],
		mr: [bgWidth - scaleW, (bgHeight - scaleH) / 2],
		bl: [0, bgHeight - scaleH],
		bc: [(bgWidth - scaleW) / 2, bgHeight - scaleH],
		br: [bgWidth - scaleW, bgHeight - scaleH],
	};
	for (const [id, [ex, ey]] of Object.entries(expected) as [PresetId, [number, number]][]) {
		if (Math.abs(posX - ex) < TOL && Math.abs(posY - ey) < TOL) return id;
	}
	return null;
}

function fileBasename(p: string): string {
	return p.split(/[/\\]/).pop() ?? p;
}

// ── Component ──────────────────────────────────────────────────────────────

interface OverlaySettingsPanelProps {
	settings: OverlayFormatSettings;
	onChange: (s: OverlayFormatSettings) => void;
	width: number;
	bgFilePath: string;
	fgFilePath: string;
	onBgFile: (path: string) => void;
	onFgFile: (path: string) => void;
	lockAspect: boolean;
	onLockAspectChange: (v: boolean) => void;
}

function OverlaySettingsPanel({
	settings,
	onChange,
	width,
	bgFilePath,
	fgFilePath,
	onBgFile,
	onFgFile,
	lockAspect,
	onLockAspectChange,
}: OverlaySettingsPanelProps) {
	const border = greyColor(25);
	const labelColor = greyColor(50);
	const defColor = greyColor(80);
	const btnBg = greyColor(20);
	const btnActiveBg = greyColor(38);
	const btnBorder = greyColor(28);
	const btnActiveBorder = greyColor(55);
	const numInputBg = greyColor(20);
	const numInputBorder = greyColor(30);

	const { bgWidth, bgHeight, posX, posY, scaleW, scaleH, rotation } = settings;
	const activePreset = detectActivePreset(settings);

	const handlePreset = (id: PresetId) => {
		onChange(applyPreset(id, settings));
	};

	const numInputStyle: React.CSSProperties = {
		width: '100%',
		fontSize: 11,
		fontFamily: 'monospace',
		textAlign: 'center',
		backgroundColor: numInputBg,
		color: defColor,
		border: `1px solid ${numInputBorder}`,
		borderRadius: 3,
		padding: '3px 6px',
		outline: 'none',
		boxSizing: 'border-box',
	};

	const selectFile = (cb: (path: string) => void) => {
		(window as any).electronAPI
			.invoke('selectFiles', {
				multiSelect: false,
				filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mts', 'png', 'jpg', 'jpeg', 'gif', 'webp'] }],
			})
			.then((paths: string[]) => { if (paths?.length > 0) cb(paths[0]); })
			.catch(() => {});
	};

	return (
		<Box
			className='nodrag'
			sx={{
				width,
				minWidth: width,
				maxWidth: width,
				backgroundColor: greyColor(15),
				borderLeft: `1px solid ${border}`,
				display: 'flex',
				flexDirection: 'column',
				overflowY: 'auto',
				overflowX: 'hidden',
				flexShrink: 0,
			}}
		>
			{/* ══ Preview Files ═════════════════════════════════════════════════ */}
			<Box sx={{ p: 1.5, pb: 1 }}>
				<SectionLabel>Preview Files</SectionLabel>

				<Box sx={{ mb: 0.5 }}>
					<FilePickerButton
						filePath={fgFilePath}
						onClick={() => selectFile(onFgFile)}
						tooltipTitle='Выбрать FG файл для предпросмотра (не идёт в обработку)'
					>
						FG: {fgFilePath ? fileBasename(fgFilePath) : 'Set Foreground...'}
					</FilePickerButton>
				</Box>

				<FilePickerButton
					filePath={bgFilePath}
					onClick={() => selectFile(onBgFile)}
					tooltipTitle='Выбрать BG файл для предпросмотра (не идёт в обработку)'
				>
					BG: {bgFilePath ? fileBasename(bgFilePath) : 'Set Background...'}
				</FilePickerButton>
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ══ BG Canvas Size ════════════════════════════════════════════════ */}
			<Box sx={{ p: 1.5, pb: 1 }}>
				<SectionLabel>BG Canvas Size</SectionLabel>
				<Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
					<NumInput value={bgWidth} min={1} integer onChange={(v) => onChange({ ...settings, bgWidth: v })} style={numInputStyle} />
					<Typography sx={{ fontSize: 11, color: labelColor, flexShrink: 0 }}>×</Typography>
					<NumInput value={bgHeight} min={1} integer onChange={(v) => onChange({ ...settings, bgHeight: v })} style={numInputStyle} />
				</Box>
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ══ Position Preset (3×3) ═════════════════════════════════════════ */}
			<Box sx={{ p: 1.5, pb: 1 }}>
				<SectionLabel>Position Preset</SectionLabel>
				<Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
					{PRESETS_9.map(({ id, symbol }) => {
						const isActive = activePreset === id;
						return (
							<Box
								key={id}
								onClick={() => handlePreset(id)}
								sx={{
									height: 30,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									cursor: 'pointer',
									fontSize: 16,
									borderRadius: '3px',
									border: `1px solid ${isActive ? btnActiveBorder : btnBorder}`,
									backgroundColor: isActive ? btnActiveBg : btnBg,
									color: isActive ? defColor : labelColor,
									userSelect: 'none',
									transition: 'background-color 0.1s, border-color 0.1s',
									'&:hover': {
										backgroundColor: isActive ? btnActiveBg : greyColor(28),
										borderColor: defColor,
										color: defColor,
									},
								}}
							>
								{symbol}
							</Box>
						);
					})}
				</Box>
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ══ FG Transform ══════════════════════════════════════════════════ */}
			<Box sx={{ p: 1.5 }}>
				<SectionLabel>FG Transform</SectionLabel>

				<PanelSlider
					label='X'
					value={posX}
					min={-bgWidth}
					max={bgWidth * 2}
					step={0.01}
					onChange={(v) => onChange({ ...settings, posX: v })}
				/>
				<PanelSlider
					label='Y'
					value={posY}
					min={-bgHeight}
					max={bgHeight * 2}
					step={0.01}
					onChange={(v) => onChange({ ...settings, posY: v })}
				/>
				<CheckboxRow
					label='Lock Aspect'
					checked={lockAspect}
					onChange={onLockAspectChange}
				/>
				<PanelSlider
					label='W'
					value={scaleW}
					min={1}
					max={bgWidth * 3}
					step={1}
					onChange={(v) => {
						const newW = Math.max(1, Math.round(v));
						if (lockAspect && scaleW > 0) {
							const newH = Math.max(1, Math.round(newW * (scaleH / scaleW)));
							onChange({ ...settings, scaleW: newW, scaleH: newH });
						} else {
							onChange({ ...settings, scaleW: newW });
						}
					}}
				/>
				<PanelSlider
					label='H'
					value={scaleH}
					min={1}
					max={bgHeight * 3}
					step={1}
					onChange={(v) => {
						const newH = Math.max(1, Math.round(v));
						if (lockAspect && scaleH > 0) {
							const newW = Math.max(1, Math.round(newH * (scaleW / scaleH)));
							onChange({ ...settings, scaleH: newH, scaleW: newW });
						} else {
							onChange({ ...settings, scaleH: newH });
						}
					}}
				/>
				<PanelSlider
					label='Rotation°'
					value={rotation}
					min={-180}
					max={180}
					step={0.1}
					onChange={(v) => onChange({ ...settings, rotation: v })}
				/>
			</Box>
		</Box>
	);
}

export default memo(OverlaySettingsPanel);
