import React, { useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ListItem, ListItemIcon, IconButton, Checkbox, Typography, Box, Chip } from '@mui/material';
import { GripVertical, Trash2, AlertCircle } from 'lucide-react';
import { plugin_Store, PluginItem } from '@/Store/MainWin/plugin_store';
import { defGray, greyColor } from '@/Store/Color/grayColor';
import { COST_UNITS } from '@/MAIN_WIN/options/PluginBuilderWin/types';

interface SortableListItemProps {
	plugin: PluginItem;
	isMainVersion?: boolean;
}

export const PluginSortableListItem: React.FC<SortableListItemProps> = ({ plugin, isMainVersion = false }) => {
	const { toggleEnabled, removePlugin, setPluginCost } = plugin_Store();
	const [costDraft, setCostDraft] = useState<string>(plugin.cost ?? '0');

	useEffect(() => {
		setCostDraft(plugin.cost ?? '0');
	}, [plugin.cost]);

	const commitCost = (nextCost: string, nextUnit: string) => {
		if (!plugin.exists) return;
		if (nextCost === (plugin.cost ?? '0') && nextUnit === (plugin.costUnit ?? 'run')) return;
		setPluginCost(plugin.id, plugin.version, nextCost, nextUnit).catch(() => {
			setCostDraft(plugin.cost ?? '0');
		});
	};

	const sortableId = `${plugin.id}@${plugin.version}`;

	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: sortableId,
		disabled: true, // Отключаем drag для отдельных версий
	});

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.8 : 1,
	};

	const handleToggle = () => {
		toggleEnabled(plugin.id, plugin.version);
	};

	const handleRemove = async () => {
		if (confirm(`Удалить плагин ${plugin.name} v${plugin.version}?`)) {
			try {
				await window.plugins.deletePlugin(plugin.id, plugin.version);
			} catch (err) {
				console.error(`[PluginSortableListItem] Failed to delete plugin from disk:`, err);
			}
			removePlugin(plugin.id, plugin.version);
		}
	};

	// Определяем цвета в зависимости от статуса
	const getTextColor = () => {
		if (!plugin.exists) return 'error.dark';
		if (!plugin.enabled) return greyColor(50);
		return greyColor(85);
	};

	const getBorderColor = () => {
		if (!plugin.exists) return 'error.main';
		if (!plugin.enabled) return greyColor(30);
		return greyColor(30);
	};

	return (
		<ListItem
			ref={setNodeRef}
			style={style}
			sx={{
				mb: 0.5,
				p: 0.5,
				pl: 4, // Отступ слева для визуальной вложенности
				pr: 1, // Отступ справа для правых элементов
				minHeight: '40px',
				bgcolor: !plugin.exists
					? 'rgba(211, 47, 47, 0.08)' // Светло-красный фон для отсутствующих
					: !plugin.enabled
						? 'action.disabledBackground'
						: isMainVersion
							? 'action.selected'
							: 'transparent',
				borderRadius: 1,
				// borderLeft: !plugin.exists ? '3px solid' : '1px solid transparent',
				// borderLeftColor: !plugin.exists ? 'error.main' : 'transparent',
				// borderBottom: `1px solid`,
				borderColor: getBorderColor(),
				'&:hover': {
					bgcolor: !plugin.exists ? 'rgba(211, 47, 47, 0.12)' : 'action.hover',
					borderColor: !plugin.exists ? 'error.dark' : greyColor(50),
				},
				transition: 'background-color 0.2s, border-color 0.2s',
				display: 'flex',
				alignItems: 'center',
				gap: 1,
			}}
		>
			{/* Ручка перетаскивания (disabled для версий)
			<IconButton
				size='small'
				{...attributes}
				{...listeners}
				disabled
				sx={{
					cursor: 'default',
					p: 0.5,
					color: greyColor(40),
					opacity: 0.5,
					flexShrink: 0,
				}}
			>
				<GripVertical strokeWidth={1.2} size={20} />
			</IconButton> */}

			{/* Чекбокс включения/выключения */}
			<ListItemIcon sx={{ minWidth: '36px', flexShrink: 0 }}>
				<Checkbox
					edge='start'
					checked={plugin.enabled}
					onChange={handleToggle}
					disabled={!plugin.exists}
					tabIndex={-1}
					disableRipple
					sx={{
						p: 0.5,
						color: !plugin.exists ? 'error.main' : defGray,
						'&.Mui-checked': {
							color: !plugin.exists ? 'error.dark' : greyColor(80),
						},
						'&.Mui-disabled': {
							color: greyColor(30),
						},
					}}
				/>
			</ListItemIcon>

			{/* Информация о плагине - с правильным overflow control */}
			<Box
				sx={{
					flex: 1,
					minWidth: 0, // ВАЖНО: позволяет контенту сжиматься и показывать ellipsis
					display: 'flex',
					flexDirection: 'column',
					gap: 0.25,
				}}
			>
				{/* Название и типы */}
				<Box
					sx={{
						display: 'flex',
						alignItems: 'center',
						gap: 1,
						minWidth: 0,
					}}
				>
					<Typography
						variant='body1'
						sx={{
							userSelect: 'none',
							cursor: 'default',
							fontWeight: plugin.enabled ? 500 : 400,
							color: getTextColor(),
							textDecoration: !plugin.exists ? 'line-through' : 'none',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
							flex: 1,
							minWidth: 0,
						}}
					>
						{plugin.name}
					</Typography>

					{/* Cost / costUnit — централизованная цена из plugin.json */}
					<Box
						sx={{
							display: 'flex',
							alignItems: 'center',
							gap: 0.5,
							flexShrink: 0,
							opacity: plugin.exists ? (plugin.enabled ? 1 : 0.6) : 0.4,
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<input
							type='text'
							value={costDraft}
							disabled={!plugin.exists}
							onChange={(e) => setCostDraft(e.target.value)}
							onBlur={() => commitCost(costDraft, plugin.costUnit ?? 'run')}
							onKeyDown={(e) => {
								if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
								if (e.key === 'Escape') {
									setCostDraft(plugin.cost ?? '0');
									(e.target as HTMLInputElement).blur();
								}
							}}
							style={{
								width: 48,
								background: 'transparent',
								border: `1px solid ${greyColor(30)}`,
								borderRadius: 4,
								padding: '2px 4px',
								color: greyColor(85),
								fontSize: 12,
								fontFamily: 'monospace',
								outline: 'none',
								textAlign: 'right',
							}}
							title='Стоимость работы плагина (записывается в plugin.json)'
						/>
						<select
							value={plugin.costUnit ?? 'run'}
							disabled={!plugin.exists}
							onChange={(e) => commitCost(costDraft, e.target.value)}
							style={{
								background: 'transparent',
								border: `1px solid ${greyColor(30)}`,
								borderRadius: 4,
								padding: '2px 4px',
								color: greyColor(85),
								fontSize: 12,
								fontFamily: 'monospace',
								outline: 'none',
							}}
							title='Единица измерения стоимости'
						>
							{COST_UNITS.map((u) => (
								<option key={u} value={u}>
									{u}
								</option>
							))}
						</select>
					</Box>

					{/* Типы плагина */}
					<Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
						{plugin.type.map((t) => (
							<Chip
								key={t}
								label={t}
								size='small'
								variant='outlined'
								sx={{
									height: 18,
									'& .MuiChip-label': {
										px: 0.8,
										fontSize: '0.65rem',
									},
									opacity: plugin.enabled ? 1 : 0.6,
								}}
							/>
						))}
					</Box>
				</Box>

				{/* Описание */}
				{plugin.description && (
					<Box
						sx={{
							userSelect: 'none',
							cursor: 'default',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							fontSize: '0.75rem',
							lineHeight: 1.4,
							color: plugin.enabled ? 'text.secondary' : 'text.disabled',
							'& p': { margin: '0 0 2px 0' },
							'& ul, & ol': { paddingLeft: 2, margin: '2px 0' },
							'& strong': { fontWeight: 700 },
							'& em': { fontStyle: 'italic' },
						}}
						dangerouslySetInnerHTML={{ __html: plugin.description }}
					/>
				)}
			</Box>

			{/* Правая часть: индикаторы и кнопки */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: 0.5,
					flexShrink: 0, // Не сжимаются при нехватке места
					ml: 1,
				}}
			>
				{/* Индикатор отсутствия плагина */}
				{!plugin.exists && (
					<Chip
						icon={<AlertCircle size={14} />}
						label='отсутствует'
						size='small'
						color='error'
						variant='outlined'
						sx={{
							height: 24,
							'& .MuiChip-label': { px: 1, fontSize: '0.7rem' },
						}}
					/>
				)}

				{/* Версия плагина */}
				<Typography
					variant='caption'
					sx={{
						userSelect: 'none',
						cursor: 'default',
						color: plugin.enabled ? greyColor(70) : greyColor(40),
						bgcolor: !plugin.exists ? 'rgba(211, 47, 47, 0.15)' : greyColor(20),
						px: 1,
						py: 0.5,
						borderRadius: 1,
						lineHeight: 1,
						fontWeight: isMainVersion ? 600 : 400,
						border: !plugin.exists ? '1px solid' : 'none',
						borderColor: 'error.main',
						whiteSpace: 'nowrap',
					}}
				>
					v{plugin.version}
					{isMainVersion && ' • акт'}
				</Typography>

				{/* Кнопка удаления */}
				<IconButton
					edge='end'
					aria-label='delete'
					onClick={handleRemove}
					size='small'
					sx={{
						p: 0.5,
						color: !plugin.exists ? 'error.main' : defGray,
						'&:hover': {
							color: 'error.main',
							backgroundColor: 'transparent',
						},
					}}
				>
					<Trash2 strokeWidth={1.2} size={20} />
				</IconButton>
			</Box>
		</ListItem>
	);
};
