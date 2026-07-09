// CollectProperty — поле `collect` ноды autoTGcollect (controlType 'collectScheme').
//
// Модальный редактор «что собираем». MVP: выбор одного типа файла (video/photo/audio/
// document/text) ИЛИ folder. Конкретный тип → собираем всё этого типа в IN. folder →
// визард сбора нескольких файлов в одну задачу — ФАЗА 2 (пока только пометка).
//
// Вся логика сбора будет жить здесь (в модалке), а не в самой ноде — поэтому компонент
// заведён сразу, хоть MVP-содержимое и простое. Значение = объект { type }.

import { memo, useCallback, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { Inbox } from 'lucide-react';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useUpdateFlow } from '@/NODE_WIN/hooks/useUpdateFlow';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { greyColor } from '@/Store/Color/grayColor';
import { CollectSchemeProperty } from '@/NODE_WIN/definitions/types';
import MyToolTip from './CustomTooltip';

const TYPES = ['video', 'photo', 'audio', 'document', 'text', 'folder'] as const;

interface Props {
	property: CollectSchemeProperty;
}

function CollectProperty({ property }: Props) {
	const nodeId = useNodeContext();
	const { updateNodeProperty } = useUpdateFlow();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const defColor = colorTypes.default as string;
	const tooltip = property.controlProps?.tooltip ?? '';

	const value = (property.controlProps?.value ?? {}) as { type?: string };
	const currentType = value?.type ?? 'video';

	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<string>(currentType);

	const handleOpen = useCallback(() => {
		setDraft(currentType);
		setOpen(true);
	}, [currentType]);
	const handleClose = useCallback(() => setOpen(false), []);
	const handleSave = useCallback(() => {
		updateNodeProperty(nodeId, property.id, { type: draft });
		setOpen(false);
	}, [nodeId, property.id, draft, updateNodeProperty]);

	return (
		<Stack direction='column' px='12px' className='nodrag' gap={0.5}>
			<Stack direction='row' alignItems='center' gap={1}>
				<Typography variant='subtitle2' fontWeight={400} noWrap color={defColor}>
					{property.controlProps.label}
				</Typography>
				<MyToolTip tooltip={tooltip} ml='auto' />
			</Stack>

			<Button
				variant='outlined'
				size='small'
				startIcon={<Inbox size={16} strokeWidth={1.5} />}
				onClick={handleOpen}
				sx={{
					textTransform: 'none',
					borderColor: greyColor(60),
					color: greyColor(80),
					fontSize: '1rem',
					justifyContent: 'flex-start',
					'&:hover': { borderColor: greyColor(80), color: greyColor(90), backgroundColor: greyColor(20) },
				}}
			>
				{`Собираем: ${currentType}`}
			</Button>

			<Dialog open={open} onClose={handleClose} fullWidth maxWidth='xs'>
				<DialogTitle>Что собираем</DialogTitle>
				<DialogContent>
					<Stack gap={1.5} mt={0.5}>
						<ToggleButtonGroup
							value={draft}
							exclusive
							size='small'
							onChange={(_, v) => v && setDraft(v)}
							sx={{ flexWrap: 'wrap' }}
						>
							{TYPES.map((t) => (
								<ToggleButton key={t} value={t} sx={{ textTransform: 'none' }}>
									{t}
								</ToggleButton>
							))}
						</ToggleButtonGroup>

						{draft === 'folder' ? (
							<Typography variant='caption' color='text.secondary'>
								Несколько файлов в одну задачу (визард шагов) — фаза 2. Пока выбирай конкретный тип.
							</Typography>
						) : (
							<Typography variant='caption' color='text.secondary'>
								Собираем все «{draft}» из чата и кладём в IN.
							</Typography>
						)}
					</Stack>
				</DialogContent>
				<DialogActions>
					<Button onClick={handleClose}>Отмена</Button>
					<Button variant='contained' onClick={handleSave}>
						OK
					</Button>
				</DialogActions>
			</Dialog>
		</Stack>
	);
}

export default memo(CollectProperty);
