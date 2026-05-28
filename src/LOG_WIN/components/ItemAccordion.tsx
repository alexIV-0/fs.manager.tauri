import React from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Chip, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { AlertCircle, CheckCircle, ChevronDown, Clock, Loader, X } from 'lucide-react';
import type { ProcessingItemGroup, SourceFilter } from '../types';
import { effectiveCounts, fmtCost, progress } from '../utils';
import { useStepElapsed } from '../hooks';
import { LogLine } from './LogLine';
import { StepRow } from './StepRow';
import { StepSquare } from './StepSquare';

interface ItemAccordionProps {
	group: ProcessingItemGroup;
	expanded: boolean;
	onToggle: () => void;
	levelFilter: Set<string>;
	sourceFilter: SourceFilter;
	search: string;
}

export const ItemAccordion = React.memo(function ItemAccordion({
	group,
	expanded,
	onToggle,
	levelFilter,
	sourceFilter,
	search,
}: ItemAccordionProps) {
	const isRunning = group.status === 'running';
	const isQueued = group.status === 'queued';
	const pct = progress(group.steps);
	const time = useStepElapsed(group.steps, isRunning);

	const { errors: effErrors, warns: effWarns } = effectiveCounts(group);
	const hasError = effErrors > 0;
	const borderColor = hasError
		? 'rgba(248,81,73,0.4)'
		: isRunning
			? 'rgba(88,166,255,0.25)'
			: isQueued
				? 'rgba(139,148,158,0.25)'
				: 'divider';

	const stepSquares = group.steps.map((s) => (
		<Tooltip key={s.stepId} title={`${s.label}: ${s.status}`}>
			<Box sx={{ cursor: 'default' }}>
				<StepSquare status={s.status} />
			</Box>
		</Tooltip>
	));

	// логи item-уровня без stepId
	const itemLevelLogs = (group.itemLogs ?? []).filter(
		(e) =>
			levelFilter.has(e.level) &&
			(sourceFilter === 'all' || e.source === sourceFilter) &&
			(!search || e.message.toLowerCase().includes(search.toLowerCase())),
	);

	return (
		<Accordion
			disableGutters
			elevation={0}
			expanded={expanded}
			onChange={onToggle}
			// unmountOnExit: пока item свёрнут, его логи НЕ висят в DOM. Это главное лекарство
			// от зависания — рендерятся только строки логов раскрытых элементов.
			slotProps={{ transition: { unmountOnExit: true } }}
			sx={{
				border: '1px solid',
				borderColor,
				'&:not(:last-child)': { borderBottom: 0 },
				'&::before': { display: 'none' },
				ml: 0,
			}}
		>
			<AccordionSummary
				expandIcon={<ChevronDown size={14} />}
				sx={{
					flexDirection: 'row-reverse',
					minHeight: 34,
					bgcolor: hasError
						? 'rgba(248,81,73,0.06)'
						: isRunning
							? 'rgba(88,166,255,0.04)'
							: isQueued
								? 'rgba(139,148,158,0.04)'
								: 'background.paper',
					'& .MuiAccordionSummary-content': { alignItems: 'center', gap: 1, ml: 0.75, overflow: 'hidden' },
				}}
			>
				{isRunning ? (
					<Loader size={13} style={{ color: '#58a6ff', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
				) : isQueued ? (
					<Clock size={13} style={{ color: '#8b949e', flexShrink: 0 }} />
				) : hasError ? (
					<AlertCircle size={13} style={{ color: '#f85149', flexShrink: 0 }} />
				) : group.status === 'aborted' ? (
					<X size={13} style={{ color: '#8b949e', flexShrink: 0 }} />
				) : (
					<CheckCircle size={13} style={{ color: '#3fb950', flexShrink: 0 }} />
				)}

				<Typography noWrap sx={{ fontFamily: 'Consolas, monospace', fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0 }}>
					{group.itemName}
				</Typography>

				<Stack direction='row' spacing={0.25} sx={{ flexShrink: 0 }}>
					{stepSquares}
				</Stack>

				{group.steps.length > 0 && (
					<Box sx={{ width: 60, flexShrink: 0 }}>
						<LinearProgress
							variant='determinate'
							value={pct}
							sx={{
								height: 4,
								borderRadius: 2,
								bgcolor: 'rgba(255,255,255,0.08)',
								'& .MuiLinearProgress-bar': {
									bgcolor: hasError ? '#f85149' : isRunning ? '#58a6ff' : '#3fb950',
								},
							}}
						/>
					</Box>
				)}

				{group.steps.length > 0 && (
					<Typography sx={{ fontSize: 10, color: 'text.disabled', minWidth: 28, textAlign: 'right' }}>{pct}%</Typography>
				)}

				<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, color: 'text.disabled', flexShrink: 0 }}>
					<Clock size={10} />
					<Typography sx={{ fontSize: 10, fontFamily: 'Consolas, monospace' }}>{time}</Typography>
				</Box>

				{group.totalCost !== undefined && (
					<Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
						<Typography sx={{ fontSize: 10, fontFamily: 'Consolas, monospace', fontWeight: 600, color: '#3fb950' }}>
							{fmtCost(group.totalCost)}
						</Typography>
					</Box>
				)}

				{hasError && (
					<Chip
						label={effErrors}
						size='small'
						sx={{ height: 16, fontSize: 10, bgcolor: 'rgba(248,81,73,0.2)', color: '#f85149', flexShrink: 0 }}
					/>
				)}
				{effWarns > 0 && (
					<Chip
						label={effWarns}
						size='small'
						sx={{ height: 16, fontSize: 10, bgcolor: 'rgba(210,153,34,0.2)', color: '#d29922', flexShrink: 0 }}
					/>
				)}
			</AccordionSummary>

			<AccordionDetails
				sx={{
					p: '6px 8px',
					borderTop: '1px solid',
					borderColor: 'divider',
					bgcolor: 'background.default',
				}}
			>
				{/* Логи item-уровня (без stepId) */}
				{itemLevelLogs.length > 0 && (
					<Box sx={{ mb: 0.5 }}>
						{itemLevelLogs.map((e) => (
							<LogLine key={e.id} entry={e} />
						))}
					</Box>
				)}

				{group.steps.length === 0 ? (
					<Typography variant='caption' sx={{ color: 'text.disabled' }}>
						Шаги не определены
					</Typography>
				) : (
					group.steps.map((step) => (
						<StepRow key={step.stepId} step={step} levelFilter={levelFilter} sourceFilter={sourceFilter} search={search} />
					))
				)}
			</AccordionDetails>
		</Accordion>
	);
});
