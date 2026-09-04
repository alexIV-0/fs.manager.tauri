// src/NODE_WIN/nodes/properties/TitleEdit/sections/BackgroundSection.tsx

import { memo, useCallback } from 'react';
import { FormControlLabel, Switch, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { SectionAccordion, ColorRow, SliderRow } from './SectionUI';
import { SectionProps } from './sectionTypes';

export const BackgroundSection = memo(function BackgroundSection({ settings, expanded, onToggle, onChange }: SectionProps) {
	const labelColor = greyColor(55);

	const update = useCallback(
		(key: string, value: any) => {
			onChange({ ...settings, background: { ...settings.background, [key]: value } });
		},
		[settings, onChange],
	);

	return (
		<SectionAccordion title='Background' expanded={expanded} onToggle={onToggle}>
			<FormControlLabel
				control={<Switch size='small' checked={settings.background.enabled} onChange={(e) => update('enabled', e.target.checked)} />}
				label={
					<Typography fontSize={11} color={labelColor}>
						Enabled
					</Typography>
				}
				sx={{ mb: 1 }}
			/>

			<ColorRow label='Color' value={settings.background.color} onChange={(v) => update('color', v)} />

			<SliderRow
				label='Opacity %'
				value={Math.round(settings.background.opacity * 100)}
				min={0}
				max={100}
				onChange={(v) => update('opacity', v / 100)}
			/>

			{/* Отступы врозь: у титров запас по бокам и сверху-снизу почти всегда разный. */}
			<SliderRow
				label='Padding X px'
				value={settings.background.paddingX}
				min={0}
				max={120}
				onChange={(v) => update('paddingX', v)}
			/>

			<SliderRow
				label='Padding Y px'
				value={settings.background.paddingY}
				min={0}
				max={120}
				onChange={(v) => update('paddingY', v)}
			/>

			<SliderRow
				label='Border Radius px'
				value={settings.background.borderRadius}
				min={0}
				max={40}
				onChange={(v) => update('borderRadius', v)}
			/>
		</SectionAccordion>
	);
});
