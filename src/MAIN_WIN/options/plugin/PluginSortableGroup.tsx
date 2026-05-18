// PluginSortableGroup.tsx
import React, { use, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Box, Paper, Typography, IconButton, Collapse } from '@mui/material';
import { GripVertical, ChevronDown, ChevronUp } from 'lucide-react';
import { PluginItem } from '@/Store/MainWin/plugin_store';
import { PluginSortableListItem } from './PluginSortableListItem';
import { greyColor } from '@/Store/Color/grayColor';
import { AlertTriangle } from 'lucide-react';

interface Props {
	groupId: string;
	plugins: PluginItem[];
}

export const PluginSortableGroup: React.FC<Props> = ({ groupId, plugins }) => {
	// По умолчанию группа скрыта (collapsed = true)
	const [collapsed, setCollapsed] = useState(true);

	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: groupId,
		disabled: false, // ВАЖНО: включаем drag для групп!
	});

	// Проверяем есть ли отсутствующие плагины в группе
	const hasMissingPlugins = plugins.some((p) => !p.exists);

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
		zIndex: isDragging ? 999 : 'auto',
	};

	// Если плагинов в группе нет, не рендерим
	if (plugins.length === 0) return null;

	// Основной плагин группы (первый, самая новая версия)
	const mainPlugin = plugins[0];
	const hasMultipleVersions = plugins.length > 1;

	// Подсчет включенных версий
	const enabledCount = plugins.filter((p) => p.enabled).length;

	return (
		<Paper
			ref={setNodeRef}
			style={style}
			elevation={isDragging ? 8 : 1}
			sx={{
				borderRadius: 2,
				border: '1px solid',
				borderColor: isDragging ? 'primary.main' : 'divider',
				overflow: 'hidden',
				bgcolor: greyColor(10),
				transition: 'box-shadow 0.2s, border-color 0.2s',
				'&:hover': {
					borderColor: 'primary.main',
					boxShadow: 2,
				},
			}}
		>
			{/* Заголовок группы */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					p: 1,
					// bgcolor: isDragging ? greyColor(20) : greyColor(18),
					borderBottom: !collapsed && hasMultipleVersions ? '1px solid' : 'none',
					borderColor: 'divider',
				}}
				onClick={() => setCollapsed(!collapsed)}
			>
				{/* Ручка для перетаскивания - ТОЛЬКО ЗДЕСЬ ДОЛЖНЫ БЫТЬ attributes и listeners */}
				<IconButton
					size='small'
					{...attributes}
					{...listeners}
					sx={{
						mr: 1,
						cursor: 'grab',
						color: greyColor(60),
						'&:active': {
							cursor: 'grabbing',
						},
						'&:hover': {
							color: greyColor(85),
							backgroundColor: 'transparent',
						},
					}}
				>
					<GripVertical size={20} strokeWidth={1.5} />
				</IconButton>

				{/* Кнопка сворачивания/разворачивания */}
				<IconButton
					size='small'
					onClick={() => setCollapsed(!collapsed)}
					sx={{
						mr: 1,
						color: greyColor(60),
						'&:hover': {
							color: greyColor(85),
							backgroundColor: 'transparent',
						},
					}}
				>
					{collapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
				</IconButton>

				{/* Индикатор отсутствующих плагинов */}
				{hasMissingPlugins && (
					<Box
						sx={{
							display: 'flex',
							alignItems: 'center',
							mr: 1,
							color: 'warning.main',
						}}
						title='В группе есть отсутствующие плагины'
					>
						<AlertTriangle size={18} strokeWidth={2} />
					</Box>
				)}

				{/* Информация о группе */}
				<Box
					sx={{
						flex: 1,
						display: 'flex',
						alignItems: 'center',
						gap: 2,
						userSelect: 'none',
					}}
				>
					<Typography
						variant='subtitle1'
						sx={{
							fontWeight: 600,
							color: greyColor(85),
						}}
					>
						{mainPlugin.name}
					</Typography>

					{/* Статус группы */}
					<Box sx={{ display: 'flex', gap: 1 }}>
						{hasMultipleVersions && (
							<Typography
								variant='caption'
								sx={{
									color: greyColor(60),
									display: 'flex',
									alignItems: 'center',
									gap: 0.5,
								}}
							>
								{plugins.length} версий
							</Typography>
						)}
						<Typography
							variant='caption'
							sx={{
								color: greyColor(60),
								display: 'flex',
								alignItems: 'center',
								gap: 0.5,
							}}
						>
							• {enabledCount} из {plugins.length} вкл
						</Typography>
						{!mainPlugin.exists && (
							<Typography
								variant='caption'
								sx={{
									color: 'error.main',
									display: 'flex',
									alignItems: 'center',
									gap: 0.5,
								}}
							>
								• отсутствует на диске
							</Typography>
						)}
					</Box>
				</Box>
			</Box>

			{/* Список версий плагина */}
			<Collapse in={!collapsed} timeout='auto'>
				<Box
					sx={{
						p: 1.5,
						display: 'flex',
						flexDirection: 'column',
						gap: 0.5,
					}}
				>
					{plugins.map((plugin) => (
						<PluginSortableListItem
							key={`${plugin.id}@${plugin.version}`}
							plugin={plugin}
							isMainVersion={plugin.version === mainPlugin.version}
						/>
					))}
				</Box>
			</Collapse>
		</Paper>
	);
};
