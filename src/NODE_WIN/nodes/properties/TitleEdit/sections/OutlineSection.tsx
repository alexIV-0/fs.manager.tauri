// src/NODE_WIN/nodes/properties/TitleEdit/sections/OutlineSection.tsx

import { memo, useCallback } from 'react';
import { FormControlLabel, Switch, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { SectionAccordion, ColorRow, SliderRow } from './SectionUI';
import { SectionProps } from './sectionTypes';

export const OutlineSection = memo(function OutlineSection({ settings, expanded, onToggle, onChange }: SectionProps) {
	const labelColor = greyColor(55);

	const update = useCallback(
		(key: string, value: any) => {
			onChange({ ...settings, outline: { ...settings.outline, [key]: value } });
		},
		[settings, onChange],
	);

	return (
		<SectionAccordion title='Outline' expanded={expanded} onToggle={onToggle}>
			<FormControlLabel
				control={<Switch size='small' checked={settings.outline.enabled} onChange={(e) => update('enabled', e.target.checked)} />}
				label={
					<Typography fontSize={11} color={labelColor}>
						Enabled
					</Typography>
				}
				sx={{ mb: 1 }}
			/>

			<ColorRow label='Color' value={settings.outline.color} onChange={(v) => update('color', v)} />

			<SliderRow label='Width px' value={settings.outline.width} min={1} max={20} onChange={(v) => update('width', v)} />
		</SectionAccordion>
	);
});
