// src/NODE_WIN/nodes/properties/KeyingEdit/KeyingPanel.tsx

import { memo, useRef, useCallback } from 'react';
import { Box, Divider, Tooltip, Typography } from '@mui/material';
import { Pipette } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import PanelSlider from '../PanelSlider';
import { MyPopoverColor } from '@/MAIN_WIN/Universal/MyPopoverColor';
import { SectionLabel, CheckboxRow, FilePickerButton } from '../PanelUI';
import { KeyingSettings } from './types';
import { type PixelInfo } from './KeyingPreview';

function fileBasename(p: string): string {
	return p.split(/[/\\]/).pop() ?? p;
}

interface KeyingPanelProps {
	settings: KeyingSettings;
	onChange: (s: KeyingSettings) => void;
	width: number;
	filePath: string;
	onSelectFile: (p: string) => void;
	onEyedropperStart: (target: 'chromakey' | 'colorkey' | 'despill') => void;
	hoveredPixel?: PixelInfo | null;
}

function KeyingPanel({ settings, onChange, width, filePath, onSelectFile, onEyedropperStart, hoveredPixel }: KeyingPanelProps) {
	const border = greyColor(25);
	const labelColor = greyColor(50);
	const defColor = greyColor(80);
	const btnBg = greyColor(20);
	const btnActiveBg = greyColor(38);

	const settingsRef = useRef(settings);
	settingsRef.current = settings;

	// Native Tauri file dialog — returns an absolute path. A web <input type=file>
	// can't: in WKWebView the File object has no `.path`, so the preview would get a
	// bare filename and fail to load. Mirrors VideoAdjustPanel.
	const selectPreviewFile = useCallback(() => {
		(window as any).electronAPI
			.invoke('selectFiles', {
				multiSelect: false,
				filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mts', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'] }],
			})
			.then((paths: string[]) => { if (paths?.length > 0) onSelectFile(paths[0]); })
			.catch(() => {});
	}, [onSelectFile]);

	const { chromakey, colorkey, lumakey, despill, edge } = settings;

	const onChromakeyColorChange = useCallback(
		(c: string) => {
			const s = settingsRef.current;
			onChange({ ...s, chromakey: { ...s.chromakey, color: c } });
		},
		[onChange],
	);

	const onColorkeyColorChange = useCallback(
		(c: string) => {
			const s = settingsRef.current;
			onChange({ ...s, colorkey: { ...s.colorkey, color: c } });
		},
		[onChange],
	);

	const onDespillColorChange = useCallback(
		(c: string) => {
			const s = settingsRef.current;
			onChange({ ...s, despill: { ...s.despill, color: c } });
		},
		[onChange],
	);

	// Eyedropper color row is Keying-specific — kept inline
	const renderColorRow = (currentColor: string, onColorChange: (c: string) => void, eyedropperTarget: 'chromakey' | 'colorkey' | 'despill') => (
		<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
			<Typography sx={{ fontSize: 11, color: labelColor, flexShrink: 0 }}>Color</Typography>
			<MyPopoverColor color={currentColor} onChange={onColorChange} size={22} />
			<Typography sx={{ fontSize: 10, color: labelColor, fontFamily: 'monospace' }}>{currentColor}</Typography>
			<Tooltip title='Pick color from preview' placement='top'>
				<Box
					component='button'
					onClick={() => onEyedropperStart(eyedropperTarget)}
					sx={{
						ml: 'auto',
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: 24,
						height: 24,
						borderRadius: '4px',
						border: `1px solid ${border}`,
						backgroundColor: btnBg,
						color: labelColor,
						cursor: 'pointer',
						'&:hover': { backgroundColor: btnActiveBg, color: defColor },
					}}
				>
					<Pipette size={13} />
				</Box>
			</Tooltip>
		</Box>
	);

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
			{/* ══ FILE ══════════════════════════════════════════════════════════ */}
			<Box sx={{ p: 1.5, pb: 1 }}>
				<SectionLabel>File</SectionLabel>

				<FilePickerButton filePath={filePath} onClick={selectPreviewFile} tooltipTitle='Select video/image for keying preview'>
					{filePath ? fileBasename(filePath) : 'Select file...'}
				</FilePickerButton>
			</Box>

			{/* ── RGBA info — updates on hover over keyed preview ────────────── */}
			<Box
				sx={{
					mx: 1.5,
					mb: 1,
					px: 1,
					py: 0.6,
					borderRadius: '4px',
					backgroundColor: greyColor(10),
					border: `1px solid ${border}`,
					display: 'flex',
					alignItems: 'center',
					gap: 0.5,
					minHeight: 26,
				}}
			>
				{hoveredPixel ? (
					<>
						<Box
							sx={{
								width: 14,
								height: 14,
								borderRadius: '2px',
								flexShrink: 0,
								backgroundColor: `rgba(${hoveredPixel.r},${hoveredPixel.g},${hoveredPixel.b},1)`,
								border: `1px solid ${greyColor(35)}`,
							}}
						/>
						{[
							{ label: 'R', value: hoveredPixel.r, color: '#e06c75' },
							{ label: 'G', value: hoveredPixel.g, color: '#98c379' },
							{ label: 'B', value: hoveredPixel.b, color: '#61afef' },
							{ label: 'A', value: hoveredPixel.a, color: '#c678dd' },
						].map(({ label, value, color }) => (
							<Box key={label} sx={{ display: 'flex', alignItems: 'baseline', gap: '2px' }}>
								<Typography sx={{ fontSize: 9, color, fontFamily: 'monospace', lineHeight: 1 }}>{label}</Typography>
								<Typography sx={{ fontSize: 10, color: greyColor(80), fontFamily: 'monospace', lineHeight: 1, minWidth: 24, textAlign: 'right' }}>
									{value}
								</Typography>
							</Box>
						))}
						<Typography sx={{ fontSize: 9, color: greyColor(45), fontFamily: 'monospace', ml: 0.5 }}>
							{Math.round((hoveredPixel.a / 255) * 100)}%α
						</Typography>
					</>
				) : (
					<Typography sx={{ fontSize: 10, color: greyColor(30), fontFamily: 'monospace' }}>hover keying preview → RGBA</Typography>
				)}
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ══ CHROMAKEY ═════════════════════════════════════════════════════ */}
			<Box sx={{ p: 1.5, pb: 1 }}>
				<CheckboxRow
					label='Chromakey'
					checked={chromakey.enabled}
					onChange={() => onChange({ ...settings, chromakey: { ...chromakey, enabled: !chromakey.enabled } })}
					accentColor='#4caf50'
				/>

				{chromakey.enabled && (
					<>
						{renderColorRow(chromakey.color, onChromakeyColorChange, 'chromakey')}
						<PanelSlider
							label='Similarity'
							value={chromakey.similarity}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => {
								const s = settingsRef.current;
								onChange({ ...s, chromakey: { ...s.chromakey, similarity: parseFloat(v.toFixed(2)) } });
							}}
						/>
						<PanelSlider
							label='Blend'
							value={chromakey.blend}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => {
								const s = settingsRef.current;
								onChange({ ...s, chromakey: { ...s.chromakey, blend: parseFloat(v.toFixed(2)) } });
							}}
						/>
						<CheckboxRow
							label='YUV color space'
							checked={chromakey.yuv}
							onChange={() => onChange({ ...settings, chromakey: { ...chromakey, yuv: !chromakey.yuv } })}
						/>
					</>
				)}
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ══ COLORKEY ══════════════════════════════════════════════════════ */}
			<Box sx={{ p: 1.5, pb: 1 }}>
				<CheckboxRow
					label='Colorkey'
					checked={colorkey.enabled}
					onChange={() => onChange({ ...settings, colorkey: { ...colorkey, enabled: !colorkey.enabled } })}
					accentColor='#ff9800'
				/>

				{colorkey.enabled && (
					<>
						{renderColorRow(colorkey.color, onColorkeyColorChange, 'colorkey')}
						<PanelSlider
							label='Similarity'
							value={colorkey.similarity}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => {
								const s = settingsRef.current;
								onChange({ ...s, colorkey: { ...s.colorkey, similarity: parseFloat(v.toFixed(2)) } });
							}}
						/>
						<PanelSlider
							label='Blend'
							value={colorkey.blend}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => {
								const s = settingsRef.current;
								onChange({ ...s, colorkey: { ...s.colorkey, blend: parseFloat(v.toFixed(2)) } });
							}}
						/>
					</>
				)}
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ══ LUMAKEY ═══════════════════════════════════════════════════════ */}
			<Box sx={{ p: 1.5, pb: 1 }}>
				<CheckboxRow
					label='Lumakey'
					checked={lumakey.enabled}
					onChange={() => onChange({ ...settings, lumakey: { ...lumakey, enabled: !lumakey.enabled } })}
					accentColor='#9c27b0'
				/>

				{lumakey.enabled && (
					<>
						<PanelSlider
							label='Threshold'
							value={lumakey.threshold}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => {
								const s = settingsRef.current;
								onChange({ ...s, lumakey: { ...s.lumakey, threshold: parseFloat(v.toFixed(2)) } });
							}}
						/>
						<PanelSlider
							label='Tolerance'
							value={lumakey.tolerance}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => {
								const s = settingsRef.current;
								onChange({ ...s, lumakey: { ...s.lumakey, tolerance: parseFloat(v.toFixed(2)) } });
							}}
						/>
						<PanelSlider
							label='Softness'
							value={lumakey.softness}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => {
								const s = settingsRef.current;
								onChange({ ...s, lumakey: { ...s.lumakey, softness: parseFloat(v.toFixed(2)) } });
							}}
						/>
					</>
				)}
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ══ DESPILL ═══════════════════════════════════════════════════════ */}
			<Box sx={{ p: 1.5, pb: 1 }}>
				<CheckboxRow
					label='Despill'
					checked={despill.enabled}
					onChange={() => onChange({ ...settings, despill: { ...despill, enabled: !despill.enabled } })}
					accentColor='#00bcd4'
				/>

				{despill.enabled && (
					<>
						{renderColorRow(despill.color, onDespillColorChange, 'despill')}
						<PanelSlider
							label='Mix'
							value={despill.mix}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => {
								const s = settingsRef.current;
								onChange({ ...s, despill: { ...s.despill, mix: parseFloat(v.toFixed(2)) } });
							}}
						/>
						<PanelSlider
							label='Expand'
							value={despill.expand}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => {
								const s = settingsRef.current;
								onChange({ ...s, despill: { ...s.despill, expand: parseFloat(v.toFixed(2)) } });
							}}
						/>
						<PanelSlider
							label='Brightness'
							value={despill.brightness}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => {
								const s = settingsRef.current;
								onChange({ ...s, despill: { ...s.despill, brightness: parseFloat(v.toFixed(2)) } });
							}}
						/>
					</>
				)}
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ══ EDGE REFINEMENT ═══════════════════════════════════════════════ */}
			<Box sx={{ p: 1.5 }}>
				<SectionLabel>Edge Refinement</SectionLabel>

				<PanelSlider
					label='Erosion'
					value={edge.erosion}
					min={0}
					max={5}
					step={1}
					onChange={(v) => {
						const s = settingsRef.current;
						onChange({ ...s, edge: { ...s.edge, erosion: Math.round(v) } });
					}}
				/>
				<PanelSlider
					label='Dilation'
					value={edge.dilation}
					min={0}
					max={5}
					step={1}
					onChange={(v) => {
						const s = settingsRef.current;
						onChange({ ...s, edge: { ...s.edge, dilation: Math.round(v) } });
					}}
				/>
				<PanelSlider
					label='Edge Blur'
					value={edge.blur}
					min={0}
					max={3}
					step={0.1}
					onChange={(v) => {
						const s = settingsRef.current;
						onChange({ ...s, edge: { ...s.edge, blur: parseFloat(v.toFixed(1)) } });
					}}
				/>
			</Box>
		</Box>
	);
}

export default memo(KeyingPanel);
