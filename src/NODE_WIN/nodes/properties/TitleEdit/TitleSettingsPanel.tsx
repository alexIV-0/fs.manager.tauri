// src/NODE_WIN/nodes/properties/TitleEdit/TitleSettingsPanel.tsx

import { useState, useCallback } from 'react';
import { Box } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { TitleFormatSettings } from './types';
import { TextSection } from './sections/TextSection';
import { PositionSection } from './sections/PositionSection';
import { BackgroundSection } from './sections/BackgroundSection';
import { OutlineSection } from './sections/OutlineSection';
import { ShadowSection } from './sections/ShadowSection';
import { AnimationSection } from './sections/AnimationSection';

type SectionKey = 'text' | 'position' | 'background' | 'outline' | 'shadow' | 'animation';

const DEFAULT_EXPANDED: SectionKey[] = ['text', 'position'];

interface TitleSettingsPanelProps {
	settings: TitleFormatSettings;
	onChange: (settings: TitleFormatSettings) => void;
	width: number;
}

export default function TitleSettingsPanel({ settings, onChange, width }: TitleSettingsPanelProps) {
	const [expanded, setExpanded] = useState<SectionKey[]>(DEFAULT_EXPANDED);

	const toggle = useCallback((key: SectionKey) => {
		setExpanded((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
	}, []);

	const isOpen = (key: SectionKey) => expanded.includes(key);

	return (
		<Box
			sx={{
				width,
				height: '100%',
				overflowY: 'auto',
				overflowX: 'hidden',
				p: 1,
				boxSizing: 'border-box',
				borderLeft: `1px solid ${greyColor(25)}`,
				'&::-webkit-scrollbar': { width: 6 },
				'&::-webkit-scrollbar-thumb': {
					backgroundColor: greyColor(30),
					borderRadius: 3,
				},
			}}
		>
			<TextSection settings={settings} expanded={isOpen('text')} onToggle={() => toggle('text')} onChange={onChange} />
			<PositionSection settings={settings} expanded={isOpen('position')} onToggle={() => toggle('position')} onChange={onChange} />
			<BackgroundSection settings={settings} expanded={isOpen('background')} onToggle={() => toggle('background')} onChange={onChange} />
			<OutlineSection settings={settings} expanded={isOpen('outline')} onToggle={() => toggle('outline')} onChange={onChange} />
			<ShadowSection settings={settings} expanded={isOpen('shadow')} onToggle={() => toggle('shadow')} onChange={onChange} />
			<AnimationSection settings={settings} expanded={isOpen('animation')} onToggle={() => toggle('animation')} onChange={onChange} />
		</Box>
	);
}
