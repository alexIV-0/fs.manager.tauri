import { Box, Tooltip } from '@mui/material';
import { useNodesData } from '@xyflow/react';
import { memo } from 'react';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import type { CostUnit } from '@/MAIN_WIN/options/PluginBuilderWin/types';

interface NodeCostProps {
	textColor: string;
}

// Read-only: цена и единица — централизованные значения из plugin.json.
// Редактируется в Settings → Plugins, сюда подтягивается синхронизатором при открытии флоу
// и при сборке очереди обработки.
function NodeCost({ textColor }: NodeCostProps) {
	const nodeId = useNodeContext();
	const node = useNodesData(nodeId) as any;

	const value = String(node?.data?.cost ?? '0');
	const unit: CostUnit = node?.data?.costUnit ?? 'run';
	const fromSite = unit === 'fromSite';

	return (
		<Tooltip title='Изменить можно в Settings → Plugins' placement='top' arrow>
			<Box
				sx={{
					ml: 'auto',
					mr: 0.5,
					display: 'flex',
					alignItems: 'center',
					gap: '2px',
					color: textColor,
					fontFamily: 'monospace',
					fontSize: 14,
					userSelect: 'none',
					cursor: 'default',
				}}
			>
				<Box component='span'>{fromSite ? '—' : value}</Box>
				<Box component='span' sx={{ fontSize: 11, opacity: 0.7 }}>
					$/
				</Box>
				<Box component='span'>{unit}</Box>
			</Box>
		</Tooltip>
	);
}

export default memo(NodeCost);
