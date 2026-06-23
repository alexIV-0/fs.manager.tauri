// src/NODE_WIN/nodes/properties/ConvertEdit/ConvertPanel.tsx

import { memo, useRef, useCallback, useState, useEffect } from 'react';
import { commands, unwrap } from '@/Utils/specta';
import { Box, Button, Checkbox, Divider, MenuItem, Select, Tooltip, Typography } from '@mui/material';
import { FolderOpen, X as XIcon } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import { MyPopoverColor } from '@/MAIN_WIN/Universal/MyPopoverColor';
import PanelSlider from '../PanelSlider';
import {
	ConvertSettings,
	FrameSettings,
	ImageConvertSettings,
	VideoConvertSettings,
	AudioConvertSettings,
	VideoFilterItem,
	AudioFilterItem,
	ImageFilterItem,
	VideoFilterType,
	AudioFilterType,
	VideoCodec,
	AudioCodec,
	FALLBACK_IMAGE_FORMATS,
	FALLBACK_VIDEO_CONTAINERS,
	VIDEO_CODECS,
	VIDEO_PRESETS,
	AUDIO_CODECS,
	AUDIO_BITRATES,
	AUDIO_SAMPLE_RATES,
	PIXEL_FORMATS,
	VIDEO_FILTER_LABELS,
	IMAGE_FILTER_LABELS,
	AUDIO_FILTER_LABELS,
	defaultVideoFilter,
	defaultAudioFilter,
} from './types';
import { alphaAvailable, pixFmtsFor, type VideoCodecId } from '@/Utils/ffmpegCaps';
import { CONVERT_THEME_FULL, type ConvertTheme } from './convertThemes';

// ─────────────────────────────────────────────────────────────────────────────
// Codec capability maps
// ─────────────────────────────────────────────────────────────────────────────

const PRESET_CODECS = new Set(['h264', 'h265', 'av1']);
const CRF_CODECS = new Set(['h264', 'h265', 'vp9', 'av1']);

function crfMax(codec: string): number {
	return codec === 'vp9' ? 63 : 51;
}

// ── Format ↔ Codec compatibility ────────────────────────────────────────────

const VIDEO_CODECS_FOR_CONTAINER: Record<string, readonly VideoCodec[]> = {
	mp4: ['h264', 'h265', 'av1', 'copy'],
	mkv: ['h264', 'h265', 'vp9', 'av1', 'copy'],
	avi: ['h264', 'h265', 'copy'],
	mov: ['h264', 'h265', 'prores', 'dnxhd', 'hap', 'hap_q', 'copy'],
	webm: ['vp9', 'av1', 'copy'],
	mxf: ['dnxhd', 'h264', 'copy'],
	ts: ['h264', 'h265', 'copy'],
};

const DEFAULT_VIDEO_CODEC_FOR_CONTAINER: Record<string, VideoCodec> = {
	mp4: 'h264',
	mkv: 'h264',
	avi: 'h264',
	mov: 'h264',
	webm: 'vp9',
	mxf: 'dnxhd',
	ts: 'h264',
};

const AUDIO_CODECS_FOR_EXT: Record<string, readonly AudioCodec[]> = {
	mp3: ['mp3', 'copy'],
	aac: ['aac', 'copy'],
	m4a: ['aac', 'copy'],
	flac: ['flac', 'copy'],
	wav: ['pcm_s16le', 'copy'],
	opus: ['opus', 'copy'],
	ogg: ['opus', 'flac', 'copy'],
};

const DEFAULT_AUDIO_CODEC_FOR_EXT: Record<string, AudioCodec> = {
	mp3: 'mp3',
	aac: 'aac',
	m4a: 'aac',
	flac: 'flac',
	wav: 'pcm_s16le',
	opus: 'opus',
	ogg: 'opus',
};

function codecLabel(c: string): string {
	const map: Record<string, string> = {
		h264: 'H.264 (libx264)',
		h265: 'H.265 / HEVC (libx265)',
		vp9: 'VP9 (libvpx-vp9)',
		av1: 'AV1 (libsvtav1)',
		prores: 'ProRes (prores_ks)',
		dnxhd: 'DNxHD',
		hap: 'Hap (alpha)',
		hap_q: 'Hap Q (alpha, high quality)',
		copy: 'Copy (stream copy)',
	};
	return map[c] ?? c;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fileBasename(p: string): string {
	return p.split(/[/\\]/).pop() ?? p;
}

/** Возвращает подмножество labels, разрешённое темой (allowed=undefined → все). */
function pickLabels<T extends string>(labels: Record<T, string>, allowed?: readonly string[]): Record<T, string> {
	if (!allowed) return labels;
	const out = {} as Record<T, string>;
	(Object.keys(labels) as T[]).forEach((k) => {
		if (allowed.includes(k)) out[k] = labels[k];
	});
	return out;
}

function ParamRow({ label, children }: { label: string; children: React.ReactNode }) {
	const lc = greyColor(50);
	return (
		<Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75, gap: 0.75 }}>
			<Typography sx={{ fontSize: 11, color: lc, flexShrink: 0, minWidth: 72 }}>{label}</Typography>
			<Box sx={{ flex: 1 }}>{children}</Box>
		</Box>
	);
}

function StyledSelect<T extends string | number>({
	value,
	onChange,
	options,
	getLabel,
}: {
	value: T;
	onChange: (v: T) => void;
	options: readonly T[];
	getLabel?: (v: T) => string;
}) {
	const bg = greyColor(20);
	const border = greyColor(30);
	const color = greyColor(80);
	const menuBg = greyColor(18);
	return (
		<Select
			size='small'
			value={value}
			onChange={(e) => onChange(e.target.value as T)}
			sx={{
				fontSize: 11,
				backgroundColor: bg,
				color,
				'& .MuiOutlinedInput-notchedOutline': { borderColor: border },
				'& .MuiSvgIcon-root': { color },
				'& .MuiSelect-select': { py: '3px', px: '8px' },
				width: '100%',
			}}
			MenuProps={{ sx: { zIndex: 10000 }, PaperProps: { sx: { backgroundColor: menuBg, color } } }}
		>
			{options.map((opt) => (
				<MenuItem key={String(opt)} value={opt} sx={{ fontSize: 11, py: 0.4 }}>
					{getLabel ? getLabel(opt) : String(opt)}
				</MenuItem>
			))}
		</Select>
	);
}

function NumberInput({
	value,
	min,
	max,
	step = 1,
	onChange,
	suffix,
}: {
	value: number;
	min: number;
	max: number;
	step?: number;
	onChange: (v: number) => void;
	suffix?: string;
}) {
	const [local, setLocal] = useState(String(value));

	useEffect(() => {
		setLocal(String(value));
	}, [value]);

	const commit = () => {
		const v = parseFloat(local);
		if (!isNaN(v)) {
			const clamped = Math.min(max, Math.max(min, v));
			onChange(clamped);
			setLocal(String(clamped));
		} else {
			setLocal(String(value));
		}
	};

	const bg = greyColor(20);
	const border = greyColor(30);
	const color = greyColor(80);
	return (
		<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
			<input
				type='text'
				inputMode='decimal'
				value={local}
				onChange={(e) => setLocal(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
				style={{
					flex: 1,
					fontSize: 11,
					fontFamily: 'monospace',
					backgroundColor: bg,
					color,
					border: `1px solid ${border}`,
					borderRadius: 3,
					padding: '3px 6px',
					outline: 'none',
					boxSizing: 'border-box',
				}}
			/>
			{suffix && <Typography sx={{ fontSize: 11, color: greyColor(40), flexShrink: 0 }}>{suffix}</Typography>}
		</Box>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Output frame block
// ─────────────────────────────────────────────────────────────────────────────

function FrameBlock({
	frame,
	sourceW,
	sourceH,
	onChange,
}: {
	frame: FrameSettings;
	sourceW?: number;
	sourceH?: number;
	onChange: (f: FrameSettings) => void;
}) {
	const bg = greyColor(12);
	const border = greyColor(22);
	const label = greyColor(50);
	const defC = greyColor(80);

	const lockAspect = frame.lockAspect;

	const setW = (v: number) =>
		onChange({
			...frame,
			width: v,
			height: lockAspect && frame.width > 0 ? Math.round((v / frame.width) * frame.height) : frame.height,
		});
	const setH = (v: number) =>
		onChange({
			...frame,
			height: v,
			width: lockAspect && frame.height > 0 ? Math.round((v / frame.height) * frame.width) : frame.width,
		});

	return (
		<Box sx={{ mb: 1.25, border: `1px solid ${border}`, borderRadius: '4px', backgroundColor: bg, overflow: 'hidden' }}>
			{/* Header row */}
			<Box sx={{ px: 1, py: 0.5, borderBottom: frame.mode === 'fixed' ? `1px solid ${border}` : 'none', display: 'flex', alignItems: 'center', gap: 0.75 }}>
				<Typography sx={{ fontSize: 11, color: label, flexShrink: 0, minWidth: 72 }}>Frame size</Typography>
				<Box sx={{ display: 'flex', gap: 0.4 }}>
					{(['original', 'fixed'] as const).map((m) => {
						const isActive = frame.mode === m;
						return (
							<Box
								key={m}
								component='button'
								onClick={() => onChange({ ...frame, mode: m })}
								sx={{
									fontSize: 10,
									px: '6px',
									py: '2px',
									borderRadius: '3px',
									border: `1px solid ${isActive ? greyColor(55) : greyColor(28)}`,
									backgroundColor: isActive ? greyColor(38) : greyColor(20),
									color: isActive ? defC : label,
									cursor: 'pointer',
									whiteSpace: 'nowrap',
									'&:hover': { color: defC, borderColor: greyColor(55) },
								}}
							>
								{m === 'original' ? 'Original' : 'Fixed size'}
							</Box>
						);
					})}
				</Box>
			</Box>

			{frame.mode === 'fixed' && (
				<Box sx={{ px: 1.5, pt: 0.75, pb: 0.75 }}>
					{/* Aspect ratio presets */}
					<Box sx={{ display: 'flex', gap: 0.5, mb: 0.75 }}>
						{([
							{ lbl: '16:9', w: 1920, h: 1080 },
							{ lbl: '9:16', w: 1080, h: 1920 },
							{ lbl: '1:1',  w: 1080, h: 1080 },
						] as const).map(({ lbl, w, h }) => (
							<Box
								key={lbl}
								component='button'
								onClick={() => onChange({ ...frame, width: w, height: h })}
								sx={{
									fontSize: 10,
									px: '6px',
									py: '2px',
									borderRadius: '3px',
									border: `1px solid ${greyColor(30)}`,
									backgroundColor: greyColor(20),
									color: label,
									cursor: 'pointer',
									whiteSpace: 'nowrap',
									'&:hover': { color: defC, borderColor: greyColor(50) },
								}}
							>
								{lbl}
							</Box>
						))}
					</Box>

					{/* W and H on one row, no spinners */}
					<Box
						sx={{
							display: 'flex',
							alignItems: 'center',
							gap: 0.75,
							mb: 0.75,
							'& input[type=number]::-webkit-inner-spin-button': { display: 'none' },
							'& input[type=number]::-webkit-outer-spin-button': { display: 'none' },
							'& input[type=number]': { MozAppearance: 'textfield' },
						}}
					>
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
							<Typography sx={{ fontSize: 11, color: label }}>W</Typography>
							<Box sx={{ width: 64 }}>
								<NumberInput value={frame.width} min={2} max={9999} onChange={setW} />
							</Box>
							<Typography sx={{ fontSize: 11, color: label }}>px</Typography>
						</Box>
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, ml: 1.5 }}>
							<Typography sx={{ fontSize: 11, color: label }}>H</Typography>
							<Box sx={{ width: 64 }}>
								<NumberInput value={frame.height} min={2} max={9999} onChange={setH} />
							</Box>
							<Typography sx={{ fontSize: 11, color: label }}>px</Typography>
						</Box>
					</Box>

					{/* Lock aspect */}
					<Box
						sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
						onClick={() => onChange({ ...frame, lockAspect: !lockAspect })}
					>
						<Checkbox
							size='small'
							checked={lockAspect}
							onChange={() => {}}
							sx={{ p: 0, mr: 0.5, color: label, '&.Mui-checked': { color: defC } }}
						/>
						<Typography sx={{ fontSize: 11, color: label }}>Lock aspect ratio</Typography>
					</Box>
				</Box>
			)}
		</Box>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Video filter block
// ─────────────────────────────────────────────────────────────────────────────

function VideoFilterBlock({
	filter,
	onChange,
	onRemove,
}: {
	filter: VideoFilterItem;
	onChange: (u: VideoFilterItem) => void;
	onRemove: () => void;
}) {
	const bg = greyColor(12);
	const border = greyColor(22);
	const label = greyColor(50);
	const defC = greyColor(80);
	const btnBg = greyColor(18);
	const dimC = greyColor(35);

	const enabled = filter.enabled !== false;
	const title = VIDEO_FILTER_LABELS[filter.type] ?? filter.type;

	const toggle = () => onChange({ ...filter, enabled: !enabled } as VideoFilterItem);

	const body = () => {
		if (!enabled) return null;
		switch (filter.type) {
			case 'scale':
				return (
					<>
						<ParamRow label='Mode'>
							<StyledSelect
								value={filter.mode}
								onChange={(m) => onChange({ ...filter, mode: m })}
								options={['original', 'pct', 'fixed'] as const}
								getLabel={(m) => (m === 'original' ? 'Original' : m === 'pct' ? 'Percentage' : 'Fixed size')}
							/>
						</ParamRow>
						{filter.mode !== 'original' && (
							<>
								{filter.mode === 'pct' ? (
									<PanelSlider
										label='Width %'
										value={filter.widthPct}
										min={1}
										max={400}
										step={1}
										onChange={(v) => onChange({ ...filter, widthPct: Math.round(v) })}
									/>
								) : (
									<ParamRow label='Width px'>
										<NumberInput value={filter.fixedW} min={1} max={7680} onChange={(v) => onChange({ ...filter, fixedW: v })} />
									</ParamRow>
								)}
								{!filter.lockAspect &&
									(filter.mode === 'pct' ? (
										<PanelSlider
											label='Height %'
											value={filter.heightPct}
											min={1}
											max={400}
											step={1}
											onChange={(v) => onChange({ ...filter, heightPct: Math.round(v) })}
										/>
									) : (
										<ParamRow label='Height px'>
											<NumberInput
												value={filter.fixedH}
												min={1}
												max={7680}
												onChange={(v) => onChange({ ...filter, fixedH: v })}
											/>
										</ParamRow>
									))}
								<Box
									sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
									onClick={() => onChange({ ...filter, lockAspect: !filter.lockAspect })}
								>
									<Checkbox
										size='small'
										checked={filter.lockAspect}
										onChange={() => {}}
										sx={{ p: 0, mr: 0.5, color: label, '&.Mui-checked': { color: defC } }}
									/>
									<Typography sx={{ fontSize: 11, color: label }}>Lock aspect ratio</Typography>
								</Box>
							</>
						)}
					</>
				);
			case 'crop':
				return (
					<>
						<ParamRow label='Unit'>
							<StyledSelect
								value={filter.unit}
								onChange={(u) => onChange({ ...filter, unit: u })}
								options={['pct', 'px'] as const}
								getLabel={(u) => (u === 'pct' ? 'Percentage' : 'Pixels')}
							/>
						</ParamRow>
						{(['x', 'y', 'w', 'h'] as const).map((k) => (
							<PanelSlider
								key={k}
								label={k.toUpperCase() + (filter.unit === 'pct' ? ' %' : ' px')}
								value={filter[k]}
								min={0}
								max={filter.unit === 'pct' ? 100 : 7680}
								step={filter.unit === 'pct' ? 0.1 : 1}
								onChange={(v) => onChange({ ...filter, [k]: v })}
							/>
						))}
					</>
				);
			case 'blur':
				return (
					<PanelSlider
						label='Sigma'
						value={filter.sigma}
						min={0}
						max={40}
						step={0.5}
						onChange={(v) => onChange({ ...filter, sigma: parseFloat(v.toFixed(1)) })}
					/>
				);
			case 'deinterlace':
				return (
					<ParamRow label='Algorithm'>
						<StyledSelect
							value={filter.mode}
							onChange={(m) => onChange({ ...filter, mode: m })}
							options={['yadif', 'bwdif'] as const}
							getLabel={(m) => (m === 'yadif' ? 'YADIF' : 'BWDIF (better quality)')}
						/>
					</ParamRow>
				);
			case 'eq':
				return (
					<>
						<PanelSlider
							label='Brightness'
							value={filter.brightness}
							min={-1}
							max={1}
							step={0.01}
							onChange={(v) => onChange({ ...filter, brightness: parseFloat(v.toFixed(3)) })}
						/>
						<PanelSlider
							label='Contrast'
							value={filter.contrast}
							min={0}
							max={3}
							step={0.01}
							onChange={(v) => onChange({ ...filter, contrast: parseFloat(v.toFixed(3)) })}
						/>
						<PanelSlider
							label='Saturation'
							value={filter.saturation}
							min={0}
							max={3}
							step={0.01}
							onChange={(v) => onChange({ ...filter, saturation: parseFloat(v.toFixed(3)) })}
						/>
						<PanelSlider
							label='Gamma'
							value={filter.gamma}
							min={0.1}
							max={10}
							step={0.01}
							onChange={(v) => onChange({ ...filter, gamma: parseFloat(v.toFixed(3)) })}
						/>
					</>
				);
			case 'hflip':
			case 'vflip':
				return null;
			case 'fps':
				return (
					<>
						<PanelSlider
							label='FPS'
							value={filter.value}
							min={1}
							max={120}
							step={0.5}
							onChange={(v) => onChange({ ...filter, value: parseFloat(v.toFixed(2)) })}
						/>
						<Box
							sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
							onClick={() => onChange({ ...filter, smooth: !filter.smooth })}
						>
							<Checkbox size='small' checked={!!filter.smooth} onChange={() => {}} sx={{ p: 0, mr: 0.5, color: label, '&.Mui-checked': { color: defC } }} />
							<Typography sx={{ fontSize: 11, color: label }}>Smooth (motion interpolation)</Typography>
						</Box>
					</>
				);
			case 'unsharp': {
				const sharpMethod = filter.method ?? 'cas';
				return (
					<>
						<ParamRow label='Method'>
							<StyledSelect
								value={sharpMethod}
								onChange={(m) => onChange({ ...filter, method: m })}
								options={['cas', 'unsharp'] as const}
								getLabel={(m) => (m === 'cas' ? 'CAS (adaptive)' : 'Unsharp mask')}
							/>
						</ParamRow>
						{sharpMethod === 'cas' ? (
							<PanelSlider
								label='Strength'
								value={filter.strength ?? 0.4}
								min={0}
								max={1}
								step={0.05}
								onChange={(v) => onChange({ ...filter, strength: parseFloat(v.toFixed(2)) })}
							/>
						) : (
							<>
								<PanelSlider
									label='Amount'
									value={filter.lumaAmount}
									min={-10}
									max={10}
									step={0.1}
									noClamp
									onChange={(v) => onChange({ ...filter, lumaAmount: parseFloat(v.toFixed(2)) })}
								/>
								<PanelSlider
									label='Size (px)'
									value={filter.lumaSize}
									min={1}
									max={23}
									step={2}
									onChange={(v) => onChange({ ...filter, lumaSize: Math.round(v) })}
								/>
							</>
						)}
					</>
				);
			}
			case 'denoise':
				return (
					<>
						<ParamRow label='Method'>
							<StyledSelect
								value={filter.method ?? 'hqdn3d'}
								onChange={(m) => onChange({ ...filter, method: m })}
								options={['hqdn3d', 'fftdnoiz', 'nlmeans', 'atadenoise'] as const}
								getLabel={(m) =>
									m === 'hqdn3d' ? 'hqdn3d (light/fast)' : m === 'fftdnoiz' ? 'fftdnoiz (balanced)' : m === 'nlmeans' ? 'nlmeans (max, slow)' : 'atadenoise (static cam)'
								}
							/>
						</ParamRow>
						<PanelSlider
							label='Strength'
							value={filter.strength}
							min={0}
							max={10}
							step={0.5}
							onChange={(v) => onChange({ ...filter, strength: parseFloat(v.toFixed(1)) })}
						/>
					</>
				);
			case 'pixfmt':
				return (
					<ParamRow label='Format'>
						<StyledSelect value={filter.value} onChange={(v) => onChange({ ...filter, value: v })} options={PIXEL_FORMATS} />
					</ParamRow>
				);
			case 'rotate':
				return (
					<ParamRow label='Angle'>
						<StyledSelect
							value={filter.angle}
							onChange={(v) => onChange({ ...filter, angle: v })}
							options={[0, 90, 180, 270] as const}
							getLabel={(a) => `${a}°`}
						/>
					</ParamRow>
				);
			case 'position':
				return (
					<>
						<Typography sx={{ fontSize: 10, color: dimC, mb: 0.75, fontStyle: 'italic' }}>
							Position the source inside the Frame canvas. Values outside 0–100 push the source past the frame edges.
						</Typography>
						<PanelSlider
							label='X  (0 = left · 50 = center · 100 = right)'
							value={filter.xPct}
							min={-100}
							max={200}
							step={0.5}
							noClamp
							onChange={(v) => onChange({ ...filter, xPct: parseFloat(v.toFixed(1)) })}
						/>
						<PanelSlider
							label='Y  (0 = top · 50 = center · 100 = bottom)'
							value={filter.yPct}
							min={-100}
							max={200}
							step={0.5}
							noClamp
							onChange={(v) => onChange({ ...filter, yPct: parseFloat(v.toFixed(1)) })}
						/>
					</>
				);
			case 'hue':
				return (
					<>
						<PanelSlider label='Hue (°)' value={filter.degrees} min={-180} max={180} step={1} onChange={(v) => onChange({ ...filter, degrees: Math.round(v) })} />
						<PanelSlider label='Saturation' value={filter.saturation} min={0} max={3} step={0.05} onChange={(v) => onChange({ ...filter, saturation: parseFloat(v.toFixed(2)) })} />
					</>
				);
			case 'curves':
				return (
					<ParamRow label='Preset'>
						<StyledSelect
							value={filter.preset}
							onChange={(p) => onChange({ ...filter, preset: p })}
							options={['none', 'increase_contrast', 'linear_contrast', 'medium_contrast', 'strong_contrast', 'vintage', 'cross_process', 'negative', 'color_negative', 'darker', 'lighter']}
						/>
					</ParamRow>
				);
			case 'colormix':
				return (
					<ParamRow label='Preset'>
						<StyledSelect
							value={filter.preset}
							onChange={(p) => onChange({ ...filter, preset: p })}
							options={['grayscale', 'sepia', 'swapRB'] as const}
							getLabel={(p) => (p === 'grayscale' ? 'Grayscale (b/w)' : p === 'sepia' ? 'Sepia' : 'Swap R↔B')}
						/>
					</ParamRow>
				);
			case 'colorbalance':
				return (
					<>
						{(
							[
								['rs', 'Shadows R'], ['gs', 'Shadows G'], ['bs', 'Shadows B'],
								['rm', 'Mids R'], ['gm', 'Mids G'], ['bm', 'Mids B'],
								['rh', 'Highs R'], ['gh', 'Highs G'], ['bh', 'Highs B'],
							] as const
						).map(([k, lbl]) => (
							<PanelSlider key={k} label={lbl} value={filter[k]} min={-1} max={1} step={0.05} noClamp onChange={(v) => onChange({ ...filter, [k]: parseFloat(v.toFixed(2)) })} />
						))}
					</>
				);
			case 'lut3d':
				return (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
						<Button
							size='small'
							variant='outlined'
							onClick={() =>
								commands
									.selectFiles({ multiSelect: false, filters: [{ name: 'LUT', extensions: ['cube', '3dl'] }] })
									.then((r) => {
										const p = unwrap(r);
										if (p?.length) onChange({ ...filter, file: p[0] });
									})
									.catch(() => {})
							}
							sx={{ textTransform: 'none', fontSize: 11 }}
						>
							{filter.file ? 'Change .cube' : 'Select .cube…'}
						</Button>
						{filter.file && (
							<Typography sx={{ fontSize: 10, color: label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
								{filter.file.split(/[/\\]/).pop()}
							</Typography>
						)}
					</Box>
				);
			case 'vignette':
				return (
					<PanelSlider label='Amount' value={filter.amount} min={0} max={100} step={1} onChange={(v) => onChange({ ...filter, amount: Math.round(v) })} />
				);
			case 'deband':
				return (
					<PanelSlider
						label='Strength'
						value={filter.strength}
						min={1}
						max={50}
						step={1}
						onChange={(v) => onChange({ ...filter, strength: Math.round(v) })}
					/>
				);
			case 'cleanup':
				return (
					<>
						<Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }} onClick={() => onChange({ ...filter, deblock: !filter.deblock })}>
							<Checkbox size='small' checked={filter.deblock} onChange={() => {}} sx={{ p: 0, mr: 0.5, color: label, '&.Mui-checked': { color: defC } }} />
							<Typography sx={{ fontSize: 11, color: label }}>Deblock (macroblock artifacts)</Typography>
						</Box>
						<Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }} onClick={() => onChange({ ...filter, chromaNr: !filter.chromaNr })}>
							<Checkbox size='small' checked={filter.chromaNr} onChange={() => {}} sx={{ p: 0, mr: 0.5, color: label, '&.Mui-checked': { color: defC } }} />
							<Typography sx={{ fontSize: 11, color: label }}>Chroma denoise</Typography>
						</Box>
					</>
				);
			case 'bgcolor':
				return (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
						<Typography sx={{ fontSize: 11, color: label, flexShrink: 0 }}>Color</Typography>
						<MyPopoverColor color={filter.color} onChange={(c) => onChange({ ...filter, color: c })} size={22} />
						<Typography sx={{ fontSize: 10, color: label, fontFamily: 'monospace' }}>{filter.color}</Typography>
					</Box>
				);
			default:
				return null;
		}
	};

	return (
		<Box sx={{ mb: 0.75, border: `1px solid ${border}`, borderRadius: '4px', backgroundColor: bg, overflow: 'hidden' }}>
			<Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.4, borderBottom: enabled ? `1px solid ${border}` : 'none', gap: 0.5 }}>
				{/* Enable/Disable toggle */}
				<Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1, userSelect: 'none', gap: 0.5 }} onClick={toggle}>
					<Checkbox size='small' checked={enabled} onChange={() => {}} sx={{ p: 0, color: dimC, '&.Mui-checked': { color: defC } }} />
					<Typography sx={{ fontSize: 11, fontWeight: 500, color: enabled ? defC : dimC }}>{title}</Typography>
				</Box>
				<Box
					component='button'
					onClick={onRemove}
					sx={{
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: 18,
						height: 18,
						borderRadius: '3px',
						border: 'none',
						backgroundColor: btnBg,
						color: label,
						cursor: 'pointer',
						'&:hover': { color: '#e06c75' },
					}}
				>
					<XIcon size={11} />
				</Box>
			</Box>
			{enabled && <Box sx={{ px: 1.5, pt: 0.75, pb: 0.5 }}>{body()}</Box>}
		</Box>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio filter block
// ─────────────────────────────────────────────────────────────────────────────

function AudioFilterBlock({ filter, onChange, onRemove }: { filter: AudioFilterItem; onChange: (u: AudioFilterItem) => void; onRemove: () => void }) {
	const bg = greyColor(12);
	const border = greyColor(22);
	const label = greyColor(50);
	const defC = greyColor(80);
	const btnBg = greyColor(18);
	const dimC = greyColor(35);

	const enabled = filter.enabled !== false;
	const title = AUDIO_FILTER_LABELS[filter.type] ?? filter.type;
	const toggle = () => onChange({ ...filter, enabled: !enabled } as AudioFilterItem);

	const body = () => {
		if (!enabled) return null;
		switch (filter.type) {
			case 'loudnorm':
				return (
					<>
						<PanelSlider
							label='Target LUFS'
							value={filter.target}
							min={-70}
							max={0}
							step={0.5}
							noClamp
							onChange={(v) => onChange({ ...filter, target: parseFloat(v.toFixed(1)) })}
						/>
						<PanelSlider
							label='Range LU'
							value={filter.range}
							min={1}
							max={20}
							step={0.5}
							onChange={(v) => onChange({ ...filter, range: parseFloat(v.toFixed(1)) })}
						/>
						<PanelSlider
							label='True Peak'
							value={filter.tp}
							min={-9}
							max={0}
							step={0.5}
							onChange={(v) => onChange({ ...filter, tp: parseFloat(v.toFixed(1)) })}
						/>
					</>
				);
			case 'volume':
				return (
					<PanelSlider
						label='Volume dB'
						value={filter.db}
						min={-40}
						max={40}
						step={0.5}
						noClamp
						onChange={(v) => onChange({ ...filter, db: parseFloat(v.toFixed(1)) })}
					/>
				);
			case 'highpass':
				return (
					<PanelSlider
						label='Freq Hz'
						value={filter.freq}
						min={10}
						max={2000}
						step={10}
						onChange={(v) => onChange({ ...filter, freq: Math.round(v) })}
					/>
				);
			case 'lowpass':
				return (
					<PanelSlider
						label='Freq Hz'
						value={filter.freq}
						min={1000}
						max={20000}
						step={100}
						onChange={(v) => onChange({ ...filter, freq: Math.round(v) })}
					/>
				);
			case 'acompressor':
				return (
					<>
						<PanelSlider label='Threshold dB' value={filter.threshold} min={-60} max={0} step={1} onChange={(v) => onChange({ ...filter, threshold: Math.round(v) })} />
						<PanelSlider label='Ratio' value={filter.ratio} min={1} max={20} step={0.5} onChange={(v) => onChange({ ...filter, ratio: parseFloat(v.toFixed(1)) })} />
					</>
				);
			case 'alimiter':
				return (
					<PanelSlider label='Limit dB' value={filter.limitDb} min={-12} max={0} step={0.5} noClamp onChange={(v) => onChange({ ...filter, limitDb: parseFloat(v.toFixed(1)) })} />
				);
			case 'agate':
				return (
					<PanelSlider label='Threshold dB' value={filter.thresholdDb} min={-80} max={0} step={1} onChange={(v) => onChange({ ...filter, thresholdDb: Math.round(v) })} />
				);
			case 'afftdn':
				return (
					<PanelSlider label='Noise floor dB' value={filter.noiseFloor} min={-80} max={-10} step={1} onChange={(v) => onChange({ ...filter, noiseFloor: Math.round(v) })} />
				);
			case 'speechnorm':
				return (
					<PanelSlider label='Peak' value={filter.peak} min={0.1} max={1} step={0.05} onChange={(v) => onChange({ ...filter, peak: parseFloat(v.toFixed(2)) })} />
				);
			case 'dynaudnorm':
				return (
					<PanelSlider label='Strength' value={filter.strength} min={0} max={100} step={1} onChange={(v) => onChange({ ...filter, strength: Math.round(v) })} />
				);
			case 'equalizer':
				return (
					<>
						<PanelSlider label='Freq Hz' value={filter.freq} min={20} max={20000} step={10} onChange={(v) => onChange({ ...filter, freq: Math.round(v) })} />
						<PanelSlider label='Gain dB' value={filter.gain} min={-20} max={20} step={0.5} noClamp onChange={(v) => onChange({ ...filter, gain: parseFloat(v.toFixed(1)) })} />
					</>
				);
			case 'rubberband':
				return (
					<>
						<PanelSlider label='Tempo' value={filter.tempo} min={0.5} max={2} step={0.01} onChange={(v) => onChange({ ...filter, tempo: parseFloat(v.toFixed(2)) })} />
						<PanelSlider label='Pitch' value={filter.pitch} min={0.5} max={2} step={0.01} onChange={(v) => onChange({ ...filter, pitch: parseFloat(v.toFixed(2)) })} />
					</>
				);
			case 'atempo':
				return (
					<PanelSlider
						label='Speed'
						value={filter.factor}
						min={0.5}
						max={2.0}
						step={0.05}
						onChange={(v) => onChange({ ...filter, factor: parseFloat(v.toFixed(2)) })}
					/>
				);
			default:
				return null;
		}
	};

	return (
		<Box sx={{ mb: 0.75, border: `1px solid ${border}`, borderRadius: '4px', backgroundColor: bg, overflow: 'hidden' }}>
			<Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.4, borderBottom: enabled ? `1px solid ${border}` : 'none', gap: 0.5 }}>
				<Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1, userSelect: 'none', gap: 0.5 }} onClick={toggle}>
					<Checkbox size='small' checked={enabled} onChange={() => {}} sx={{ p: 0, color: dimC, '&.Mui-checked': { color: defC } }} />
					<Typography sx={{ fontSize: 11, fontWeight: 500, color: enabled ? defC : dimC }}>{title}</Typography>
				</Box>
				<Box
					component='button'
					onClick={onRemove}
					sx={{
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: 18,
						height: 18,
						borderRadius: '3px',
						border: 'none',
						backgroundColor: btnBg,
						color: label,
						cursor: 'pointer',
						'&:hover': { color: '#e06c75' },
					}}
				>
					<XIcon size={11} />
				</Box>
			</Box>
			{enabled && <Box sx={{ px: 1.5, pt: 0.75, pb: 0.5 }}>{body()}</Box>}
		</Box>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Add-filter select
// ─────────────────────────────────────────────────────────────────────────────

function AddFilterSelect<T extends string>({ labels, onAdd }: { labels: Record<T, string>; onAdd: (t: T) => void }) {
	const bg = greyColor(18);
	const border = greyColor(28);
	const color = greyColor(60);
	const entries = Object.entries(labels) as [T, string][];
	return (
		<Select
			size='small'
			displayEmpty
			value=''
			onChange={(e) => {
				if (e.target.value) onAdd(e.target.value as T);
			}}
			renderValue={() => '+ Add filter…'}
			sx={{
				fontSize: 11,
				backgroundColor: bg,
				color,
				'& .MuiOutlinedInput-notchedOutline': { borderColor: border, borderStyle: 'dashed' },
				'& .MuiSvgIcon-root': { color },
				'& .MuiSelect-select': { py: '3px', px: '8px' },
				width: '100%',
				mt: 0.5,
			}}
			MenuProps={{ sx: { zIndex: 10000 }, PaperProps: { sx: { backgroundColor: greyColor(18), color: greyColor(80) } } }}
		>
			{entries.map(([type, lbl]) => (
				<MenuItem key={type} value={type} sx={{ fontSize: 11, py: 0.4 }}>
					{lbl}
				</MenuItem>
			))}
		</Select>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section header with checkbox
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ label, checked, accentColor, onToggle }: { label: string; checked: boolean; accentColor: string; onToggle: () => void }) {
	const defC = greyColor(80);
	const dimC = greyColor(45);
	return (
		<Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', mb: 1 }} onClick={onToggle}>
			<Checkbox
				size='small'
				checked={checked}
				onChange={() => {}}
				sx={{ p: 0, mr: 0.5, color: dimC, '&.Mui-checked': { color: accentColor } }}
			/>
			<Typography
				sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: checked ? accentColor : dimC }}
			>
				{label}
			</Typography>
		</Box>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────────

interface ConvertPanelProps {
	settings: ConvertSettings;
	onChange: (s: ConvertSettings) => void;
	width: number;
	filePath: string;
	onSelectFile: (p: string) => void;
	/** Source file dimensions — used to auto-fill canvas size in Position filter */
	sourceW?: number;
	sourceH?: number;
	/** Активная тема — ограничивает секции/фильтры. По умолчанию full. */
	theme?: ConvertTheme;
}

function ConvertPanel({ settings, onChange, width, filePath, onSelectFile, sourceW, sourceH, theme = CONVERT_THEME_FULL }: ConvertPanelProps) {
	const bg = greyColor(15);
	const border = greyColor(25);
	const labelColor = greyColor(50);
	const defColor = greyColor(80);
	const btnBg = greyColor(20);
	const btnActiveBg = greyColor(38);
	const btnBorder = greyColor(28);
	const btnActiveBorder = greyColor(55);

	// ── Extension lists from store ─────────────────────────────────────────
	const fileTypes = typeOfFile_store((s) => s.patternStore);
	const videoExts: string[] = fileTypes.find((e) => e.id === 'video')?.path ?? FALLBACK_VIDEO_CONTAINERS;
	const filteredVideoExts = videoExts.filter((e) => !['ts', 'm2v', 'm4v'].includes(e));
	const audioExts: string[] = fileTypes.find((e) => e.id === 'audio')?.path ?? [];
	const imageExts: string[] = fileTypes.find((e) => e.id === 'image')?.path ?? FALLBACK_IMAGE_FORMATS;
	const filteredImageExts = imageExts.filter((e) => !['tga', 'pdf', 'pgf'].includes(e));

	// ── Output mode derived from selected extension ────────────────────────
	const ext = settings.outputExtension.toLowerCase();
	const outputMode: 'image' | 'audio' | 'video' = imageExts.includes(ext) ? 'image' : audioExts.includes(ext) ? 'audio' : 'video';

	const compatVideoCodecs = VIDEO_CODECS_FOR_CONTAINER[ext] ?? VIDEO_CODECS;
	const compatAudioCodecs = outputMode === 'audio' ? (AUDIO_CODECS_FOR_EXT[ext] ?? AUDIO_CODECS) : AUDIO_CODECS;

	const settingsRef = useRef(settings);
	settingsRef.current = settings;

	// Native Tauri file dialog — returns an absolute path. A web <input type=file>
	// can't: in WKWebView the File object has no `.path`, so the preview would get a
	// bare filename and fail to load. Mirrors VideoAdjustPanel.
	const selectPreviewFile = useCallback(() => {
		commands
			.selectFiles({
				multiSelect: false,
				filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mts', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'mp3', 'wav', 'aac', 'flac'] }],
			})
			.then((r) => { const paths = unwrap(r); if (paths?.length > 0) onSelectFile(paths[0]); })
			.catch(() => {});
	}, [onSelectFile]);

	const sectionLabel = (text: string) => (
		<Typography sx={{ fontSize: 10, color: labelColor, mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{text}</Typography>
	);

	// ── Setters ────────────────────────────────────────────────────────────

	const setImage = useCallback(
		(image: ImageConvertSettings) => {
			onChange({ ...settingsRef.current, image });
		},
		[onChange],
	);

	const setVideo = useCallback(
		(video: VideoConvertSettings) => {
			onChange({ ...settingsRef.current, video });
		},
		[onChange],
	);

	const setAudio = useCallback(
		(audio: AudioConvertSettings) => {
			onChange({ ...settingsRef.current, audio });
		},
		[onChange],
	);

	// ── Video filter mutators ──────────────────────────────────────────────

	const addVideoFilter = useCallback(
		(type: VideoFilterType) => {
			const v = settingsRef.current.video;
			setVideo({ ...v, filters: [...v.filters, defaultVideoFilter(type)] });
		},
		[setVideo],
	);
	const updateVideoFilter = useCallback(
		(id: string, u: VideoFilterItem) => {
			const v = settingsRef.current.video;
			setVideo({ ...v, filters: v.filters.map((f) => (f.id === id ? u : f)) });
		},
		[setVideo],
	);
	const removeVideoFilter = useCallback(
		(id: string) => {
			const v = settingsRef.current.video;
			setVideo({ ...v, filters: v.filters.filter((f) => f.id !== id) });
		},
		[setVideo],
	);

	// ── Image filter mutators ──────────────────────────────────────────────

	const addImageFilter = useCallback(
		(type: VideoFilterType) => {
			const img = settingsRef.current.image;
			setImage({ ...img, filters: [...img.filters, defaultVideoFilter(type) as ImageFilterItem] });
		},
		[setImage],
	);
	const updateImageFilter = useCallback(
		(id: string, u: ImageFilterItem) => {
			const img = settingsRef.current.image;
			setImage({ ...img, filters: img.filters.map((f) => (f.id === id ? u : f)) });
		},
		[setImage],
	);
	const removeImageFilter = useCallback(
		(id: string) => {
			const img = settingsRef.current.image;
			setImage({ ...img, filters: img.filters.filter((f) => f.id !== id) });
		},
		[setImage],
	);

	// ── Audio filter mutators ──────────────────────────────────────────────

	const addAudioFilter = useCallback(
		(type: AudioFilterType) => {
			const a = settingsRef.current.audio;
			setAudio({ ...a, filters: [...a.filters, defaultAudioFilter(type)] });
		},
		[setAudio],
	);
	const updateAudioFilter = useCallback(
		(id: string, u: AudioFilterItem) => {
			const a = settingsRef.current.audio;
			setAudio({ ...a, filters: a.filters.map((f) => (f.id === id ? u : f)) });
		},
		[setAudio],
	);
	const removeAudioFilter = useCallback(
		(id: string) => {
			const a = settingsRef.current.audio;
			setAudio({ ...a, filters: a.filters.filter((f) => f.id !== id) });
		},
		[setAudio],
	);

	const { image, video, audio } = settings;

	// Alpha/pix_fmt из общего ffmpegCaps (mp4 → нет альфы → тумблер скрыт).
	const videoAlphaAvail = alphaAvailable(ext, video.codec as VideoCodecId);
	const videoPixFmts = pixFmtsFor(video.codec as VideoCodecId, !!video.alpha);

	// Тема ограничивает секции/фильтры (full → всё разрешено).
	const allowV = (t: VideoFilterType) => !theme.allowedVideoFilters || theme.allowedVideoFilters.includes(t);
	const allowImg = (t: VideoFilterType) => !theme.allowedImageFilters || (theme.allowedImageFilters as readonly string[]).includes(t);
	const allowAud = (t: AudioFilterType) => !theme.allowedAudioFilters || theme.allowedAudioFilters.includes(t);
	const videoLabels = pickLabels(VIDEO_FILTER_LABELS, theme.allowedVideoFilters);
	const imageLabels = pickLabels(IMAGE_FILTER_LABELS as Record<string, string>, theme.allowedImageFilters);
	const audioLabels = pickLabels(AUDIO_FILTER_LABELS, theme.allowedAudioFilters);

	// ── Render ─────────────────────────────────────────────────────────────

	return (
		<Box
			className='nodrag'
			sx={{
				width,
				minWidth: width,
				maxWidth: width,
				backgroundColor: bg,
				borderLeft: `1px solid ${border}`,
				display: 'flex',
				flexDirection: 'column',
				overflowY: 'auto',
				overflowX: 'hidden',
				flexShrink: 0,
			}}
		>
			{/* ── FILE ───────────────────────────────────────────────── */}
			<Box sx={{ p: 1.5, pb: 1 }}>
				{sectionLabel('Preview File')}
				<Tooltip title='Select file for conversion preview' placement='left'>
					<Button
						size='small'
						fullWidth
						startIcon={<FolderOpen size={13} />}
						onClick={selectPreviewFile}
						sx={{
							textTransform: 'none',
							justifyContent: 'flex-start',
							fontSize: 11,
							px: 1,
							py: 0.4,
							color: filePath ? defColor : labelColor,
							borderColor: filePath ? btnActiveBorder : btnBorder,
							backgroundColor: btnBg,
							'&:hover': { backgroundColor: btnActiveBg, borderColor: defColor },
						}}
						variant='outlined'
					>
						<Box component='span' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
							{filePath ? fileBasename(filePath) : 'Select file…'}
						</Box>
					</Button>
				</Tooltip>
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ── OUTPUT EXTENSION (buttons) ─────────────────────────── */}
			<Box sx={{ p: 1.5, pb: 1 }}>
				{sectionLabel('Output Format')}
				{[
					{ key: 'video', exts: filteredVideoExts },
					{ key: 'audio', exts: audioExts },
					{ key: 'image', exts: filteredImageExts },
				]
					.filter(({ key, exts }) => exts.length > 0 && (!theme.sections || theme.sections.includes(key as 'video' | 'audio' | 'image')))
					.map(({ key, exts }) => (
						<Box key={key} sx={{ mb: 0.75 }}>
							<Typography sx={{ fontSize: 9, color: labelColor, mb: 0.4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
								{key}
							</Typography>
							<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
								{exts.map((e) => {
									const isActive = settings.outputExtension === e;
									return (
										<Box
											key={e}
											component='button'
											onClick={() => {
												const newCompatVideo = VIDEO_CODECS_FOR_CONTAINER[e] ?? VIDEO_CODECS;
												const newMode = imageExts.includes(e) ? 'image' : audioExts.includes(e) ? 'audio' : 'video';
												const newCompatAudio = newMode === 'audio' ? (AUDIO_CODECS_FOR_EXT[e] ?? AUDIO_CODECS) : AUDIO_CODECS;
												const fixedVideoCodec = newCompatVideo.includes(settings.video.codec)
													? settings.video.codec
													: (DEFAULT_VIDEO_CODEC_FOR_CONTAINER[e] ?? ('h264' as VideoCodec));
												const fixedAudioCodec = newCompatAudio.includes(settings.audio.codec)
													? settings.audio.codec
													: (DEFAULT_AUDIO_CODEC_FOR_EXT[e] ?? ('aac' as AudioCodec));
												onChange({
													...settings,
													outputExtension: e,
													video: fixedVideoCodec !== settings.video.codec ? { ...settings.video, codec: fixedVideoCodec } : settings.video,
													audio: fixedAudioCodec !== settings.audio.codec ? { ...settings.audio, codec: fixedAudioCodec } : settings.audio,
												});
											}}
											sx={{
												fontSize: 10,
												px: '6px',
												py: '2px',
												borderRadius: '3px',
												border: `1px solid ${isActive ? btnActiveBorder : btnBorder}`,
												backgroundColor: isActive ? btnActiveBg : btnBg,
												color: isActive ? defColor : labelColor,
												cursor: 'pointer',
												whiteSpace: 'nowrap',
												'&:hover': { color: defColor, borderColor: btnActiveBorder },
											}}
										>
											{e.toUpperCase()}
										</Box>
									);
								})}
							</Box>
						</Box>
					))}
			</Box>

			<Divider sx={{ borderColor: border }} />

			{/* ── IMAGE mode ────────────────────────────────────────────── */}
			{outputMode === 'image' && (
				<Box sx={{ p: 1.5, pb: 1 }}>
					{sectionLabel('Image Settings')}
					<PanelSlider
						label='Quality'
						value={image.quality}
						min={0}
						max={100}
						step={1}
						onChange={(v) => setImage({ ...image, quality: Math.round(v) })}
					/>
					{image.filters.filter((f) => allowImg(f.type)).map((f) => (
						<VideoFilterBlock
							key={f.id}
							filter={f as VideoFilterItem}
							onChange={(u) => updateImageFilter(f.id, u as ImageFilterItem)}
							onRemove={() => removeImageFilter(f.id)}
						/>
					))}
					{Object.keys(imageLabels).length > 0 && <AddFilterSelect labels={imageLabels} onAdd={(t) => addImageFilter(t as VideoFilterType)} />}
				</Box>
			)}

			{/* ── VIDEO section ─────────────────────────────────────────── */}
			{outputMode === 'video' && (
				<>
					<Box sx={{ p: 1.5, pb: 1 }}>
						<SectionHeader
							label='VIDEO'
							checked={video.enabled}
							accentColor='#4a9fd4'
							onToggle={() => setVideo({ ...video, enabled: !video.enabled })}
						/>
						{video.enabled && (
							<>
								<FrameBlock
									frame={video.frame ?? { mode: 'original', width: 1920, height: 1080, lockAspect: false }}
									sourceW={sourceW}
									sourceH={sourceH}
									onChange={(f) => setVideo({ ...video, frame: f })}
								/>
								<ParamRow label='Codec'>
									<StyledSelect
										value={video.codec}
										onChange={(c) => setVideo({ ...video, codec: c })}
										options={compatVideoCodecs}
										getLabel={codecLabel}
									/>
								</ParamRow>
								{PRESET_CODECS.has(video.codec) && (
									<ParamRow label='Preset'>
										<StyledSelect
											value={video.preset}
											onChange={(p) => setVideo({ ...video, preset: p })}
											options={VIDEO_PRESETS}
										/>
									</ParamRow>
								)}
								{CRF_CODECS.has(video.codec) && (
									<PanelSlider
										label={`CRF (0=lossless, ${crfMax(video.codec)}=worst)`}
										value={video.crf}
										min={0}
										max={crfMax(video.codec)}
										step={1}
										onChange={(v) => setVideo({ ...video, crf: Math.round(v) })}
									/>
								)}
								{videoAlphaAvail && (
										<ParamRow label='Alpha'>
											<Checkbox
												size='small'
												checked={!!video.alpha}
												onChange={(e) => {
													const alpha = e.target.checked;
													const pfs = pixFmtsFor(video.codec as VideoCodecId, alpha);
													setVideo({ ...video, alpha, pixFmt: pfs[0] });
												}}
												sx={{ p: 0 }}
											/>
										</ParamRow>
									)}
									{videoPixFmts.length > 0 && (
										<ParamRow label='Pixel fmt'>
											<StyledSelect
												value={video.pixFmt && videoPixFmts.includes(video.pixFmt) ? video.pixFmt : videoPixFmts[0]}
												onChange={(p) => setVideo({ ...video, pixFmt: p })}
												options={videoPixFmts}
											/>
										</ParamRow>
									)}
									{video.filters.filter((f) => allowV(f.type)).map((f) => (
									<VideoFilterBlock
										key={f.id}
										filter={f}
										onChange={(u) => updateVideoFilter(f.id, u)}
										onRemove={() => removeVideoFilter(f.id)}
									/>
								))}
								{Object.keys(videoLabels).length > 0 && <AddFilterSelect labels={videoLabels} onAdd={addVideoFilter} />}
							</>
						)}
					</Box>
					<Divider sx={{ borderColor: border }} />
				</>
			)}

			{/* ── AUDIO section ─────────────────────────────────────────── */}
			{(outputMode === 'video' || outputMode === 'audio') && (
				<Box sx={{ p: 1.5, pb: 1.5 }}>
					{outputMode === 'audio' ? (
						<Typography sx={{ fontSize: 10, color: labelColor, mb: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
							Audio
						</Typography>
					) : (
						<SectionHeader
							label='AUDIO'
							checked={audio.enabled}
							accentColor='#e0a850'
							onToggle={() => setAudio({ ...audio, enabled: !audio.enabled })}
						/>
					)}
					{(outputMode === 'audio' || audio.enabled) && (
						<>
							<ParamRow label='Codec'>
								<StyledSelect
									value={audio.codec}
									onChange={(c) => setAudio({ ...audio, codec: c })}
									options={compatAudioCodecs}
									getLabel={(c) =>
										c === 'aac'
											? 'AAC'
											: c === 'mp3'
												? 'MP3 (libmp3lame)'
												: c === 'opus'
													? 'Opus'
													: c === 'flac'
														? 'FLAC (lossless)'
														: c === 'pcm_s16le'
															? 'PCM 16-bit (WAV)'
															: 'Copy (stream copy)'
									}
								/>
							</ParamRow>
							{audio.codec !== 'copy' && audio.codec !== 'flac' && audio.codec !== 'pcm_s16le' && (
								<ParamRow label='Bitrate'>
									<StyledSelect
										value={audio.bitrate}
										onChange={(b) => setAudio({ ...audio, bitrate: b })}
										options={AUDIO_BITRATES}
									/>
								</ParamRow>
							)}
							<ParamRow label='Sample rate'>
								<StyledSelect
									value={audio.sampleRate}
									onChange={(r) => setAudio({ ...audio, sampleRate: r })}
									options={AUDIO_SAMPLE_RATES}
									getLabel={(r) => `${r} Hz`}
								/>
							</ParamRow>
							<ParamRow label='Channels'>
								<StyledSelect
									value={audio.channels}
									onChange={(ch) => setAudio({ ...audio, channels: ch })}
									options={[1, 2, 6] as const}
									getLabel={(ch) => (ch === 1 ? 'Mono (1ch)' : ch === 2 ? 'Stereo (2ch)' : '5.1 (6ch)')}
								/>
							</ParamRow>
							{audio.filters.filter((f) => allowAud(f.type)).map((f) => (
								<AudioFilterBlock
									key={f.id}
									filter={f}
									onChange={(u) => updateAudioFilter(f.id, u)}
									onRemove={() => removeAudioFilter(f.id)}
								/>
							))}
							{Object.keys(audioLabels).length > 0 && <AddFilterSelect labels={audioLabels} onAdd={addAudioFilter} />}
						</>
					)}
				</Box>
			)}
		</Box>
	);
}

export default memo(ConvertPanel);
