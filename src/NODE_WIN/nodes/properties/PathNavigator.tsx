import { PathNavigatorProperty, CustomNodeData, Property } from '@/NODE_WIN/definitions/types';
import { commands, unwrap } from '@/Utils/specta';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useCascadeValidation } from '@/NODE_WIN/hooks/useCascadeValidation';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { greyColor } from '@/Store/Color/grayColor';
import { typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import { usePathStore } from '@/Store/Node/usePathStore';
import { Box, List, ListItem, ListItemButton, Paper, Popper, Stack, Typography } from '@mui/material';
import { useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react';
import { Folder, File, ChevronRight } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import InputHandle from '../components/InputHandle';
import PropertyLabelEditor from './PropertyLabelEditor';
import TooltipOrDelete from './TooltipOrDelete';
import { joinPath } from '@/Utils/joinPath';

interface PathNavigatorProps {
	property: PathNavigatorProperty;
	onChange?: (value: string) => void;
}

interface FsItem {
	name: string;
	isDir: boolean;
}

function PathNavigator({ property, onChange }: PathNavigatorProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const updateNodeInternals = useUpdateNodeInternals();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const defColor = colorTypes.default as string;
	const fileTypes = typeOfFile_store((s) => s.patternStore);
	// useViewport() ре-рендерит на каждый pan-tick. Подписываемся только на zoom.
	const zoom = useStore((s) => s.transform[2]);
	const { handleEdgeRemoval, handleNodePropertyChange } = useCascadeValidation();
	const { path: projectPath } = usePathStore();

	const { controlProps } = property;
	const editLabel = controlProps?.editLabel ?? false;
	const tooltip = controlProps?.tooltip ?? '';
	const isDynamic = editLabel && !tooltip;

	const [value, setValue] = useState<string>(controlProps.value ?? '');
	const [activeSegIndex, setActiveSegIndex] = useState<number | null>(null);
	const [items, setItems] = useState<FsItem[]>([]);
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

	const containerRef = useRef<HTMLDivElement>(null);
	const segRefs = useRef<Map<number, HTMLElement>>(new Map());

	const segments = value ? value.split('/').filter(Boolean) : [];

	useEffect(() => {
		setValue(controlProps.value ?? '');
	}, [controlProps.value]);

	const loadItems = useCallback(
		async (segsUpTo: string[]) => {
			if (!projectPath) return;
			const dirPath = segsUpTo.length > 0 ? joinPath(projectPath, ...segsUpTo) : projectPath;
			try {
				const result = (await window.electronAPI.invoke('getSomeFromFolder', dirPath, [
					{ type: 'folders', ext: [] },
					{ type: 'files', ext: [] },
				])) as { folders: string[]; files: string[] };
				const folders: FsItem[] = (result?.folders ?? []).map((name) => ({ name, isDir: true }));
				const files: FsItem[] = (result?.files ?? []).map((name) => ({ name, isDir: false }));
				setItems([...folders, ...files]);
			} catch {
				setItems([]);
			}
		},
		[projectPath],
	);

	const handleSegmentClick = useCallback(
		async (segIndex: number, e: React.MouseEvent<HTMLElement>) => {
			e.stopPropagation();
			if (activeSegIndex === segIndex) {
				setActiveSegIndex(null);
				setAnchorEl(null);
				return;
			}
			setActiveSegIndex(segIndex);
			setAnchorEl(e.currentTarget);
			await loadItems(segments.slice(0, segIndex));
		},
		[activeSegIndex, loadItems, segments],
	);

	const handleAppendClick = useCallback(
		async (e: React.MouseEvent<HTMLElement>) => {
			e.stopPropagation();
			const nextIndex = segments.length;
			if (activeSegIndex === nextIndex) {
				setActiveSegIndex(null);
				setAnchorEl(null);
				return;
			}
			setActiveSegIndex(nextIndex);
			setAnchorEl(containerRef.current);
			await loadItems(segments);
		},
		[activeSegIndex, segments, loadItems],
	);

	const handleSelectItem = useCallback(
		async (item: FsItem) => {
			if (activeSegIndex === null) return;

			if (item.name === 'Custom File...') {
				const paths = unwrap(await commands.selectFiles({ multiSelect: false }));
				if (paths?.length) {
					const newValue = paths[0];
					setValue(newValue);
					onChange?.(newValue);
					const nodeData = reactFlow.getNode(nodeId)?.data as CustomNodeData;
					if (!nodeData) return;
					const updatedProps = (nodeData.properties as Property[]).map((p) =>
						p.id === property.id ? { ...p, controlProps: { ...p.controlProps, value: newValue } } : p,
					);
					reactFlow.updateNode(nodeId, (n) => ({ ...n, data: { ...n.data, properties: updatedProps } }));
					setTimeout(() => handleNodePropertyChange(nodeId), 0);
				}
				setActiveSegIndex(null);
				setAnchorEl(null);
				return;
			}

			if (item.name === 'Custom Folder...') {
				const paths = unwrap(await commands.selectFolders({ multiSelect: false }));
				if (paths?.length) {
					const newValue = paths[0];
					setValue(newValue);
					onChange?.(newValue);
					const nodeData = reactFlow.getNode(nodeId)?.data as CustomNodeData;
					if (!nodeData) return;
					const updatedProps = (nodeData.properties as Property[]).map((p) =>
						p.id === property.id ? { ...p, controlProps: { ...p.controlProps, value: newValue } } : p,
					);
					reactFlow.updateNode(nodeId, (n) => ({ ...n, data: { ...n.data, properties: updatedProps } }));
					setTimeout(() => handleNodePropertyChange(nodeId), 0);
				}
				setActiveSegIndex(null);
				setAnchorEl(null);
				return;
			}

			const newSegs = [...segments.slice(0, activeSegIndex), item.name];
			const newValue = newSegs.join('/');

			setValue(newValue);
			onChange?.(newValue);

			const nodeData = reactFlow.getNode(nodeId)?.data as CustomNodeData;
			if (!nodeData) return;
			const updatedProps = (nodeData.properties as Property[]).map((p) =>
				p.id === property.id ? { ...p, controlProps: { ...p.controlProps, value: newValue } } : p,
			);
			reactFlow.updateNode(nodeId, (n) => ({ ...n, data: { ...n.data, properties: updatedProps } }));
			setTimeout(() => handleNodePropertyChange(nodeId), 0);

			if (item.isDir) {
				await loadItems(newSegs);
				setActiveSegIndex(newSegs.length);
				setAnchorEl(containerRef.current);
				return;
			}

			setActiveSegIndex(null);
			setAnchorEl(null);
		},
		[activeSegIndex, segments, nodeId, property.id, reactFlow, onChange, handleNodePropertyChange, loadItems],
	);

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setActiveSegIndex(null);
				setAnchorEl(null);
			}
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, []);

	const handleSaveLabel = useCallback(
		(newLabel: string) => {
			reactFlow.updateNode(nodeId, (node) => {
				const nodeData = node.data as CustomNodeData;
				const updatedProperties = (nodeData.properties as Property[]).map((p) =>
					p.id === property.id ? { ...p, controlProps: { ...p.controlProps, label: newLabel } } : p,
				);
				return { ...node, data: { ...nodeData, properties: updatedProperties } };
			});
		},
		[nodeId, property.id, reactFlow],
	);

	const handleDelete = useCallback(() => {
		const incomingEdges = reactFlow.getEdges().filter((e) => e.target === nodeId && e.targetHandle === property.id);
		if (incomingEdges.length > 0) {
			reactFlow.setEdges((eds) => eds.filter((e) => !(e.target === nodeId && e.targetHandle === property.id)));
		}
		reactFlow.updateNode(nodeId, (node) => {
			const nodeData = node.data as CustomNodeData;
			const updatedProperties = (nodeData.properties as Property[]).filter((p) => p.id !== property.id);
			return { ...node, data: { ...nodeData, properties: updatedProperties } };
		});
		setTimeout(() => {
			incomingEdges.forEach((edge) => handleEdgeRemoval(edge));
			handleNodePropertyChange(nodeId);
			updateNodeInternals(nodeId);
		}, 0);
	}, [nodeId, property.id, reactFlow, handleEdgeRemoval, handleNodePropertyChange, updateNodeInternals]);

	const borderColor = greyColor(25);
	const bgColor = greyColor(15);
	const hoverColor = greyColor(22);
	const segColor = greyColor(80);
	const sepColor = greyColor(40);

	return (
		<Stack direction='column' px='12px' className='nodrag' gap={0.5}>
			<Stack direction='row' alignItems='center' gap={1}>
				{property.isInput && <InputHandle property={property} />}
				<PropertyLabelEditor label={controlProps?.label ?? ''} editLabel={editLabel} onSave={handleSaveLabel} />
				<TooltipOrDelete isDynamic={isDynamic} tooltip={tooltip} onDelete={handleDelete} />
			</Stack>

			<Box
				ref={containerRef}
				onClick={handleAppendClick}
				sx={{
					display: 'flex',
					alignItems: 'center',
					flexWrap: 'wrap',
					gap: '2px',
					minHeight: 32,
					px: 1,
					py: '4px',
					border: `1px solid ${borderColor}`,
					borderRadius: '4px',
					backgroundColor: bgColor,
					cursor: 'pointer',
					userSelect: 'none',
				}}
			>
				{segments.length === 0 && (
					<Typography sx={{ fontSize: '1.1rem', color: greyColor(40), flex: 1, pointerEvents: 'none' }}>Click to browse...</Typography>
				)}

				{segments.map((seg, i) => {
					const isLast = i === segments.length - 1;
					const isActive = activeSegIndex === i;
					return (
						<Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
							{i > 0 && <ChevronRight size={12} color={sepColor} style={{ flexShrink: 0 }} />}
							<Box
								onClick={(e) => handleSegmentClick(i, e)}
								sx={{
									px: '4px',
									py: '1px',
									borderRadius: '3px',
									fontSize: '1.1rem',
									color: isActive ? '#fff' : segColor,
									backgroundColor: isActive ? greyColor(35) : 'transparent',
									cursor: 'pointer',
									display: 'flex',
									alignItems: 'center',
									gap: '4px',
									'&:hover': { backgroundColor: greyColor(28), color: '#fff' },
									transition: 'background-color 0.15s',
								}}
							>
								{isLast && !seg.includes('.') ? <Folder size={12} /> : isLast ? <File size={12} /> : null}
								{seg}
							</Box>
						</Box>
					);
				})}

				{segments.length > 0 && !segments[segments.length - 1].includes('.') && (
					<Box
						onClick={(e) => e.stopPropagation()}
						sx={{
							px: '4px',
							py: '1px',
							borderRadius: '3px',
							color: greyColor(35),
							display: 'flex',
							alignItems: 'center',
						}}
					>
						<ChevronRight size={12} />
					</Box>
				)}
			</Box>

			{/* Backdrop — перехватывает клики и скролл канваса пока дропдаун открыт */}
			{activeSegIndex !== null && (
				<Box
					onMouseDown={() => {
						setActiveSegIndex(null);
						setAnchorEl(null);
					}}
					onWheel={(e) => e.stopPropagation()}
					sx={{ position: 'fixed', inset: 0, zIndex: 1299 }}
				/>
			)}

			<Popper
				open={activeSegIndex !== null && Boolean(anchorEl)}
				anchorEl={containerRef.current}
				placement='bottom-start'
				style={{ zIndex: 1300, width: containerRef.current?.offsetWidth }}
				modifiers={[{ name: 'offset', options: { offset: [0, 4] } }]}
			>
				<Paper
					className='nowheel'
					sx={{
						width: '100%',
						maxHeight: 280,
						overflowY: 'auto',
						backgroundColor: greyColor(18),
						border: `1px solid ${borderColor}`,
						transform: `scale(${zoom}) !important`,
						transformOrigin: 'top left',
					}}
				>
					<List dense disablePadding>
						{items.map((item) => {
							const ext = item.name.includes('.') ? item.name.split('.').pop()?.toLowerCase() : '';
							const typeColor = !item.isDir && ext ? fileTypes.find((ft) => ft.path.includes(ext))?.color : undefined;
							return (
								<ListItem key={item.name} disablePadding>
									<ListItemButton
										onMouseDown={(e) => {
											e.preventDefault();
											handleSelectItem(item);
										}}
										sx={{
											gap: 1,
											py: '3px',
											fontSize: '1.1rem',
											color: segColor,
											'&:hover': { backgroundColor: hoverColor, color: '#fff' },
										}}
									>
										{item.isDir ? (
											<Folder size={14} color={greyColor(60)} style={{ flexShrink: 0 }} />
										) : (
											<Box
												component='span'
												sx={{
													width: 8,
													height: 8,
													borderRadius: '50%',
													flexShrink: 0,
													backgroundColor: typeColor ?? greyColor(50),
												}}
											/>
										)}
										<Typography sx={{ fontSize: '1.1rem', lineHeight: 1.4 }}>{item.name}</Typography>
									</ListItemButton>
								</ListItem>
							);
						})}
						{[{ name: 'Custom File...', isDir: false }].map((item) => (
							<ListItem key={item.name} disablePadding>
								<ListItemButton
									onMouseDown={(e) => {
										e.preventDefault();
										handleSelectItem(item);
									}}
									sx={{
										gap: 1,
										py: '3px',
										color: greyColor(55),
										'&:hover': { backgroundColor: hoverColor },
									}}
								>
									<Typography sx={{ fontSize: '1.1rem', lineHeight: 1.4, fontStyle: 'italic' }}>{item.name}</Typography>
								</ListItemButton>
							</ListItem>
						))}
					</List>
				</Paper>
			</Popper>
		</Stack>
	);
}

export default memo(PathNavigator);
