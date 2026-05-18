// src/NODE_WIN/nodes/properties/TitleEdit/sections/PositionSection.tsx

import { memo, useCallback } from 'react';
import { Select, MenuItem } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { SectionAccordion, Row, SliderRow } from './SectionUI';
import { SectionProps } from './sectionTypes';
import { H_ALIGN_OPTIONS, V_ALIGN_OPTIONS } from '../constants';

export const PositionSection = memo(function PositionSection({ settings, expanded, onToggle, onChange }: SectionProps) {
	const border = greyColor(25);
	const bg = greyColor(15);
	const defColor = greyColor(80);

	const update = useCallback(
		(key: string, value: any) => {
			onChange({ ...settings, position: { ...settings.position, [key]: value } });
		},
		[settings, onChange],
	);

	const selectSx = {
		fontSize: 12,
		color: defColor,
		'& .MuiOutlinedInput-notchedOutline': { borderColor: border },
		'&:hover .MuiOutlinedInput-notchedOutline': { borderColor: greyColor(50) },
		'& .MuiSelect-select': { py: '4px', px: '8px' },
	};

	const menuProps = {
		disablePortal: false,
		style: { zIndex: 10001 },
		PaperProps: { style: { backgroundColor: bg } },
	};

	return (
		<SectionAccordion title='Position' expanded={expanded} onToggle={onToggle}>
			<SliderRow label='X %' value={settings.position.x} min={0} max={100} onChange={(v) => update('x', v)} />

			<SliderRow label='Y %' value={settings.position.y} min={0} max={100} onChange={(v) => update('y', v)} />

			<Row label='Horizontal Align'>
				<Select
					fullWidth
					size='small'
					value={settings.position.hAlign}
					onChange={(e) => update('hAlign', e.target.value)}
					sx={selectSx}
					MenuProps={menuProps}
				>
					{H_ALIGN_OPTIONS.map((o) => (
						<MenuItem key={o.value} value={o.value} sx={{ fontSize: 12, color: defColor }}>
							{o.label}
						</MenuItem>
					))}
				</Select>
			</Row>

			<Row label='Vertical Align'>
				<Select
					fullWidth
					size='small'
					value={settings.position.vAlign}
					onChange={(e) => update('vAlign', e.target.value)}
					sx={selectSx}
					MenuProps={menuProps}
				>
					{V_ALIGN_OPTIONS.map((o) => (
						<MenuItem key={o.value} value={o.value} sx={{ fontSize: 12, color: defColor }}>
							{o.label}
						</MenuItem>
					))}
				</Select>
			</Row>

			<SliderRow label='Padding px' value={settings.position.padding} min={0} max={100} onChange={(v) => update('padding', v)} />
		</SectionAccordion>
	);
});
