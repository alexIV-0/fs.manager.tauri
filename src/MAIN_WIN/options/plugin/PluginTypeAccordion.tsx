// PluginTypeAccordion.tsx
//
// Аккордеон одного типа нод в списке плагинов. Оформление намеренно
// повторяет заголовки групп в боковой панели нодового редактора
// (`NODE_WIN/layout/SidebarAccordion.tsx`): цветная плашка, полоса слева,
// имя типа капсом и счётчик справа.

import React from 'react';
import { Box, Collapse, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ChevronDown, ChevronRight } from 'lucide-react';

/** Полупрозрачная плашка от цвета типа. Цвета в typeOfNodes_store хранятся как
 *  `#rrggbbaa` или `rgb(...)` — простая склейка с '33' на них не работает. */
const tint = (color: string, value: number): string => {
	try {
		return alpha(color, value);
	} catch {
		return 'transparent';
	}
};

interface Props {
	nodeType: string;
	color: string;
	/** Сколько плагинов внутри (версии одного плагина считаются за один). */
	count: number;
	open: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}

export const PluginTypeAccordion: React.FC<Props> = ({ nodeType, color, count, open, onToggle, children }) => (
	<Box>
		{/* Заголовок типа */}
		<Stack
			direction='row'
			alignItems='center'
			gap={0.5}
			px={1}
			py={0.5}
			sx={{
				cursor: 'pointer',
				borderRadius: '4px',
				backgroundColor: tint(color, 0.2),
				borderLeft: `3px solid ${color}`,
				userSelect: 'none',
				'&:hover': { backgroundColor: tint(color, 0.33) },
			}}
			onClick={onToggle}
		>
			{open ? <ChevronDown size={16} color={color} /> : <ChevronRight size={16} color={color} />}
			<Typography fontSize={12} fontWeight={600} color={color} textTransform='uppercase'>
				{nodeType}
			</Typography>
			<Typography fontSize={11} sx={{ opacity: 0.5, ml: 'auto' }}>
				{count}
			</Typography>
		</Stack>

		{/* Плагины типа */}
		<Collapse in={open} timeout='auto'>
			<Stack direction='column' gap={0.1} pt={0.5} pb={0.5} pl={0.5}>
				{children}
			</Stack>
		</Collapse>
	</Box>
);
