import { useState } from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, Folder, Loader } from 'lucide-react';
import type { ProcessingItemGroup, SourceFilter } from '../types';
import { effectiveCounts } from '../utils';
import { ProjectGroup } from './ProjectGroup';

interface MainFolderGroupProps {
	mainFolderName: string;
	projects: Map<string, ProcessingItemGroup[]>;
	expandedItems: Set<string>;
	onToggleItem: (id: string) => void;
	levelFilter: Set<string>;
	sourceFilter: SourceFilter;
	search: string;
}

export function MainFolderGroup({ mainFolderName, projects, expandedItems, onToggleItem, levelFilter, sourceFilter, search }: MainFolderGroupProps) {
	const [open, setOpen] = useState(true);
	const allItems = Array.from(projects.values()).flat();
	const hasError = allItems.some((g) => effectiveCounts(g).errors > 0);
	const isRunning = allItems.some((g) => g.status === 'running');
	const total = allItems.length;
	const colorFill = isRunning ? '#58a6ff' : hasError ? '#f85149' : '#d29922';

	return (
		<Box sx={{ mb: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 0.5, overflow: 'hidden' }}>
			{/* Заголовок главной папки */}
			<Box
				onClick={() => setOpen((v) => !v)}
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: 0.75,

					p: '4px 6px 4px 8px',
					cursor: 'pointer',
					bgcolor: 'background.paper',
					'&:hover': { bgcolor: 'action.hover' },
				}}
			>
				<Folder
					size={16}
					style={{
						color: colorFill,
						flexShrink: 0,
						fill: colorFill,
						strokeWidth: 1,
					}}
				/>
				<Typography sx={{ fontFamily: 'Consolas, monospace', fontSize: 16, fontWeight: 700, color: 'text.primary', flex: 1 }}>
					{mainFolderName || '—'}
				</Typography>
				<Chip label={`${total} файл${total === 1 ? '' : 'а'}`} size='small' sx={{ height: 16, fontSize: 10 }} />
				{isRunning && <Loader size={12} style={{ color: '#58a6ff', animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
				{open ? <ChevronDown size={13} style={{ color: '#888' }} /> : <ChevronRight size={13} style={{ color: '#888' }} />}
			</Box>

			{open && (
				<Box>
					{Array.from(projects.entries()).map(([proj, items]) => (
						<ProjectGroup
							key={proj}
							projectName={proj}
							items={items}
							expandedItems={expandedItems}
							onToggleItem={onToggleItem}
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
