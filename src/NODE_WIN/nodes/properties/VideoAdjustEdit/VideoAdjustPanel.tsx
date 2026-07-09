// src/NODE_WIN/nodes/properties/VideoAdjustEdit/VideoAdjustPanel.tsx
//
// Right settings panel. Three sections:
//   1. File & Format — FG/BG file selection, final format
//   2. FG Layer — copies, fitPercent, drop shadow
//   3. BG Layer — copies, blur/brightness/contrast/saturation/hFlip

import { memo } from 'react';
import { commands, unwrap } from '@/Utils/specta';
import { Box, Divider, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import PanelSlider from '../PanelSlider';
import { MyPopoverColor } from '@/MAIN_WIN/Universal/MyPopoverColor';
import { SectionLabel, CheckboxRow, FilePickerButton } from '../PanelUI';
import { VideoAdjustSettings, defaultFgShadow } from './types';
import EncodeSettingsPanel from '../EncodeSettingsPanel';
import { defaultEncodeSettings } from '@/Utils/ffmpegCaps';
import { NumInput } from '@/components/NumInput';

function fileBasename(p: string): string {
	return p.split(/[/\\]/).pop() ?? p;
}

interface VideoAdjustPanelProps {
	settings: VideoAdjustSettings;
	onChange: (s: VideoAdjustSettings) => void;
	width: number;
	fgFilePath: string;
	bgFilePath: string;
	onFgFile: (p: string) => void;
	onBgFile: (p: string) => void;
}

function VideoAdjustPanel({ settings, onChange, width, fgFilePath, bgFilePath, onFgFile, onBgFile }: VideoAdjustPanelProps) {
	const border = greyColor(25);
	const labelColor = greyColor(50);
	const defColor = greyColor(80);
	const numBg = greyColor(20);
	const numBorder = greyColor(30);

	const selectFile = (cb: (path: string) => void) => {
		commands
			.selectFiles({
				multiSelect: false,
				filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mts', 'png', 'jpg', 'jpeg', 'gif', 'webp'] }],
			})
			.then((r) => { const paths = unwrap(r); if (paths?.length > 0) cb(paths[0]); })
			.catch(() => {});
	};

	const { finalFormat, autoFormat, useFgAsBg, fg, bg: bgS } = settings;
	const shadow = fg.shadow ?? defaultFgShadow();
	const [fw, fh] = finalFormat;

	const numInputStyle: React.CSSProperties = {
		width: '100%',
		fontSize: 11,
		fontFamily: 'monospace',
		textAlign: 'center',
		backgroundColor: numBg,
		color: defColor,
		border: `1px solid ${numBorder}`,
		borderRadius: 3,
		padding: '3px 6px',
		outline: 'none',
		boxSizing: 'border-box',
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
			{/* ══ File & Format ═════════════════════════════════════════════════ */}
			<Box sx={{ p: 1.5, pb: 1 }}>
				<SectionLabel>File &amp; Format</SectionLabel>

				{/* FG file */}
				<Box sx={{ mb: 0.5 }}>
					<FilePickerButton filePath={fgFilePath} onClick={() => selectFile(onFgFile)} tooltipTitle='Выбрать FG видео для превью'>
						FG: {fgFilePath ? fileBasename(fgFilePath) : 'Select FG file…'}
					</FilePickerButton>
				</Box>

				{/* Use FG as BG */}
				<CheckboxRow
					label='Use FG as Background'
					checked={useFgAsBg}
					onChange={() => onChange({ ...settings, useFgAsBg: !useFgAsBg })}
				/>

				{/* BG file */}
				<FilePickerButton
					filePath={bgFilePath}
					onClick={() => selectFile(onBgFile)}
					disabled={useFgAsBg}
					tooltipTitle={useFgAsBg ? 'Отключён: используется FG-файл' : 'Выбрать BG видео для превью'}
				>
					BG: {!useFgAsBg && bgFilePath ? fileBasename(bgFilePath) : useFgAsBg ? '← same as FG' : 'Select BG file…'}
				</FilePickerButton>

				{/* BG color fill — when no file and not useFgAsBg */}
				{!useFgAsBg && !bgFilePath && (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
						<Typography sx={{ fontSize: 11, color: labelColor, flexShrink: 0 }}>BG Color</Typography>
						<MyPopoverColor color={settings.bgColor || '#000000'} onChange={(c) => onChange({ ...settings, bgColor: c })} size={22} />
						<Typography sx={{ fontSize: 10, color: labelColor, fontFamily: 'monospace' }}>{settings.bgColor || '#000000'}</Typography>
					</Box>
				)}

				{/* Final format */}
				<Box sx={{ mt: 1 }}>
					<CheckboxRow
						label='Auto (opposite format)'
						checked={autoFormat ?? true}
						onChange={() => onChange({ ...settings, autoFormat: !autoFormat })}
					/>

					<Typography sx={{ fontSize: 10, color: labelColor, mb: 0.5 }}>
						Final Format (px){(autoFormat ?? true) ? ' — auto' : ''}
					</Typography>
					<Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
						<NumInput
							value={fw}
							min={1}
							integer
							disabled={autoFormat ?? true}
							style={{ ...numInputStyle, opacity: (autoFormat ?? true) ? 0.4 : 1 }}
							onChange={(v) => onChange({ ...settings, finalFormat: [v, fh] })}
						/>
						<Typography sx={{ fontSize: 11, color: labelColor, flexShrink: 0 }}>×</Typography>
						<NumInput
							value={fh}
							min={1}
							integer
							disabled={autoFormat ?? true}
							style={{ ...numInputStyle, opacity: (autoFormat ?? true) ? 0.4 : 1 }}
							onChange={(v) => onChange({ ...settings, finalFormat: [fw, v] })}
						/>
					</Box>
				</Box>
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ══ FG Layer ══════════════════════════════════════════════════════ */}
			<Box sx={{ p: 1.5, pb: 1 }}>
				<SectionLabel>FG Layer</SectionLabel>

				<PanelSlider
					label='Copies'
					value={fg.copies}
					min={1}
					max={5}
					step={1}
					onChange={(v) => onChange({ ...settings, fg: { ...fg, copies: Math.round(v) } })}
				/>
				<PanelSlider
					label='Fill %'
					value={fg.fitPercent}
					min={0}
					max={100}
					step={1}
					onChange={(v) => onChange({ ...settings, fg: { ...fg, fitPercent: Math.round(v) } })}
				/>
				<Typography sx={{ fontSize: 10, color: labelColor, mt: -0.5, mb: 0.5 }}>0 = fit (bars visible) · 100 = fill (crop)</Typography>

				<Divider sx={{ borderColor: border, my: 1 }} />

				<Typography sx={{ fontSize: 10, color: labelColor, mb: 0.8 }}>Drop Shadow</Typography>

				<CheckboxRow
					label='Enable Shadow'
					checked={shadow.enabled}
					onChange={() => onChange({ ...settings, fg: { ...fg, shadow: { ...shadow, enabled: !shadow.enabled } } })}
				/>

				{shadow.enabled && (
					<>
						<PanelSlider
							label='Blur (px)'
							value={shadow.blur}
							min={0}
							max={60}
							step={1}
							noClamp
							onChange={(v) => onChange({ ...settings, fg: { ...fg, shadow: { ...shadow, blur: Math.max(0, v) } } })}
						/>
						<PanelSlider
							label='Offset X'
							value={shadow.offsetX}
							min={-100}
							max={100}
							step={1}
							noClamp
							onChange={(v) => onChange({ ...settings, fg: { ...fg, shadow: { ...shadow, offsetX: Math.round(v) } } })}
						/>
						<PanelSlider
							label='Offset Y'
							value={shadow.offsetY}
							min={-100}
							max={100}
							step={1}
							noClamp
							onChange={(v) => onChange({ ...settings, fg: { ...fg, shadow: { ...shadow, offsetY: Math.round(v) } } })}
						/>
						<PanelSlider
							label='Opacity'
							value={shadow.opacity}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => onChange({ ...settings, fg: { ...fg, shadow: { ...shadow, opacity: parseFloat(v.toFixed(2)) } } })}
						/>
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
							<Typography sx={{ fontSize: 11, color: labelColor, flexShrink: 0 }}>Color</Typography>
							<MyPopoverColor
								color={shadow.color || '#000000'}
								onChange={(c) => onChange({ ...settings, fg: { ...fg, shadow: { ...shadow, color: c } } })}
								size={22}
							/>
							<Typography sx={{ fontSize: 10, color: labelColor, fontFamily: 'monospace' }}>{shadow.color || '#000000'}</Typography>
						</Box>
					</>
				)}
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ══ BG Layer ══════════════════════════════════════════════════════ */}
			<Box sx={{ p: 1.5 }}>
				<SectionLabel>BG Layer</SectionLabel>

				<PanelSlider
					label='Copies'
					value={bgS.copies}
					min={1}
					max={5}
					step={1}
					onChange={(v) => onChange({ ...settings, bg: { ...bgS, copies: Math.round(v) } })}
				/>

				<Divider sx={{ borderColor: border, my: 1 }} />

				<Typography sx={{ fontSize: 10, color: labelColor, mb: 0.8 }}>Adjustments</Typography>

				<PanelSlider
					label='Blur (px)'
					value={bgS.adjust.blur}
					min={0}
					max={50}
					step={0.5}
					onChange={(v) => onChange({ ...settings, bg: { ...bgS, adjust: { ...bgS.adjust, blur: v } } })}
				/>
				<PanelSlider
					label='Brightness'
					value={bgS.adjust.brightness}
					min={-1}
					max={1}
					step={0.01}
					onChange={(v) => onChange({ ...settings, bg: { ...bgS, adjust: { ...bgS.adjust, brightness: parseFloat(v.toFixed(2)) } } })}
				/>
				<PanelSlider
					label='Contrast'
					value={bgS.adjust.contrast}
					min={0}
					max={3}
					step={0.01}
					onChange={(v) => onChange({ ...settings, bg: { ...bgS, adjust: { ...bgS.adjust, contrast: parseFloat(v.toFixed(2)) } } })}
				/>
				<PanelSlider
					label='Saturation'
					value={bgS.adjust.saturation}
					min={0}
					max={3}
					step={0.01}
					onChange={(v) => onChange({ ...settings, bg: { ...bgS, adjust: { ...bgS.adjust, saturation: parseFloat(v.toFixed(2)) } } })}
				/>

				<CheckboxRow
					label='Horizontal Flip'
					checked={bgS.adjust.hFlip}
					onChange={() => onChange({ ...settings, bg: { ...bgS, adjust: { ...bgS.adjust, hFlip: !bgS.adjust.hFlip } } })}
					mb={0}
				/>
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ── Output / Render ── */}
			<Box sx={{ p: 1.5, pb: 1.5 }}>
				<SectionLabel>Output / Render</SectionLabel>
				<EncodeSettingsPanel value={settings.encode ?? defaultEncodeSettings()} onChange={(e) => onChange({ ...settings, encode: e })} />
			</Box>
		</Box>
	);
}

export default memo(VideoAdjustPanel);
