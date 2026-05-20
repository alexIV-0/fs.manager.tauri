// src/NODE_WIN/components/Sidebar/SidebarAccordion.tsx
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { CustomNodeData } from '@/NODE_WIN/definitions/types';
import { getNodeDefinitions } from '@/NODE_WIN/definitions';
import { Box, Collapse, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { DragEvent, memo, useEffect, useMemo, useState } from 'react';
import SideNode from './SidebarList';

interface GroupedNodes {
	colorType: string;
	color: string;
	nodes: ReturnType<typeof getNodeDefinitions>;
}

// Кастомный порядок аккордеонов в боковой панели.
// Группы, чей colorType указан здесь, идут в этом порядке. Все остальные — после,
// отсортированы алфавитом. Регистр учитывается (afterEffect — camelCase, как в colorTypes_store).
const GROUP_ORDER = ['main', 'ai', 'helpers', 'ffmpeg', 'afterEffect', 'moho'];

function groupOrderIndex(name: string): number {
	const idx = GROUP_ORDER.indexOf(name);
	return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

interface SidebarAccordionProps {
	/** Optional: called when a node label is clicked (for doc mode) */
	onNodeClick?: (nodeType: string) => void;
	/** Optional: highlights the selected node type */
	selectedNodeType?: string | null;
	/** Optional: if provided, uses external search value and hides internal search field */
	externalSearch?: string;
}

function SidebarAccordion({ onNodeClick, selectedNodeType, externalSearch }: SidebarAccordionProps = {}) {
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const [internalSearch, setInternalSearch] = useState('');
	const search = externalSearch ?? internalSearch;
	const hideSearchField = externalSearch !== undefined;
	const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
		try {
			const saved = localStorage.getItem('sidebar-accordion-groups');
			return saved ? JSON.parse(saved) : {};
		} catch {
			return {};
		}
	});

	useEffect(() => {
		localStorage.setItem('sidebar-accordion-groups', JSON.stringify(openGroups));
	}, [openGroups]);

	const nodes = getNodeDefinitions();

	// Группируем по colorType
	const groups = useMemo<GroupedNodes[]>(() => {
		const filtered = nodes.filter((n) => {
			const label = (n.data as CustomNodeData)?.label ?? '';
			return label.toLowerCase().includes(search.toLowerCase());
		});

		const map = new Map<string, typeof filtered>();
		filtered.forEach((node) => {
			const ct = (node.data as CustomNodeData)?.colorType ?? 'default';
			if (!map.has(ct)) map.set(ct, []);
			map.get(ct)!.push(node);
		});

		return Array.from(map.entries())
			.sort(([a], [b]) => {
				const ai = groupOrderIndex(a);
				const bi = groupOrderIndex(b);
				if (ai !== bi) return ai - bi;
				// Группы вне GROUP_ORDER сортируются между собой алфавитом.
				return a.localeCompare(b);
			})
			.map(([colorType, nodes]) => ({
				colorType,
				color: (colorTypes[colorType] as string) ?? (colorTypes.default as string),
				nodes: [...nodes].sort((a, b) => {
					const labelA = ((a.data as CustomNodeData)?.label ?? '').toLowerCase();
					const labelB = ((b.data as CustomNodeData)?.label ?? '').toLowerCase();
					return labelA.localeCompare(labelB);
				}),
			}));
	}, [nodes, colorTypes, search]);

	// Если есть поиск — раскрываем все группы
	const isGroupOpen = (colorType: string) => {
		if (search.trim()) return true;
		return openGroups[colorType] ?? true; // по умолчанию открыты
	};

	const toggleGroup = (colorType: string) => {
		setOpenGroups((prev) => ({ ...prev, [colorType]: !isGroupOpen(colorType) }));
	};

	return (
		<Stack direction='column' height='100%' overflow='hidden'>
			{!hideSearchField && (
				<Box px={1} py={1}>
					<TextField
						size='small'
						fullWidth
						placeholder='Search nodes...'
						value={internalSearch}
						onChange={(e) => setInternalSearch(e.target.value)}
						slotProps={{
							input: {
								startAdornment: (
									<InputAdornment position='start'>
										<Search size={14} />
									</InputAdornment>
								),
							},
						}}
						sx={{
							'& .MuiOutlinedInput-root': { fontSize: 12, height: 28 },
						}}
					/>
				</Box>
			)}

			{/* Группы */}
			<Stack direction='column' sx={{ overflowY: 'auto', flex: 1 }} gap={0.5} px={1}>
				{groups.map(({ colorType, color, nodes }) => {
					const open = isGroupOpen(colorType);

					return (
						<Box key={colorType}>
							{/* Заголовок группы */}
							<Stack
								direction='row'
								alignItems='center'
								gap={0.5}
								px={1}
								py={0.3}
								sx={{
									cursor: 'pointer',
									borderRadius: '4px',
									backgroundColor: color + '33', // прозрачный фон
									borderLeft: `3px solid ${color}`,
									userSelect: 'none',
									'&:hover': { backgroundColor: color + '55' },
								}}
								onClick={() => toggleGroup(colorType)}
							>
								{open ? <ChevronDown size={14} color={color} /> : <ChevronRight size={14} color={color} />}
								<Typography fontSize={11} fontWeight={600} color={color} textTransform='uppercase'>
									{colorType}
								</Typography>
								<Typography fontSize={10} sx={{ opacity: 0.5, ml: 'auto' }}>
									{nodes.length}
								</Typography>
							</Stack>

							{/* Ноды группы */}
							<Collapse in={open}>
								<Stack direction='column' gap={0.3} pt={0.3} pb={0.5}>
									{nodes.map((node) => (
										<SideNode
											key={node.id}
											onDragStart={(event: DragEvent) => {
												if (!node.type) return;
												event.dataTransfer.setData('application/reactflow', node.type);
												event.dataTransfer.effectAllowed = 'move';
											}}
											onClick={onNodeClick && node.type ? () => onNodeClick(node.type!) : undefined}
											nodeData={(node.data as CustomNodeData) ?? {}}
											draggable={node.deletable === undefined || node.deletable}
											sx={
												selectedNodeType && selectedNodeType === node.type
													? { outline: `2px solid ${colorTypes[node.data.colorType as string] ?? colorTypes.default}`, outlineOffset: 1 }
													: undefined
											}
										/>
									))}
								</Stack>
							</Collapse>
						</Box>
					);
				})}
			</Stack>
		</Stack>
	);
}

export default memo(SidebarAccordion);
