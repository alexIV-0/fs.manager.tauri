import { Box, Typography } from '@mui/material';
import { Inbox, Loader, Zap } from 'lucide-react';
import type { ProcessingItemGroup, SourceFilter } from '../types';
import { MainFolderGroup } from './MainFolderGroup';
import { EmptyState, SectionHeader } from './SectionHeader';

interface LiveViewProps {
	items: ProcessingItemGroup[];
	activeItems: ProcessingItemGroup[];
	sessionDoneItems: ProcessingItemGroup[];
	activeHierarchy: Map<string, Map<string, ProcessingItemGroup[]>>;
	sessionDoneHierarchy: Map<string, Map<string, ProcessingItemGroup[]>>;
	expanded: Set<string>;
	onToggleExpand: (id: string) => void;
	levelFilter: Set<string>;
	sourceFilter: SourceFilter;
	search: string;
}

export function LiveView({
	items,
	activeItems,
	sessionDoneItems,
	activeHierarchy,
	sessionDoneHierarchy,
	expanded,
	onToggleExpand,
	levelFilter,
	sourceFilter,
	search,
}: LiveViewProps) {
	if (items.length === 0) {
		return (
			<Box
				sx={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					height: '100%',
					gap: 1,
					color: 'text.disabled',
				}}
			>
				<Zap size={36} style={{ opacity: 0.2 }} />
				<Typography variant='body2'>Запустите обработку — логи появятся здесь</Typography>
			</Box>
		);
	}

	const renderHierarchy = (hierarchy: Map<string, Map<string, ProcessingItemGroup[]>>) =>
		Array.from(hierarchy.entries()).map(([mf, projects]) => (
			<MainFolderGroup
				key={mf}
				mainFolderName={mf}
				projects={projects}
				expandedItems={expanded}
				onToggleItem={onToggleExpand}
				levelFilter={levelFilter}
				sourceFilter={sourceFilter}
				search={search}
			/>
		));

	return (
		<Box sx={{ p: 1 }}>
			<SectionHeader
				icon={<Loader size={13} style={{ color: '#58a6ff', animation: activeItems.length > 0 ? 'spin 1s linear infinite' : undefined }} />}
				title='В обработке'
				count={activeItems.length}
			/>
			{activeItems.length === 0 ? (
				<EmptyState text='Нет активных задач' />
			) : (
				<Box sx={{ mt: 0.5, mb: 1 }}>{renderHierarchy(activeHierarchy)}</Box>
			)}

			<SectionHeader icon={<Inbox size={13} style={{ color: '#8b949e' }} />} title='Завершено (сессия)' count={sessionDoneItems.length} />
			{sessionDoneItems.length === 0 ? (
				<EmptyState text='Завершённые задачи появятся здесь, полная история — во вкладке «Архив»' />
			) : (
				<Box sx={{ mt: 0.5 }}>{renderHierarchy(sessionDoneHierarchy)}</Box>
			)}
		</Box>
	);
}
