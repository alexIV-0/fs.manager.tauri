import { useState } from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import type { ProcessingItemGroup, SourceFilter } from '../types';
import { effectiveCounts } from '../utils';
import { ItemAccordion } from './ItemAccordion';

interface ProjectGroupProps {
	projectName: string;
	items: ProcessingItemGroup[];
	expandedItems: Set<string>;
	onToggleItem: (id: string) => void;
	levelFilter: Set<string>;
	sourceFilter: SourceFilter;
	search: string;
}

export function ProjectGroup({ projectName, items, expandedItems, onToggleItem, levelFilter, sourceFilter, search }: ProjectGroupProps) {
	const [open, setOpen] = useState(true);
	const itemsWithErrors = items.filter((g) => effectiveCounts(g).errors > 0);
	const hasError = itemsWithErrors.length > 0;
	const isRunning = items.some((g) => g.status === 'running');

	return (
		<Box sx={{ mb: '1px' }}>
			{/* Заголовок проекта */}
			<Box
				onClick={() => setOpen((v) => !v)}
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: 0.75,
					p: '6px 5px 6px 10px',
					cursor: 'pointer',
					bgcolor: 'rgba(255,255,255,0.03)',
					borderBottom: '1px solid',
					borderColor: 'divider',
					'&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
				}}
			>
				{' '}
				├
				<Folder size={14} style={{ color: isRunning ? '#58a6ff' : hasError ? '#f85149' : '#8b949e', flexShrink: 0 }} />
				<Typography sx={{ fontFamily: 'Consolas, monospace', fontSize: 15, fontWeight: 600, color: 'text.secondary', flex: 1 }}>
					{projectName}
				</Typography>
				<Chip label={items.length} size='small' sx={{ height: 16, fontSize: 10 }} />
				{hasError && (
					<Chip
						label={`${itemsWithErrors.length} err`}
						size='small'
						sx={{ height: 16, fontSize: 10, bgcolor: 'rgba(248,81,73,0.2)', color: '#f85149' }}
					/>
				)}
				{open ? (
					<ChevronDown size={12} style={{ color: '#666', flexShrink: 0 }} />
				) : (
					<ChevronRight size={12} style={{ color: '#666', flexShrink: 0 }} />
				)}
			</Box>

			{open && (
				<Box sx={{ pl: 2 }}>
					{items.map((g) => (
						<ItemAccordion
							key={g.itemId}
							group={g}
							expanded={expandedItems.has(g.itemId)}
							onToggle={() => onToggleItem(g.itemId)}
							levelFilter={levelFilter}
							sourceFilter={sourceFilter}
							search={search}
						/>
					))}
				</Box>
			)}
		</Box>
	);
}
