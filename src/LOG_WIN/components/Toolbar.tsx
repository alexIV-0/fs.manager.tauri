import { Box, Chip, IconButton, InputAdornment, Stack, TextField, Tooltip } from '@mui/material';
import { AlertTriangle, Download, RefreshCw, Search, Trash2, X } from 'lucide-react';
import type { SourceFilter, TabKey } from '../types';
import { LEVELS } from '../utils';

interface ToolbarProps {
	stats: { total: number; running: number; errorItems: number };
	sourceFilter: SourceFilter;
	setSourceFilter: (s: SourceFilter) => void;
	levelFilter: Set<string>;
	onToggleLevel: (key: string) => void;
	search: string;
	setSearch: (s: string) => void;
	errorsOnly: boolean;
	setErrorsOnly: (v: boolean | ((prev: boolean) => boolean)) => void;
	tab: TabKey;
	onLoadArchiveDays: () => void;
	onClearArchive: () => void;
}

export function Toolbar({
	stats,
	sourceFilter,
	setSourceFilter,
	levelFilter,
	onToggleLevel,
	search,
	setSearch,
	errorsOnly,
	setErrorsOnly,
	tab,
	onLoadArchiveDays,
	onClearArchive,
}: ToolbarProps) {
	const api = (window as any).electronAPI;
	return (
		<Box sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
			<Stack direction='row' alignItems='center' spacing={0.75} flexWrap='nowrap'>
				<Chip label={`Всего: ${stats.total}`} size='small' variant='outlined' sx={{ fontSize: 11, height: 22, flexShrink: 0 }} />
				{stats.running > 0 && (
					<Chip
						label={`▶ ${stats.running}`}
						size='small'
						sx={{ fontSize: 11, height: 22, flexShrink: 0, bgcolor: 'rgba(88,166,255,0.15)', color: '#58a6ff' }}
					/>
				)}
				{stats.errorItems > 0 && (
					<Chip
						label={`✕ ${stats.errorItems}`}
						size='small'
						sx={{ fontSize: 11, height: 22, flexShrink: 0, bgcolor: 'rgba(248,81,73,0.15)', color: '#f85149' }}
					/>
				)}

				<Box sx={{ borderLeft: '1px solid', borderColor: 'divider', height: 16, mx: 0.25, flexShrink: 0 }} />

				{(['all', 'main', 'renderer'] as const).map((s) => (
					<Chip
						key={s}
						label={s === 'all' ? 'Все' : s}
						size='small'
						onClick={() => setSourceFilter(s)}
						variant={sourceFilter === s ? 'filled' : 'outlined'}
						sx={{ height: 22, fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
					/>
				))}

				<Box sx={{ borderLeft: '1px solid', borderColor: 'divider', height: 16, mx: 0.25, flexShrink: 0 }} />

				{LEVELS.map(({ key, label, color }) => (
					<Chip
						key={key}
						label={label}
						size='small'
						onClick={() => onToggleLevel(key)}
						sx={{
							height: 22,
							fontSize: 11,
							cursor: 'pointer',
							flexShrink: 0,
							opacity: levelFilter.has(key) ? 1 : 0.3,
							bgcolor: levelFilter.has(key) ? `${color}22` : 'transparent',
							color,
							border: `1px solid ${color}44`,
						}}
					/>
				))}

				<TextField
					size='small'
					placeholder='Поиск...'
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					sx={{ flex: 1, minWidth: 100 }}
					slotProps={{
						input: {
							startAdornment: (
								<InputAdornment position='start'>
									<Search size={13} />
								</InputAdornment>
							),
							endAdornment: search ? (
								<InputAdornment position='end'>
									<IconButton size='small' onClick={() => setSearch('')}>
										<X size={11} />
									</IconButton>
								</InputAdornment>
							) : null,
							sx: { fontSize: 12, height: 28 },
						},
					}}
				/>

				<Box sx={{ borderLeft: '1px solid', borderColor: 'divider', height: 16, mx: 0.25, flexShrink: 0 }} />

				<Tooltip title='Только с ошибками'>
					<IconButton
						size='small'
						onClick={() => setErrorsOnly((v) => !v)}
						sx={{ color: errorsOnly ? '#f85149' : 'text.secondary', flexShrink: 0 }}
					>
						<AlertTriangle size={15} />
					</IconButton>
				</Tooltip>
				<Tooltip title='Экспорт TXT'>
					<IconButton size='small' onClick={() => api.invoke('log-window:export', 'txt')} sx={{ color: 'text.secondary', flexShrink: 0 }}>
						<Download size={15} />
					</IconButton>
				</Tooltip>
				<Tooltip title='Экспорт JSON'>
					<IconButton size='small' onClick={() => api.invoke('log-window:export', 'json')} sx={{ color: 'text.secondary', flexShrink: 0 }}>
						<Download size={15} />
					</IconButton>
				</Tooltip>
				{tab === 'live' ? (
					<Tooltip title='Очистить текущие'>
						<IconButton size='small' onClick={() => api.invoke('log-window:clear')} sx={{ color: 'text.secondary', flexShrink: 0 }}>
							<Trash2 size={15} />
						</IconButton>
					</Tooltip>
				) : (
					<>
						<Tooltip title='Обновить список дней'>
							<IconButton size='small' onClick={onLoadArchiveDays} sx={{ color: 'text.secondary', flexShrink: 0 }}>
								<RefreshCw size={15} />
							</IconButton>
						</Tooltip>
						<Tooltip title='Очистить весь архив'>
							<IconButton size='small' onClick={onClearArchive} sx={{ color: 'text.secondary', flexShrink: 0 }}>
								<Trash2 size={15} />
							</IconButton>
						</Tooltip>
					</>
				)}
			</Stack>
		</Box>
	);
}
