// src/NODE_WIN/nodes/properties/TitleEdit/sections/sectionTypes.ts

import { TitleFormatSettings } from '../types';

export interface SectionProps {
    settings: TitleFormatSettings;
    expanded: boolean;
    onToggle: () => void;
    onChange: (settings: TitleFormatSettings) => void;
}
