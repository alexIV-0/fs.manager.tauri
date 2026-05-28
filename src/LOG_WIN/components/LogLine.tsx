import React from 'react';
import { Box } from '@mui/material';
import type { LogEntry } from '../types';
import { LEVEL_COLOR, fmtTime } from '../utils';

export const LogLine = React.memo(function LogLine({ entry }: { entry: LogEntry }) {
	const color = LEVEL_COLOR[entry.level] ?? '#c9d1d9';
	return (
		<Box
			sx={{
				display: 'flex',
				gap: 0.75,
				alignItems: 'baseline',
				px: 1,
				py: '2px',
				borderRadius: 0.5,
				bgcolor: entry.level === 'error' ? 'rgba(248,81,73,0.08)' : 'transparent',
				fontFamily: 'Consolas, monospace',
				fontSize: 11,
				lineHeight: 1.5,
				'&:hover': { bgcolor: 'action.hover' },
			}}
		>
			<Box component='span' sx={{ color: 'text.disabled', flexShrink: 0, minWidth: 60 }}>
				{fmtTime(entry.timestamp)}
			</Box>
			<Box component='span' sx={{ color, fontWeight: 700, fontSize: 10, flexShrink: 0, minWidth: 38, textTransform: 'uppercase' }}>
				{entry.level}
			</Box>
			{entry.source === 'renderer' && (
				<Box component='span' sx={{ color: 'text.disabled', fontSize: 10, flexShrink: 0 }}>
					[rend]
				</Box>
			)}
			<Box component='span' sx={{ color: 'text.primary', wordBreak: 'break-all', whiteSpace: 'pre-wrap', flex: 1 }}>
				{entry.message}
				{entry.meta && (
					<Box component='span' sx={{ color: 'text.secondary', ml: 1, fontSize: 10 }}>
						{typeof entry.meta === 'object' ? JSON.stringify(entry.meta) : String(entry.meta)}
					</Box>
				)}
			</Box>
		</Box>
	);
});
