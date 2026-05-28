import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import { Archive, CalendarDays } from 'lucide-react';
import type { ArchiveDay, ProcessingItemGroup, SourceFilter } from '../types';
import { fmtBytes } from '../utils';
import { MainFolderGroup } from './MainFolderGroup';
import { EmptyState } from './SectionHeader';

interface ArchiveViewProps {
	archiveDays: ArchiveDay[];
	archiveDate: string | null;
	archiveLoading: boolean;
	archiveVisibleItems: ProcessingItemGroup[];
	archiveFileHierarchy: Map<string, Map<string, ProcessingItemGroup[]>>;
	archiveExpanded: Set<string>;
	onOpenDay: (date: string) => void;
	onToggleExpand: (id: string) => void;
	levelFilter: Set<string>;
	sourceFilter: SourceFilter;
	search: string;
}

export function ArchiveView({
	archiveDays,
	archiveDate,
	archiveLoading,
	archiveVisibleItems,
	archiveFileHierarchy,
	archiveExpanded,
	onOpenDay,
	onToggleExpand,
	levelFilter,
	sourceFilter,
	search,
}: ArchiveViewProps) {
	if (archiveDays.length === 0) {
		return (
			<Box sx={{ p: 1 }}>
				<Box
					sx={{
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						justifyContent: 'center',
						gap: 1,
						color: 'text.disabled',
						py: 6,
					}}
				>
					<Archive size={36} style={{ opacity: 0.2 }} />
					<Typography variant='body2'>Архив пуст — завершённые обработки сохраняются сюда по дням</Typography>
				</Box>
			</Box>
		);
	}

	return (
		<Box sx={{ p: 1 }}>
			{/* Список дней */}
			<Stack direction='row' spacing={0.75} flexWrap='wrap' useFlexGap sx={{ mb: 1 }}>
				{archiveDays.map((d) => (
					<Chip
						key={d.date}
						icon={<CalendarDays size={13} />}
						label={`${d.date} · ${d.items} · ${fmtBytes(d.bytes)}`}
						size='small'
						onClick={() => onOpenDay(d.date)}
						variant={archiveDate === d.date ? 'filled' : 'outlined'}
						sx={{ fontSize: 11, height: 24, cursor: 'pointer' }}
					/>
				))}
			</Stack>

			{archiveLoading ? (
				<Box sx={{ px: 1 }}>
					<LinearProgress sx={{ height: 3 }} />
				</Box>
			) : archiveDate == null ? (
				<EmptyState text='Выберите день, чтобы открыть логи' />
			) : archiveVisibleItems.length === 0 ? (
				<EmptyState text='За этот день записей нет' />
			) : (
				<Box sx={{ mt: 0.5 }}>
					{Array.from(archiveFileHierarchy.entries()).map(([mf, projects]) => (
						<MainFolderGroup
							key={mf}
							mainFolderName={mf}
							projects={projects}
							expandedItems={archiveExpanded}
							onToggleItem={onToggleExpand}
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
