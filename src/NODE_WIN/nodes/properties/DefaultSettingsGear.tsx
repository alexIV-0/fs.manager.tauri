import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { Box, Checkbox, FormControlLabel, IconButton, MenuItem, Popover, Select, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { Settings } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { CustomNodeData, Property } from '@/NODE_WIN/definitions/types';
import { greyColor } from '@/Store/Color/grayColor';

interface DefaultSettingsGearProps {
	property: Property;
}

/**
 * Шестерёнка «дефолтные настройки» рядом с tooltip.
 * Открывает попап с настройками уровня pluginBuilder, но для КОНКРЕТНОГО флоу
 * (per-flow override). Меняются только значения по умолчанию — имя/label здесь
 * не редактируется. Изменения пишутся в controlProps свойства → сохраняются в
 * options.json автоматически. Пока поддерживается только controlType==='valueRange'.
 */
export default function DefaultSettingsGear({ property }: DefaultSettingsGearProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

	const cp = property.controlProps as any;

	const setCp = useCallback(
		(patch: Record<string, unknown>) => {
			reactFlow.updateNode(nodeId, (node) => {
				const nodeData = node.data as CustomNodeData;
				const updatedProperties = nodeData.properties.map((p) =>
					p.id === property.id ? { ...p, controlProps: { ...p.controlProps, ...patch } } : p,
				) as Property[];
				return { ...node, data: { ...nodeData, properties: updatedProperties } };
			});
		},
		[nodeId, property.id, reactFlow],
	);

	// Пока шестерёнка осмысленна только для valueRange.
	if (property.controlType !== 'valueRange') return null;

	const range: [number, number] = Array.isArray(cp.range) ? cp.range : [0, 1440];

	return (
		<>
			<Tooltip title='Дефолтные настройки' placement='top' arrow>
				<IconButton
					disableRipple
					size='small'
					className='nodrag'
					onClick={(e) => setAnchorEl(e.currentTarget)}
					sx={{ width: 26, padding: 0, color: greyColor(45), '&:hover': { color: greyColor(75) } }}
				>
					<Settings size={17} strokeWidth={1.25} />
				</IconButton>
			</Tooltip>

			<Popover
				open={Boolean(anchorEl)}
				anchorEl={anchorEl}
				onClose={() => setAnchorEl(null)}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
				transformOrigin={{ vertical: 'top', horizontal: 'right' }}
				slotProps={{ paper: { className: 'nodrag', sx: { p: 1.5, width: 240, bgcolor: greyColor(12) } } }}
			>
				<Stack gap={1}>
					<Typography variant='caption' sx={{ color: greyColor(60), fontFamily: 'monospace' }}>
						// дефолтные настройки (для этого флоу)
					</Typography>

					<LabeledRow label='format'>
						<Select size='small' value={cp.format ?? 'timecode'} onChange={(e) => setCp({ format: e.target.value })} sx={selSx}>
							<MenuItem value='timecode'>timecode</MenuItem>
							<MenuItem value='float'>float</MenuItem>
							<MenuItem value='integer'>integer</MenuItem>
						</Select>
					</LabeledRow>

					<LabeledRow label='unit'>
						<Select size='small' value={cp.unit ?? 'minutes'} onChange={(e) => setCp({ unit: e.target.value })} sx={selSx}>
							<MenuItem value='minutes'>minutes</MenuItem>
							<MenuItem value='seconds'>seconds</MenuItem>
						</Select>
					</LabeledRow>

					<LabeledRow label='step'>
						<NumBox value={cp.step ?? 5} onChange={(v) => setCp({ step: v })} />
					</LabeledRow>

					<LabeledRow label='range'>
						<Stack direction='row' alignItems='center' gap={0.5}>
							<NumBox value={range[0]} onChange={(v) => setCp({ range: [v, range[1]] })} w={52} />
							<Box component='span' sx={{ color: greyColor(45), fontFamily: 'monospace' }}>
								…
							</Box>
							<NumBox value={range[1]} onChange={(v) => setCp({ range: [range[0], v] })} w={52} />
						</Stack>
					</LabeledRow>

					<LabeledRow label='decimals'>
						<NumBox value={cp.decimals ?? 2} onChange={(v) => setCp({ decimals: v })} />
					</LabeledRow>

					<FormControlLabel
						sx={{ ml: 0, gap: 0.5 }}
						control={
							<Checkbox
								size='small'
								checked={cp.allowManualOverride !== false}
								onChange={(e) => setCp({ allowManualOverride: e.target.checked })}
								sx={{ p: 0 }}
							/>
						}
						label={
							<Typography variant='caption' sx={{ color: greyColor(70), fontFamily: 'monospace' }}>
								allowManualOverride
							</Typography>
						}
					/>
				</Stack>
			</Popover>
		</>
	);
}

const selSx = { fontSize: 13, fontFamily: 'monospace', '& .MuiSelect-select': { py: 0.25 } } as const;

function LabeledRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Stack direction='row' alignItems='center' justifyContent='space-between' gap={1}>
			<Typography variant='caption' sx={{ color: greyColor(70), fontFamily: 'monospace' }}>
				{label}
			</Typography>
			{children}
		</Stack>
	);
}

function NumBox({ value, onChange, w = 60 }: { value: number; onChange: (v: number) => void; w?: number }) {
	return (
		<TextField
			size='small'
			type='number'
			value={value}
			onChange={(e) => {
				const n = Number(e.target.value);
				if (Number.isFinite(n)) onChange(n);
			}}
			sx={{ width: w, '& input': { py: 0.25, fontSize: 13, fontFamily: 'monospace', textAlign: 'center' } }}
		/>
	);
}
