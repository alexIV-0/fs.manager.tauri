// Static versions of ReactFlow-dependent components for use in PluginBuilder
// They accept data directly via props instead of @xyflow/react context

import { memo, useCallback, useMemo, useState } from 'react';
import { Box, IconButton, InputBase, Paper, Stack, TextField, Typography } from '@mui/material';
import { Edit2, X, SquareArrowOutDownRight } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import type { UiPropertyData } from './types';
import { complimentColor } from '@/NODE_WIN/utils/complimentColor';

// ── StaticNodeShell ──────────────────────────────────────────────────────────

interface StaticNodeShellProps {
	children: React.ReactNode;
	sx?: object;
	width?: number;
	height?: number;
	onResize?: (w: number, h: number) => void;
}

export const StaticNodeShell = memo(function StaticNodeShell({ children, sx, width, height, onResize }: StaticNodeShellProps) {
	const gray40 = greyColor(40);

	// Resize handler
	const startX = useMemo(() => ({ v: 0 }), []);
	const startY = useMemo(() => ({ v: 0 }), []);
	const startW = useMemo(() => ({ v: 0 }), []);
	const startH = useMemo(() => ({ v: 0 }), []);

	const onMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			startX.v = e.clientX;
			startY.v = e.clientY;
			startW.v = width ?? 380;
			startH.v = height ?? 400;

			const onMove = (ev: MouseEvent) => {
				const nw = Math.max(200, startW.v + (ev.clientX - startX.v));
				const nh = Math.max(80, startH.v + (ev.clientY - startY.v));
				onResize?.(Math.round(nw), Math.round(nh));
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		},
		[width, height, onResize, startX, startY, startW, startH],
	);

	return (
		<Box sx={{ position: 'relative', display: 'inline-block' }}>
			<Box
				className='node-shell'
				sx={{
					borderRadius: 'inherit',
					width,
					...sx,
				}}
			>
				<Stack direction='column' gap={2} overflow='hidden' sx={{ height: '100%' }}>
					{children}
				</Stack>
			</Box>
			{/* Resize handle */}
			<Box
				onMouseDown={onMouseDown}
				sx={{
					position: 'absolute',
					right: 0,
					bottom: 0,
					display: 'flex',
					alignItems: 'center',
					gap: 0.5,
					cursor: 'nwse-resize',
					zIndex: 10,
					px: 0.75,
					py: 0.35,
					bgcolor: `${greyColor(20)}cc`,
					border: `1px solid ${gray40}`,
					borderTopLeftRadius: 6,
					'&:hover': { bgcolor: `${greyColor(30)}cc` },
				}}
			>
				<Typography variant='caption' sx={{ fontSize: 9, color: greyColor(60), fontFamily: 'monospace' }}>
					{width}×{height}
				</Typography>
				<SquareArrowOutDownRight size={11} color={greyColor(60)} />
			</Box>
		</Box>
	);
});

// ── StaticNodeHeader ─────────────────────────────────────────────────────────

interface StaticNodeHeaderProps {
	label: string;
	colorType: string;
	isValid: boolean;
	onLabelChange: (label: string) => void;
}

export const StaticNodeHeader = memo(function StaticNodeHeader({ label, colorType, isValid, onLabelChange }: StaticNodeHeaderProps) {
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const defColor = colorTypes.default as string;
	const backgroundColor = isValid ? ((colorTypes[colorType] as string) ?? defColor) : defColor;
	const textColor = complimentColor(backgroundColor);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(label);

	const commit = () => {
		setEditing(false);
		if (draft.trim()) onLabelChange(draft.trim());
		else setDraft(label);
	};

	return (
		<Stack direction='row' alignItems='center' px='6px 14px' bgcolor={backgroundColor} borderRadius='4px 4px 0 0' color={textColor}>
			{editing ? (
				<Paper component='form' sx={{ flex: 1, display: 'flex', alignItems: 'center', px: 1, py: 0.25, bgcolor: 'rgba(0,0,0,0.2)' }}>
					<InputBase
						value={draft}
						autoFocus
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') commit();
							if (e.key === 'Escape') {
								setEditing(false);
								setDraft(label);
							}
						}}
						onBlur={commit}
						sx={{ flex: 1, fontSize: 13, fontWeight: 700, color: textColor }}
					/>
					<IconButton size='small' onClick={commit} sx={{ p: 0.25, color: textColor }}>
						<X size={12} />
					</IconButton>
				</Paper>
			) : (
				<Typography
					variant='body2'
					fontWeight={700}
					sx={{ fontSize: 13, cursor: 'pointer', flex: 1 }}
					onDoubleClick={() => {
						setDraft(label);
						setEditing(true);
					}}
				>
					{label || 'Node Name'}
					<Edit2 size={10} style={{ marginLeft: 6, opacity: 0.4, verticalAlign: 'middle' }} />
				</Typography>
			)}
		</Stack>
	);
});

// ── StaticComment ────────────────────────────────────────────────────────────

interface StaticCommentProps {
	value: string;
	onChange: (v: string) => void;
}

export const StaticComment = memo(function StaticComment({ value, onChange }: StaticCommentProps) {
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const [draft, setDraft] = useState(value);
	const [editing, setEditing] = useState(false);
	const gray40 = greyColor(40);
	const gray60 = greyColor(60);
	const gray20 = greyColor(20);

	const commit = () => {
		setEditing(false);
		onChange(draft);
	};
	const cancel = () => {
		setEditing(false);
		setDraft(value);
	};

	if (editing) {
		return (
			<Box sx={{ px: '12px', pb: '12px' }}>
				<Typography variant='body1' fontSize='12px' mb='4px' color={colorTypes.default as string}>
					Comment
				</Typography>
				<TextField
					fullWidth
					multiline
					placeholder='...'
					value={draft}
					autoFocus
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && e.metaKey) commit();
						if (e.key === 'Escape') cancel();
					}}
					minRows={2}
					maxRows={6}
					slotProps={{ input: { sx: { fontSize: '12px', borderRadius: '4px', padding: '8px', pt: '12px' } } }}
				/>
				<Stack direction='row' gap={0.5} sx={{ mt: 0.5 }}>
					<button
						onClick={commit}
						style={{
							fontSize: 10,
							cursor: 'pointer',
							background: '#2e7d32',
							color: '#fff',
							border: 'none',
							borderRadius: 3,
							padding: '2px 8px',
						}}
					>
						OK
					</button>
					<button
						onClick={cancel}
						style={{
							fontSize: 10,
							cursor: 'pointer',
							background: gray40,
							color: gray60,
							border: 'none',
							borderRadius: 3,
							padding: '2px 8px',
						}}
					>
						Отмена
					</button>
				</Stack>
			</Box>
		);
	}

	return (
		<Box sx={{ px: '12px', pb: '12px' }}>
			<Typography variant='body1' fontSize='12px' mb='4px' color={colorTypes.default as string}>
				Comment
			</Typography>
			<Box
				onClick={() => {
					setDraft(value);
					setEditing(true);
				}}
				sx={{
					fontSize: '12px',
					cursor: 'text',
					'&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
					minHeight: 20,
					display: 'flex',
					alignItems: 'center',
					gap: 0.5,
					px: 1,
					py: 0.5,
					borderRadius: 1,
				}}
			>
				{value ? (
					<span style={{ whiteSpace: 'pre-wrap', color: gray60 }}>{value}</span>
				) : (
					<span style={{ opacity: 0.3, color: gray60 }}>+ comment...</span>
				)}
				<Edit2 size={9} style={{ opacity: 0.3, marginLeft: 'auto', color: gray60 }} />
			</Box>
		</Box>
	);
});

// ── StaticOutputHandle ───────────────────────────────────────────────────────

interface StaticOutputHandleProps {
	sourceProperty: string | undefined;
	properties: UiPropertyData[];
}

export const StaticOutputHandle = memo(function StaticOutputHandle({ sourceProperty, properties }: StaticOutputHandleProps) {
	const src = properties.find((p) => p.id === sourceProperty);
	if (!src) return null;
	return (
		<Box sx={{ px: '12px', pb: '12px' }}>
			<Typography variant='caption' sx={{ fontSize: 10, opacity: 0.5, display: 'block', mb: 0.5 }}>
				Output
			</Typography>
			<Box
				sx={{
					fontSize: 11,
					fontFamily: 'monospace',
					color: '#81c784',
					bgcolor: greyColor(20),
					px: 0.75,
					py: 0.35,
					borderRadius: 0.5,
				}}
			>
				→ {src.id} ({src.outputType ?? 'string'})
			</Box>
		</Box>
	);
});

// ── StaticGenericProperty — renders the visual control ───────────────────────

interface StaticGenericPropertyProps {
	property: UiPropertyData;
	isSelected: boolean;
	onSelect: () => void;
}

export const StaticGenericProperty = memo(function StaticGenericProperty({ property, isSelected, onSelect }: StaticGenericPropertyProps) {
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const color = (colorTypes[property.controlType] as string) ?? (colorTypes.default as string);
	const cp = property.controlProps;

	const renderControl = () => {
		switch (property.controlType) {
			case 'checkbox':
				return (
					<Stack direction='row' alignItems='center' gap={1} sx={{ py: 0.25 }}>
						<Box
							sx={{
								width: 16,
								height: 16,
								borderRadius: '3px',
								flexShrink: 0,
								border: `1.5px solid ${color}`,
								bgcolor: cp.value ? color : 'transparent',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
							}}
						>
							{cp.value && <span style={{ fontSize: 10, lineHeight: 1, color: '#fff' }}>✓</span>}
						</Box>
						<Typography variant='caption' sx={{ fontSize: 11 }}>
							{cp.label}
						</Typography>
					</Stack>
				);
			case 'autocomplete':
				return (
					<Box>
						<Typography variant='caption' sx={{ fontSize: 10, opacity: 0.5, display: 'block', mb: 0.25 }}>
							{cp.label}
						</Typography>
						<Box
							sx={{
								display: 'flex',
								flexWrap: 'wrap',
								gap: 0.35,
								p: 0.5,
								border: `1px solid ${greyColor(40)}`,
								borderRadius: 0.5,
								bgcolor: greyColor(15),
								minHeight: 24,
							}}
						>
							{(cp.options ?? []).slice(0, 4).map((o: string) => (
								<Box key={o} sx={{ fontSize: 9, px: 0.5, py: 0.15, borderRadius: 0.5, bgcolor: `${color}22`, color }}>
									{o}
								</Box>
							))}
							{(cp.options ?? []).length > 4 && (
								<Typography variant='caption' sx={{ fontSize: 9, opacity: 0.5 }}>
									+{(cp.options ?? []).length - 4}
								</Typography>
							)}
						</Box>
					</Box>
				);
			case 'ddm':
				return (
					<Box
						sx={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							px: 0.75,
							py: 0.35,
							border: `1px solid ${color}44`,
							borderRadius: 0.5,
							bgcolor: `${color}11`,
							fontSize: 11,
						}}
					>
						<span style={{ fontSize: 11 }}>{cp.value ?? cp.options?.[0] ?? '—'}</span>
						<span style={{ opacity: 0.4, fontSize: 9 }}>▼</span>
					</Box>
				);
			case 'slider': {
				const pct = (((cp.value ?? 50) - (cp.minValue ?? 0)) / ((cp.maxValue ?? 100) - (cp.minValue ?? 0))) * 100;
				return (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.5 }}>
						<Typography variant='caption' sx={{ fontSize: 11, minWidth: 60, color: greyColor(60) }}>
							{cp.label}
						</Typography>
						<Box sx={{ flex: 1, height: 4, bgcolor: greyColor(30), borderRadius: 2, position: 'relative' }}>
							<Box sx={{ position: 'absolute', left: 0, top: 0, width: `${pct}%`, height: '100%', bgcolor: color, borderRadius: 2 }} />
							<Box
								sx={{
									position: 'absolute',
									left: `calc(${pct}% - 6px)`,
									top: -3,
									width: 10,
									height: 10,
									borderRadius: '50%',
									bgcolor: color,
									border: `1px solid ${greyColor(50)}`,
								}}
							/>
						</Box>
					</Box>
				);
			}
			case 'timecode':
				return (
					<Stack direction='row' alignItems='center' gap={0.5}>
						<Typography variant='caption' sx={{ fontSize: 10, color: greyColor(60), minWidth: 60 }}>
							{cp.label}
						</Typography>
						<Typography
							variant='caption'
							sx={{ fontSize: 11, fontFamily: 'monospace', bgcolor: `${color}22`, px: 0.75, py: 0.25, borderRadius: 0.5, color }}
						>
							{formatTimecode(cp.value ?? 0)}
						</Typography>
					</Stack>
				);
			case 'link':
				return (
					<Typography variant='caption' sx={{ fontSize: 11, color: '#4fc3f7', textDecoration: 'underline' }}>
						{cp.label}
					</Typography>
				);
			case 'textedit':
				return (
					<Box sx={{ border: `1px solid ${greyColor(40)}`, borderRadius: 0.5, p: 0.5, bgcolor: greyColor(15), minHeight: 32 }}>
						<Typography variant='caption' sx={{ fontSize: 10, color: greyColor(60), display: 'block', mb: 0.25 }}>
							{cp.label}
						</Typography>
						<Typography variant='caption' sx={{ fontSize: 11, fontFamily: 'monospace', opacity: 0.5 }}>
							{cp.language}
						</Typography>
					</Box>
				);
			case 'pathNavigator':
			case 'jsonNavigator':
				return (
					<Stack
						direction='row'
						alignItems='center'
						gap={0.5}
						px={0.75}
						py={0.35}
						border={`1px solid ${greyColor(40)}`}
						borderRadius={0.5}
						bgcolor={greyColor(15)}
						fontSize={11}
					>
						<span style={{ fontSize: 11, color: greyColor(60) }}>{cp.label}</span>
						<span style={{ opacity: 0.3, fontSize: 9 }}>📁</span>
					</Stack>
				);
			default:
				return (
					<Typography variant='caption' sx={{ fontSize: 11 }}>
						{cp.label || property.id}
					</Typography>
				);
		}
	};

	return (
		<Box
			onClick={onSelect}
			sx={{
				px: '12px',
				py: 0.5,
				cursor: 'pointer',
				bgcolor: isSelected ? `${color}15` : 'transparent',
				borderLeft: '3px solid',
				borderLeftColor: isSelected ? color : 'transparent',
				'&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
				transition: 'background-color 0.12s',
			}}
		>
			{renderControl()}
		</Box>
	);
});

function formatTimecode(frames: number): string {
	const fps = 25;
	const totalSeconds = Math.floor(frames / fps);
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	const s = totalSeconds % 60;
	const f = frames % fps;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}
