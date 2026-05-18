import { TitleSettingsProperty } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useUpdateFlow } from '@/NODE_WIN/hooks/useUpdateFlow';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { greyColor } from '@/Store/Color/grayColor';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Settings2 } from 'lucide-react';
import { memo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import TitleSettingsModal from './TitleEdit/TitleSettingsModal';

interface TitleSettingsPropertyProps {
	property: TitleSettingsProperty;
}

function TitleSettingsPropertyComponent({ property }: TitleSettingsPropertyProps) {
	const nodeId = useNodeContext();
	const { updateNodeProperty } = useUpdateFlow();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const defColor = colorTypes.default as string;

	const [isOpen, setIsOpen] = useState(false);

	const hasSettings = Boolean(property.controlProps.value);

	const handleOpen = useCallback(() => {
		setIsOpen(true);
	}, []);

	const handleClose = useCallback(() => {
		setIsOpen(false);
	}, []);

	const handleSave = useCallback(
		(value: string) => {
			updateNodeProperty(nodeId, property.id, value);
		},
		[nodeId, property.id, updateNodeProperty],
	);

	return (
		<Stack direction='column' px='12px' className='nodrag' gap={0.5}>
			<Typography variant='subtitle2' fontWeight={400} noWrap color={defColor}>
				{property.controlProps.label}
			</Typography>

			<Button
				variant='outlined'
				size='small'
				startIcon={<Settings2 size={16} strokeWidth={1.5} />}
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
				{hasSettings ? 'Edit Title Settings' : 'Open Title Settings'}
			</Button>

			{/* Превью текущих настроек */}
			{hasSettings && (
				<Box
					sx={{
						fontSize: 10,
						color: greyColor(45),
						pl: 0.5,
					}}
				>
					{(() => {
						try {
							const s = JSON.parse(property.controlProps.value);
							const ls = s.landscape;
							return `${ls.text.font} ${ls.text.size}px · ${ls.animation.type}`;
						} catch {
							return '';
						}
					})()}
				</Box>
			)}

			{/* Модальное окно */}
			{isOpen &&
				createPortal(<TitleSettingsModal value={property.controlProps.value} onSave={handleSave} onClose={handleClose} />, document.body)}
		</Stack>
	);
}

export default memo(TitleSettingsPropertyComponent);
