// src/NODE_WIN/nodes/properties/KeyingProperty.tsx

import { memo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Scissors } from 'lucide-react';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useUpdateFlow } from '@/NODE_WIN/hooks/useUpdateFlow';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { greyColor } from '@/Store/Color/grayColor';
import { KeyingProperty } from '@/NODE_WIN/definitions/types';
import KeyingModal from './KeyingEdit/KeyingModal';
import InputHandle from '../components/InputHandle';
import MyToolTip from './CustomTooltip';

interface KeyingPropertyProps {
	property: KeyingProperty;
}

function KeyingPropertyComponent({ property }: KeyingPropertyProps) {
	const nodeId = useNodeContext();
	const { updateNodeProperty } = useUpdateFlow();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const defColor = colorTypes.default as string;
	const tooltip = property.controlProps?.tooltip ?? '';

	const [isOpen, setIsOpen] = useState(false);

	const hasSettings = Boolean(property.controlProps.value);

	const handleOpen = useCallback(() => setIsOpen(true), []);
	const handleClose = useCallback(() => setIsOpen(false), []);

	const handleSave = useCallback(
		(value: string) => {
			updateNodeProperty(nodeId, property.id, value);
		},
		[nodeId, property.id, updateNodeProperty],
	);

	// Short summary from saved settings
	const summary = (() => {
		if (!hasSettings) return null;
		try {
			const s = JSON.parse(property.controlProps.value);
			const parts: string[] = [];
			if (s.chromakey?.enabled) parts.push('Chroma');
			if (s.colorkey?.enabled) parts.push('Color');
			if (s.lumakey?.enabled) parts.push('Luma');
			if (s.despill?.enabled) parts.push('Despill');
			return parts.length > 0 ? parts.join(' + ') : 'Configured';
		} catch {
			return null;
		}
	})();

	return (
		<Stack direction='column' px='12px' className='nodrag' gap={0.5}>
			<Stack direction='row' alignItems='center' position='relative' gap={1}>
				{property.isInput && <InputHandle property={property} />}
				<Typography variant='subtitle2' fontWeight={400} noWrap color={defColor}>
					{property.controlProps.label}
				</Typography>
				<MyToolTip tooltip={tooltip} ml='auto' />
			</Stack>
			<Button
				variant='outlined'
				size='small'
				startIcon={<Scissors size={16} strokeWidth={1.5} />}
				onClick={handleOpen}
				sx={{
					textTransform: 'none',
					borderColor: hasSettings ? greyColor(60) : greyColor(30),
					color: hasSettings ? greyColor(80) : greyColor(50),
					fontSize: '1rem',
					justifyContent: 'flex-start',
					'&:hover': {
						borderColor: greyColor(80),
						color: greyColor(90),
						backgroundColor: greyColor(20),
					},
				}}
			>
				{hasSettings ? 'Edit Keying Settings' : 'Open Keying Settings'}
			</Button>

			{summary && <Box sx={{ fontSize: 10, color: greyColor(45), pl: 0.5 }}>{summary}</Box>}

			{isOpen &&
				createPortal(
					<KeyingModal value={property.controlProps.value} onSave={handleSave} onClose={handleClose} nodeId={nodeId} />,
					document.body,
				)}
		</Stack>
	);
}

export default memo(KeyingPropertyComponent);
