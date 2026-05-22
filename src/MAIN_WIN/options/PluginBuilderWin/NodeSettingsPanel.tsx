import { useState } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Typography } from '@mui/material';
import { NumInput } from '@/components/NumInput';
import { X } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import type { UiJsonData } from './types';
import { toCamelCase } from './types';

interface NodeSettingsPanelProps {
	uiJson: UiJsonData;
	onChange: (uiJson: UiJsonData) => void;
	onClose: () => void;
}

function JsonField({ label, children }: { label: string; children: React.ReactNode }) {
	const gray60 = greyColor(60);
	return (
		<Stack direction='row' gap={0} alignItems='flex-start' sx={{ py: 0.2, px: 0.5, '&:hover': { bgcolor: 'rgba(255,255,255,0.015)' } }}>
			<Box sx={{ width: 16, flexShrink: 0 }} />
			<Box
				component='span'
				sx={{
					color: '#89b4fa',
					fontFamily: 'monospace',
					fontSize: 12,
					minWidth: 90,
					textAlign: 'right',
					mr: 0.5,
					pt: 0.3,
				}}
			>
				"{label}"
			</Box>
			<Box component='span' sx={{ color: gray60, fontFamily: 'monospace', fontSize: 12, mx: 0.5, pt: 0.3 }}>
				:
			</Box>
			<Box sx={{ ml: 1, flex: 1, minWidth: 0 }}>{children}</Box>
		</Stack>
	);
}

const ALLOWED_COLOR_TYPES = ['ffmpeg', 'main', 'helpers', 'ai', 'afterEffect', 'moho', 'ffprobe', 'default'];

export function NodeSettingsPanel({ uiJson, onChange, onClose }: NodeSettingsPanelProps) {
	const gray40 = greyColor(40);
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const colorTypeKeys = Object.keys(colorTypes).filter((k) => ALLOWED_COLOR_TYPES.includes(k));

	const [colorModalOpen, setColorModalOpen] = useState(false);
	const [outputModalOpen, setOutputModalOpen] = useState(false);

	const data = uiJson.data;
	const props = data.properties;

	const setData = (key: string, value: unknown) => onChange({ ...uiJson, data: { ...data, [key]: value } });

	const inp = (w: number) => ({
		background: 'transparent',
		border: 'none',
		outline: 'none',
		color: '#fab387',
		fontFamily: 'monospace',
		fontSize: 12,
		width: w,
		padding: '2px 4px',
	});

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			{/* Header */}
			<Stack
				direction='row'
				justifyContent='space-between'
				alignItems='center'
				sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${gray40}`, flexShrink: 0 }}
			>
				<Box component='span' sx={{ color: '#89b4fa', fontFamily: 'monospace', fontSize: 12 }}>
					node
				</Box>
				<IconButton size='small' onClick={onClose} sx={{ p: 0.25 }}>
					<X size={14} />
				</IconButton>
			</Stack>

			{/* JSON fields */}
			<Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
				<JsonField label='label'>
					<input
						value={data.label}
						onChange={(e) => {
							const v = e.target.value;
							setData('label', v);
							onChange({ ...uiJson, type: toCamelCase(v), data: { ...data, label: v } });
						}}
						style={{ ...inp(140), color: '#cdd6f4' }}
					/>
				</JsonField>

				<JsonField label='colorType'>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
						<Box
							sx={{
								width: 10,
								height: 10,
								borderRadius: '50%',
								bgcolor: (colorTypes[data.colorType] as string) ?? '#555',
								flexShrink: 0,
							}}
						/>
						<Box component='span' sx={{ color: '#a6e3a1', fontFamily: 'monospace', fontSize: 12 }}>
							"{data.colorType}"
						</Box>
						<Button size='small' onClick={() => setColorModalOpen(true)} sx={{ minWidth: 20, p: 0.25, color: '#cdd6f4', fontSize: 11 }}>
							✎
						</Button>
					</Box>
				</JsonField>

				<JsonField label='width'>
					<NumInput value={uiJson.width} onChange={(v) => onChange({ ...uiJson, width: v })} integer style={inp(60)} />
				</JsonField>

				<JsonField label='height'>
					<NumInput value={uiJson.height} onChange={(v) => onChange({ ...uiJson, height: v })} integer style={inp(60)} />
				</JsonField>

				<JsonField label='type'>
					<input
						value={uiJson.type}
						onChange={(e) => onChange({ ...uiJson, type: e.target.value })}
						style={{ ...inp(140), color: '#cdd6f4' }}
					/>
					<Box component='span' sx={{ color: greyColor(60), fontFamily: 'monospace', fontSize: 10, ml: 1, opacity: 0.5 }}>
						auto: {toCamelCase(data.label)}
					</Box>
				</JsonField>

				<JsonField label='position'>
					<Box
						component='span'
						sx={{ color: greyColor(60), fontFamily: 'monospace', fontSize: 12 }}
					>{`{ x: ${uiJson.position.x}, y: ${uiJson.position.y} }`}</Box>
				</JsonField>

				{/* output — modal picker */}
				<JsonField label='output'>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
						{data.output?.sourceProperty ? (
							<Box>
								<Box component='span' sx={{ color: '#89b4fa', fontFamily: 'monospace', fontSize: 12 }}>
									{'{'}
								</Box>
								<Box component='span' sx={{ color: '#89b4fa', fontFamily: 'monospace', fontSize: 12, ml: 0.5 }}>
									sourceProperty
								</Box>
								<Box component='span' sx={{ color: gray40, mx: 0.5 }}>
									:
								</Box>
								<Box component='span' sx={{ color: '#a6e3a1', fontFamily: 'monospace', fontSize: 12 }}>
									"{data.output.sourceProperty}"
								</Box>
								<Box component='span' sx={{ color: '#89b4fa', fontFamily: 'monospace', fontSize: 12 }}>
									{'}'}
								</Box>
							</Box>
						) : (
							<Box component='span' sx={{ color: greyColor(60), fontFamily: 'monospace', fontSize: 12, fontStyle: 'italic' }}>
								{'{}'}
							</Box>
						)}
						<Button size='small' onClick={() => setOutputModalOpen(true)} sx={{ minWidth: 20, p: 0.25, color: '#cdd6f4', fontSize: 11 }}>
							✎
						</Button>
					</Box>
				</JsonField>
			</Box>

			{/* Color picker modal */}
			{colorModalOpen && (
				<Box sx={{ position: 'fixed', inset: 0, bgcolor: 'rgba(0,0,0,0.5)', zIndex: 9999 }} onClick={() => setColorModalOpen(false)}>
					<Box
						sx={{
							position: 'absolute',
							top: '50%',
							left: '50%',
							transform: 'translate(-50%, -50%)',
							bgcolor: greyColor(15),
							border: `1px solid ${gray40}`,
							borderRadius: 2,
							p: 2,
							minWidth: 280,
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<Typography variant='caption' fontWeight={600} sx={{ fontSize: 12, mb: 1, display: 'block' }}>
							colorType:
						</Typography>
						<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
							{colorTypeKeys.map((k) => (
								<Chip
									key={k}
									label={k}
									size='small'
									color={data.colorType === k ? 'primary' : 'default'}
									onClick={() => {
										setData('colorType', k);
										setColorModalOpen(false);
									}}
									sx={{ cursor: 'pointer', fontSize: 10 }}
								/>
							))}
						</Box>
					</Box>
				</Box>
			)}

			{/* Output source picker modal */}
			{outputModalOpen && (
				<Box sx={{ position: 'fixed', inset: 0, bgcolor: 'rgba(0,0,0,0.5)', zIndex: 9999 }} onClick={() => setOutputModalOpen(false)}>
					<Box
						sx={{
							position: 'absolute',
							top: '50%',
							left: '50%',
							transform: 'translate(-50%, -50%)',
							bgcolor: greyColor(15),
							border: `1px solid ${gray40}`,
							borderRadius: 2,
							p: 2,
							minWidth: 280,
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<Typography variant='caption' fontWeight={600} sx={{ fontSize: 12, mb: 1, display: 'block' }}>
							output.sourceProperty:
						</Typography>
						<Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
							{props.map((p) => (
								<Box
									key={p.id}
									onClick={() => {
										setData('output', { sourceProperty: p.id });
										setOutputModalOpen(false);
									}}
									sx={{
										px: 1,
										py: 0.5,
										cursor: 'pointer',
										borderRadius: 0.5,
										fontSize: 12,
										fontFamily: 'monospace',
										bgcolor: data.output?.sourceProperty === p.id ? 'rgba(144,202,249,0.15)' : 'transparent',
										border: `1px solid ${data.output?.sourceProperty === p.id ? '#90caf9' : gray40}`,
										'&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
									}}
								>
									{p.id}
								</Box>
							))}
							{props.length === 0 && (
								<Typography variant='caption' sx={{ opacity: 0.4 }}>
									нет параметров
								</Typography>
							)}
						</Box>
						{data.output?.sourceProperty && (
							<Button
								size='small'
								onClick={() => {
									setData('output', undefined);
									setOutputModalOpen(false);
								}}
								sx={{ fontSize: 10 }}
							>
								Сбросить
							</Button>
						)}
					</Box>
				</Box>
			)}
		</Box>
	);
}
