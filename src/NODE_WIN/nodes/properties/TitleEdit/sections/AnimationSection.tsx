// src/NODE_WIN/nodes/properties/TitleEdit/sections/AnimationSection.tsx

import { memo, useCallback } from 'react';
import { Select, MenuItem } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { SectionAccordion, Row, ColorRow, SliderRow } from './SectionUI';
import { SectionProps } from './sectionTypes';
import { ANIMATION_TYPES } from '../constants';

export const AnimationSection = memo(function AnimationSection({ settings, expanded, onToggle, onChange }: SectionProps) {
	const border = greyColor(25);
	const bg = greyColor(15);
	const defColor = greyColor(80);

	const update = useCallback(
		(key: string, value: any) => {
			onChange({ ...settings, animation: { ...settings.animation, [key]: value } });
		},
		[settings, onChange],
	);

	const hasAnimation = settings.animation.type !== 'none';

	return (
		<SectionAccordion title='Animation' expanded={expanded} onToggle={onToggle}>
			<Row label='Type'>
				<Select
					fullWidth
					size='small'
					value={settings.animation.type}
					onChange={(e) => update('type', e.target.value)}
					sx={{
						fontSize: 12,
						color: defColor,
						'& .MuiOutlinedInput-notchedOutline': { borderColor: border },
						'&:hover .MuiOutlinedInput-notchedOutline': { borderColor: greyColor(50) },
						'& .MuiSelect-select': { py: '4px', px: '8px' },
					}}
					MenuProps={{
						disablePortal: false,
						style: { zIndex: 10001 },
						PaperProps: { style: { backgroundColor: bg } },
					}}
				>
					{ANIMATION_TYPES.map((o) => (
						<MenuItem key={o.value} value={o.value} sx={{ fontSize: 12, color: defColor }}>
							{o.label}
						</MenuItem>
					))}
				</Select>
			</Row>

			{hasAnimation && (
				<>
					<ColorRow label='Word Color' value={settings.animation.wordColor} onChange={(v) => update('wordColor', v)} />

					<ColorRow label='Highlight Color' value={settings.animation.highlightColor} onChange={(v) => update('highlightColor', v)} />

					<SliderRow
						label='Fade Duration s'
						value={settings.animation.duration}
						min={0.05}
						max={1}
						step={0.05}
						onChange={(v) => update('duration', v)}
					/>
				</>
			)}
		</SectionAccordion>
	);
});
