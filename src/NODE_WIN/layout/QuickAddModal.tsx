import { Box, InputBase, List, ListItemButton, Typography } from '@mui/material';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMultiVersionPlugins, getNodeDefinitions } from '../definitions';
import { CustomNodeData } from '../definitions/types';
import { useNodeQuickAdd_store } from '@/Store/Node/useNodeQuickAdd_store';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { greyColor } from '@/Store/Color/grayColor';

interface QuickAddModalProps {
	open: boolean;
	position: { x: number; y: number };
	onClose: () => void;
	/** id определения (`type@version` у плагинов), а не тип: версий одного плагина может быть несколько. */
	onAddNode: (defId: string) => void;
}

type NodeOption = {
	/** `type@version` у плагинных нод, `type` у встроенных — по нему и добавляем. */
	id: string;
	type: string;
	label: string;
	colorType: string;
	/** Не null, только когда у плагина загружено несколько версий (как в шапке ноды и в сайдбаре). */
	version: string | null;
};

function matchesQuery(label: string, terms: string[]): boolean {
	const words = label.split(/[\s._\-]+/);
	if (words.length < terms.length) return false;

	for (let i = 0; i < terms.length; i++) {
		const term = terms[i].toLowerCase();
		const word = words[i].toLowerCase();
		const nextWord = (words[i + 1] ?? words[i]).toLowerCase();
		if (!word.startsWith(term) && !nextWord.startsWith(term)) return false;
	}
	return true;
}

function QuickAddModal({ open, position, onClose, onAddNode }: QuickAddModalProps) {
	const [query, setQuery] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	const lastUsed = useNodeQuickAdd_store((s) => s.lastUsed);
	const usageCount = useNodeQuickAdd_store((s) => s.usageCount);
	const colorTypes = colorTypes_store((s) => s.colorTypes);

	// eslint-disable-next-line react-hooks/exhaustive-deps
	const allNodes = useMemo<NodeOption[]>(
		() => {
			const multi = getMultiVersionPlugins();
			return getNodeDefinitions()
				.filter((n) => n.deletable !== false)
				.map((n) => {
					const pluginId = (n as any).pluginId as string | undefined;
					const pluginVersion = (n as any).pluginVersion as string | undefined;
					return {
						id: ((n as any).id as string) ?? (n.type as string),
						type: n.type as string,
						label: (n.data as CustomNodeData).label,
						colorType: (n.data as CustomNodeData).colorType,
						version: pluginId && pluginVersion && multi.has(pluginId) ? pluginVersion : null,
					};
				});
		},
		// rebuild when modal opens to pick up any new plugin definitions
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[open],
	);

	const displayedItems = useMemo<NodeOption[]>(() => {
		if (!query.trim()) {
			return [...lastUsed]
				.sort((a, b) => (usageCount[b.type] ?? 0) - (usageCount[a.type] ?? 0))
				.map(
					(entry) =>
						allNodes.find((n) => n.type === entry.type) ?? {
							id: entry.type,
							type: entry.type,
							label: entry.label,
							colorType: 'default',
							version: null,
						},
				);
		}

		const terms = query.split(/\s+/).filter(Boolean);
		const matches = allNodes.filter((n) => matchesQuery(n.label, terms));
		matches.sort((a, b) => {
			const diff = (usageCount[b.type] ?? 0) - (usageCount[a.type] ?? 0);
			return diff !== 0 ? diff : a.label.localeCompare(b.label);
		});
		return matches.slice(0, 15);
	}, [query, allNodes, lastUsed, usageCount]);

	useEffect(() => {
		if (open) {
			setQuery('');
			setSelectedIndex(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	useEffect(() => {
		setSelectedIndex(0);
	}, [displayedItems]);

	useEffect(() => {
		if (!listRef.current) return;
		const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
		item?.scrollIntoView({ block: 'nearest' });
	}, [selectedIndex]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			switch (e.key) {
				case 'ArrowDown':
					e.preventDefault();
					setSelectedIndex((i) => Math.min(i + 1, displayedItems.length - 1));
					break;
				case 'ArrowUp':
					e.preventDefault();
					setSelectedIndex((i) => Math.max(i - 1, 0));
					break;
				case 'Enter':
					e.preventDefault();
					if (displayedItems[selectedIndex]) onAddNode(displayedItems[selectedIndex].id);
					break;
				case 'Escape':
				case 'Tab':
					e.preventDefault();
					onClose();
					break;
			}
		},
		[displayedItems, selectedIndex, onAddNode, onClose],
	);

	if (!open) return null;

	return (
		<>
			{/* backdrop */}
			<Box onClick={onClose} sx={{ position: 'fixed', inset: 0, zIndex: 9998 }} />

			{/* modal */}
			<Box
				sx={{
					position: 'fixed',
					left: position.x,
					top: position.y,
					width: 280,
					zIndex: 9999,
					backgroundColor: greyColor(18),
					border: '1px solid #ffffff18',
					borderRadius: '8px',
					boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
					overflow: 'hidden',
				}}
			>
				<Box sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid #ffffff12' }}>
					<InputBase
						inputRef={inputRef}
						fullWidth
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder='Add node...'
						sx={{
							fontSize: 13,
							color: 'white',
							'& input::placeholder': { color: '#ffffff44', fontSize: 12 },
						}}
					/>
				</Box>

				{displayedItems.length > 0 && (
					<List ref={listRef} dense disablePadding sx={{ maxHeight: 200, overflowY: 'auto' }}>
						{displayedItems.map((item, i) => {
							const color = (colorTypes[item.colorType] as string) ?? (colorTypes.default as string);
							const isSelected = i === selectedIndex;
							return (
								<ListItemButton
									key={item.id}
									selected={isSelected}
									onMouseDown={(e) => {
										e.preventDefault();
										onAddNode(item.id);
									}}
									onMouseEnter={() => setSelectedIndex(i)}
									sx={{
										py: 0.4,
										px: 1.5,
										gap: 1,
										justifyContent: 'space-between',
										borderLeft: `3px solid ${isSelected ? color : 'transparent'}`,
										'&.Mui-selected': { backgroundColor: color + '20' },
										'&.Mui-selected:hover': { backgroundColor: color + '30' },
									}}
								>
									<Typography
										sx={{
											fontSize: 12,
											color: isSelected ? color : '#ffffffbb',
											fontWeight: isSelected ? 600 : 400,
										}}
									>
										{item.label}
									</Typography>
									{/* Версия — только когда версий несколько: иначе в списке две
									    неразличимые строки, и выбрать нужную нельзя. */}
									{item.version && (
										<Typography
											sx={{
												fontSize: 11,
												fontFamily: 'monospace',
												color: isSelected ? color : '#ffffffbb',
												opacity: 0.5,
												userSelect: 'none',
											}}
										>
											{item.version}
										</Typography>
									)}
								</ListItemButton>
							);
						})}
					</List>
				)}

				{query.trim() && displayedItems.length === 0 && (
					<Box sx={{ px: 1.5, py: 0.75 }}>
						<Typography sx={{ fontSize: 11, color: '#ffffff44' }}>No matching nodes</Typography>
					</Box>
				)}

				{!query.trim() && displayedItems.length === 0 && (
					<Box sx={{ px: 1.5, py: 0.75 }}>
						<Typography sx={{ fontSize: 11, color: '#ffffff44' }}>Start typing to search nodes</Typography>
					</Box>
				)}
			</Box>
		</>
	);
}

export default memo(QuickAddModal);
