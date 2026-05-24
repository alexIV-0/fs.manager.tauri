// src/NODE_WIN/nodes/properties/ConvertProperty.tsx

import { memo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import { FileVideo } from 'lucide-react';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useUpdateFlow } from '@/NODE_WIN/hooks/useUpdateFlow';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { greyColor } from '@/Store/Color/grayColor';
import { ConvertSettingsProperty } from '@/NODE_WIN/definitions/types';
import ConvertModal from './ConvertEdit/ConvertModal';
import InputHandle from '../components/InputHandle';
import MyToolTip from './CustomTooltip';

interface ConvertPropertyProps {
	property: ConvertSettingsProperty;
}

function ConvertPropertyComponent({ property }: ConvertPropertyProps) {
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

	// Summary line shown below the button
	const summary = (() => {
		if (!hasSettings) return null;
		try {
			const s = JSON.parse(property.controlProps.value);
			const ext = (s.outputExtension ?? 'mp4').toUpperCase();
			const parts: string[] = [`→ ${ext}`];
			if (s.video?.enabled) parts.push(`Video: ${s.video.codec}`);
			if (s.audio?.enabled) parts.push(`Audio: ${s.audio.codec}`);
			return parts.join(' · ');
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
				startIcon={<FileVideo size={16} strokeWidth={1.5} />}
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
				{hasSettings ? 'Edit Convert Settings' : 'Open Convert Settings'}
			</Button>

			{summary && <Box sx={{ fontSize: 10, color: greyColor(45), pl: 0.5 }}>{summary}</Box>}

			{isOpen &&
				createPortal(
					<ConvertModal value={property.controlProps.value} onSave={handleSave} onClose={handleClose} />,
					document.body,
				)}
		</Stack>
	);
}

export default memo(ConvertPropertyComponent);
