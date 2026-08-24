import { useState } from 'react';
import { Box, Button, IconButton, Popover, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { CircleQuestionMark, Pencil } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { CustomNodeData, Property } from '@/NODE_WIN/definitions/types';
import { greyColor } from '@/Store/Color/grayColor';
import { TooltipBody } from './CustomTooltip';

interface EditableTooltipProps {
	property: Property;
}

/**
 * Своя подсказка для свойства, добавленного пользователем через «+».
 *
 * У свойств из ui.json текст подсказки пишет автор плагина, и на ноде он только
 * читается (`MyToolTip`). У динамических свойств автора нет — текст задаёт сам
 * пользователь, поэтому «?» здесь и показывает, и правит: клик открывает
 * поповер с текстом и кнопкой «править», а если подсказки ещё нет — сразу
 * открывает ввод. Иконка пустой подсказки притушена.
 *
 * Пишем в `controlProps.tooltip` → уходит в options.json как есть. Заодно
 * фиксируем `isDynamic: true`: в старых флоу флага нет, а «динамическость» там
 * выводилась из пустого tooltip — без этой пометки свойство с подсказкой
 * потеряло бы корзину (см. `isDynamicProperty`).
 */
export default function EditableTooltip({ property }: EditableTooltipProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState('');

	const tooltip = ((property.controlProps as any)?.tooltip ?? '') as string;

	const open = (e: React.MouseEvent<HTMLElement>) => {
		setDraft(tooltip);
		setEditing(!tooltip); // подсказки нет — открываем прямо на вводе
		setAnchorEl(e.currentTarget);
	};

	const close = () => {
		setAnchorEl(null);
		setEditing(false);
	};

	const save = () => {
		const text = draft.trim();
		reactFlow.updateNode(nodeId, (node) => {
			const nodeData = node.data as CustomNodeData;
			const properties = nodeData.properties.map((p) =>
				p.id === property.id ? { ...p, isDynamic: true, controlProps: { ...p.controlProps, tooltip: text } } : p,
			) as Property[];
			return { ...node, data: { ...nodeData, properties } };
		});
		close();
	};

	return (
		<>
			<Tooltip title={tooltip ? 'Подсказка' : 'Добавить подсказку'} placement='top' arrow>
				<IconButton
					disableRipple
					size='small'
					className='nodrag'
					onClick={open}
					sx={{
						width: 28,
						padding: 0,
						// Пустая подсказка — притушенная иконка: видно, что её можно завести.
						color: tooltip ? greyColor(50) : greyColor(28),
						'&:hover': { color: greyColor(70) },
					}}
				>
					<CircleQuestionMark size={18} strokeWidth={1} />
				</IconButton>
			</Tooltip>

			<Popover
				open={Boolean(anchorEl)}
				anchorEl={anchorEl}
				onClose={close}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
				transformOrigin={{ vertical: 'top', horizontal: 'right' }}
				slotProps={{ paper: { className: 'nodrag', sx: { p: 1.5, width: 340, bgcolor: greyColor(12) } } }}
			>
				{editing ? (
					<Stack gap={1}>
						<Typography variant='caption' sx={{ color: greyColor(60), fontFamily: 'monospace' }}>
							// своя подсказка (Markdown или HTML)
						</Typography>
						<TextField
							autoFocus
							multiline
							minRows={5}
							maxRows={14}
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
								if (e.key === 'Escape') close();
							}}
							placeholder={'Что делает это поле.\n\n**жирный**, `код`, - список'}
							sx={{ '& .MuiInputBase-input': { fontSize: 13, lineHeight: 1.5, color: greyColor(80) } }}
						/>
						<Stack direction='row' alignItems='center' gap={1}>
							<Button size='small' variant='contained' onClick={save} sx={{ textTransform: 'none' }}>
								Сохранить
							</Button>
							<Button size='small' onClick={close} sx={{ textTransform: 'none', color: greyColor(60) }}>
								Отмена
							</Button>
							<Box component='span' sx={{ ml: 'auto', color: greyColor(40), fontFamily: 'monospace', fontSize: 10 }}>
								⌘/Ctrl+Enter
							</Box>
						</Stack>
					</Stack>
				) : (
					<Stack gap={1}>
						<Box sx={{ color: greyColor(70), fontSize: 13, lineHeight: 1.6, maxHeight: 320, overflowY: 'auto' }}>
							<TooltipBody tooltip={tooltip} />
						</Box>
						<Stack direction='row' alignItems='center' gap={0.5}>
							<Button
								size='small'
								startIcon={<Pencil size={14} strokeWidth={1.5} />}
								onClick={() => setEditing(true)}
								sx={{ textTransform: 'none', color: greyColor(60) }}
							>
								править
							</Button>
						</Stack>
					</Stack>
				)}
			</Popover>
		</>
	);
}
