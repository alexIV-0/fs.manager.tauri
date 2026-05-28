import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SourceFilter, StepInfo } from '../types';
import { STEP_COLOR, elapsed, fmtCost } from '../utils';
import { LogLine } from './LogLine';
import { StepSquare } from './StepSquare';

interface StepRowProps {
	step: StepInfo;
	levelFilter: Set<string>;
	sourceFilter: SourceFilter;
	search: string;
}

export function StepRow({ step, levelFilter, sourceFilter, search }: StepRowProps) {
	const [open, setOpen] = useState(false);
	const color = STEP_COLOR[step.status];

	const filteredLogs = step.logs.filter(
		(e) =>
			levelFilter.has(e.level) &&
			(sourceFilter === 'all' || e.source === sourceFilter) &&
			(!search || e.message.toLowerCase().includes(search.toLowerCase())),
	);

	const subSteps = step.subSteps ?? [];
	const hasSubSteps = subSteps.length > 0;
	const expandable = filteredLogs.length > 0 || hasSubSteps;

	const stepElapsed = step.startTime ? elapsed(step.startTime, step.endTime) : null;

	return (
		<Box sx={{ borderLeft: `2px solid ${color}33`, ml: 1.5, mb: '1px' }}>
			<Box
				onClick={() => expandable && setOpen((v) => !v)}
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: 0.75,
					px: 1,
					py: '4px',
					cursor: expandable ? 'pointer' : 'default',
					'&:hover': expandable ? { bgcolor: 'action.hover' } : {},
					borderRadius: 0.5,
				}}
			>
				{expandable ? (
					open ? (
						<ChevronDown size={12} style={{ color: '#666', flexShrink: 0 }} />
					) : (
						<ChevronRight size={12} style={{ color: '#666', flexShrink: 0 }} />
					)
				) : (
					<Box sx={{ width: 12, flexShrink: 0 }} />
				)}

				<StepSquare status={step.status} />

				<Typography sx={{ fontFamily: 'Consolas, monospace', fontSize: 12, flex: 1, color: 'text.primary' }}>
					{step.label}
					{step.pluginId && step.pluginId !== step.label && (
						<Box component='span' sx={{ color: 'text.disabled', ml: 0.5, fontSize: 10 }}>
							({step.pluginId})
						</Box>
					)}
				</Typography>

				{step.errorCount > 0 && (
					<Box component='span' sx={{ color: '#f85149', fontSize: 10, mr: 0.5 }}>
						{step.errorCount} err
					</Box>
				)}

				{stepElapsed && (
					<Box component='span' sx={{ color: 'text.disabled', fontSize: 10, fontFamily: 'Consolas, monospace' }}>
						{stepElapsed}
						{step.finalCost !== undefined && (
							<Box component='span' sx={{ ml: 0.5, color: '#3fb950' }}>
								/ {fmtCost(step.finalCost)}
							</Box>
						)}
					</Box>
				)}

				<Box
					component='span'
					sx={{ fontSize: 10, color, ml: 0.5, minWidth: 48, textAlign: 'right', textTransform: 'uppercase', fontWeight: 600 }}
				>
					{step.status}
				</Box>
			</Box>

			{open && (filteredLogs.length > 0 || hasSubSteps) && (
				<Box sx={{ pl: 2.5, pb: 0.5 }}>
					{filteredLogs.map((e) => (
						<LogLine key={e.id} entry={e} />
					))}
					{subSteps.map((sub) => (
						<StepRow key={sub.stepId} step={sub} levelFilter={levelFilter} sourceFilter={sourceFilter} search={search} />
					))}
				</Box>
			)}
		</Box>
	);
}
