// src/NODE_WIN/nodes/properties/TitleEdit/sections/ShadowSection.tsx

import { memo, useCallback } from 'react';
import { FormControlLabel, Switch, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { SectionAccordion, ColorRow, SliderRow } from './SectionUI';
import { SectionProps } from './sectionTypes';

export const ShadowSection = memo(function ShadowSection({ settings, expanded, onToggle, onChange }: SectionProps) {
	const labelColor = greyColor(55);

	const update = useCallback(
		(key: string, value: any) => {
			onChange({ ...settings, shadow: { ...settings.shadow, [key]: value } });
		},
		[settings, onChange],
	);

	return (
		<SectionAccordion title='Shadow' expanded={expanded} onToggle={onToggle}>
			<FormControlLabel
				control={<Switch size='small' checked={settings.shadow.enabled} onChange={(e) => update('enabled', e.target.checked)} />}
				label={
					<Typography fontSize={11} color={labelColor}>
						Enabled
					</Typography>
				}
				sx={{ mb: 1 }}
			/>

			<ColorRow label='Color' value={settings.shadow.color} onChange={(v) => update('color', v)} />

			<SliderRow label='Offset X px' value={settings.shadow.offsetX} min={-20} max={20} onChange={(v) => update('offsetX', v)} />

			<SliderRow label='Offset Y px' value={settings.shadow.offsetY} min={-20} max={20} onChange={(v) => update('offsetY', v)} />

			<SliderRow label='Blur px' value={settings.shadow.blur} min={0} max={30} onChange={(v) => update('blur', v)} />
		</SectionAccordion>
	);
});
