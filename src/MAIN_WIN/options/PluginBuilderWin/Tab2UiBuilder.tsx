// Tab2 — UI Builder with real ReactFlow mini-flow
// Uses actual NodeShell, NodeHeader, GenericProperty, Comment, NodeResize, OutputHandle
// Same structure as GenericNode but with DnD property reordering + sidebar + right panel

import { useState, useCallback, useRef, useEffect, memo, createContext, useContext } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import type { UiJsonData, UiPropertyData } from './types';
import { makeDefaultProperty, validateUiJson } from './types';
import { SidebarComponentList } from './components/SidebarComponentList';
import { PropertySettingsPanel } from './PropertySettingsPanel';
import { NodeSettingsPanel } from './NodeSettingsPanel';
import { ComponentJsonEditor } from './ComponentJsonEditor';
import {
	DndContext,
	DragEndEvent,
	DragStartEvent,
	DragOverlay,
	closestCenter,
	PointerSensor,
	useSensor,
	useSensors,
	useDroppable,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ReactFlow, ReactFlowProvider, NodeProps, NodeChange, applyNodeChanges } from '@xyflow/react';
import { NodeContextProvider } from '@/NODE_WIN/hooks/useNodeContext';
import { Comment, GenericProperty, NodeHeader, NodeResize, NodeShell, OutputHandle } from '@/NODE_WIN/nodes/components';
import type { Property } from '@/NODE_WIN/definitions/types';
import { GripVertical, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import '@/NODE_WIN/nodes/index.css';
import '@/NODE_WIN/index.css';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const BUILD_NODE_ID = 'builder-preview';

// ─────────────────────────────────────────────────────────────────────────────
// Builder Context — shared between Tab2Inner and BuilderGenericNode
// ─────────────────────────────────────────────────────────────────────────────

interface BuilderContextValue {
	selectedPropId: string | null;
	setSelectedPropId: (id: string | null) => void;
	setPanelMode: (mode: 'types' | 'prop' | 'node') => void;
	deleteProperty: (id: string) => void;
	onChange: (uiJson: UiJsonData) => void;
}

const BuilderContext = createContext<BuilderContextValue>({
	selectedPropId: null,
	setSelectedPropId: () => {},
	setPanelMode: () => {},
	deleteProperty: () => {},
	onChange: () => {},
});

const useBuilderContext = () => useContext(BuilderContext);

// ─────────────────────────────────────────────────────────────────────────────
// BuilderPropertyWrapper — wraps real GenericProperty with sortable + selection
// ─────────────────────────────────────────────────────────────────────────────

function BuilderPropertyWrapper({ property }: { property: Property }) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: property.id });
	const { selectedPropId, setSelectedPropId, setPanelMode, deleteProperty } = useBuilderContext();
	const isSelected = selectedPropId === property.id;

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.3 : 1,
	};

	const handleClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			if (isSelected) return;
			setSelectedPropId(property.id);
			setPanelMode('prop');
		},
		[isSelected, property.id, setSelectedPropId, setPanelMode],
	);

	return (
		<Box
			ref={setNodeRef}
			style={style}
			data-prop-id={property.id}
			onClick={handleClick}
			className='nodrag'
			sx={{
				position: 'relative',
				cursor: 'pointer',
				bgcolor: isSelected ? 'rgba(144,202,249,0.08)' : 'transparent',
				borderLeft: '3px solid',
				borderLeftColor: isSelected ? 'primary.main' : 'transparent',
				'&:hover': { bgcolor: isSelected ? 'rgba(144,202,249,0.1)' : 'rgba(255,255,255,0.025)' },
				transition: 'background-color 0.15s',
			}}
		>
			{/* Drag handle (left edge) */}
			<Box
				{...attributes}
				{...listeners}
				sx={{
					position: 'absolute',
					left: 0,
					top: '50%',
					transform: 'translateY(-50%)',
					cursor: 'grab',
					opacity: 0,
					zIndex: 2,
					p: 0.25,
					'&:hover': { opacity: 0.7 },
					'.react-flow__node:hover &': { opacity: 0.35 },
				}}
			>
				<GripVertical size={20} />
			</Box>

			{/* Delete button (right edge) */}
			<IconButton
				size='small'
				onClick={(e) => {
					e.stopPropagation();
					deleteProperty(property.id);
				}}
				sx={{
					position: 'absolute',
					right: 2,
					top: 2,
					p: 0.15,
					opacity: 0,
					zIndex: 2,
					'&:hover': { opacity: 0.8, color: 'error.main' },
					'.react-flow__node:hover &': { opacity: 0.2 },
					transition: 'opacity 0.15s',
				}}
			>
				<Trash2 size={16} />
			</IconButton>

			{/* The REAL GenericProperty component */}
			<GenericProperty property={property} />
		</Box>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// BuilderGenericNode — uses actual node components (same as GenericNode)
// ─────────────────────────────────────────────────────────────────────────────

function BuilderGenericNodeInner(props: NodeProps) {
	const properties = (props.data.properties as Property[]) ?? [];
	const { setNodeRef: setDropRef, isOver } = useDroppable({ id: 'builder-drop-zone' });

	return (
		<NodeContextProvider nodeId={props.id}>
			<NodeShell nodeId={props.id} sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
				<NodeHeader />

				<SortableContext items={properties.map((p) => p.id)} strategy={verticalListSortingStrategy}>
					<Box
						ref={setDropRef}
						sx={{
							minHeight: 40,
							outline: isOver ? '2px dashed' : 'none',
							outlineColor: 'primary.main',
							outlineOffset: -2,
							transition: 'outline 0.15s',
						}}
					>
						{properties.map((p) => (
							<BuilderPropertyWrapper key={p.id} property={p} />
						))}
						{properties.length === 0 && (
							<Box sx={{ p: 3, textAlign: 'center', opacity: 0.3 }}>
								<Typography variant='caption' sx={{ fontSize: 11 }}>
									Перетащите компонент из панели слева
								</Typography>
							</Box>
						)}
					</Box>
				</SortableContext>

				<Comment />

				<div className='nodrag output-handlers'>
					<OutputHandle />
				</div>

				<NodeResize />
			</NodeShell>
		</NodeContextProvider>
	);
}

const BuilderGenericNode = memo(BuilderGenericNodeInner);

const BUILDER_NODE_TYPES: Record<string, typeof BuilderGenericNode> = {
	builderNode: BuilderGenericNode,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: convert between UiJsonData and ReactFlow node
// ─────────────────────────────────────────────────────────────────────────────

function uiJsonToNode(uiJson: UiJsonData) {
	return {
		id: BUILD_NODE_ID,
		type: 'builderNode' as const,
		position: { x: 40, y: 40 },
		width: uiJson.width,
		height: uiJson.height,
		data: {
			...uiJson.data,
			isUnique: true, // hides delete button in NodeHeader
			isValid: true, // always valid in builder so color is applied
		},
		selected: false,
		draggable: false,
		deletable: false,
	};
}

function nodeToUiJson(node: any, baseUiJson: UiJsonData): UiJsonData {
	const d = node.data ?? {};
	return {
		...baseUiJson,
		width: node.width ?? node.measured?.width ?? baseUiJson.width,
		height: node.height ?? node.measured?.height ?? baseUiJson.height,
		data: {
			label: d.label ?? baseUiJson.data.label,
			colorType: d.colorType ?? baseUiJson.data.colorType,
			comment: d.comment ?? baseUiJson.data.comment,
			properties: (d.properties ?? baseUiJson.data.properties) as UiPropertyData[],
			output: d.output ?? baseUiJson.data.output,
			isValid: d.isValid ?? baseUiJson.data.isValid,
		},
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab2Inner — lives inside ReactFlowProvider, uses CONTROLLED state
// ─────────────────────────────────────────────────────────────────────────────

interface Tab2InnerProps {
	initialUiJson: UiJsonData;
	onDragEndRef: React.MutableRefObject<((e: DragEndEvent) => void) | null>;
	onSyncRef: React.MutableRefObject<(() => UiJsonData) | null>;
	rightPanelWidth: number;
	onChange: (uiJson: UiJsonData) => void;
}

function Tab2Inner({ initialUiJson, onDragEndRef, onSyncRef, rightPanelWidth, onChange }: Tab2InnerProps) {
	// ── Controlled ReactFlow nodes state (same pattern as DocModal) ──
	const [nodes, setNodes] = useState(() => [uiJsonToNode(initialUiJson)]);

	const [selectedPropId, setSelectedPropId] = useState<string | null>(null);
	const [panelMode, setPanelMode] = useState<'types' | 'prop' | 'node'>('types');
	const uiJsonRef = useRef(initialUiJson);

	const gray15 = greyColor(15);
	const gray17 = greyColor(17);
	const gray40 = greyColor(40);

	// ── Resizable JSON editor pane (bottom of right panel) ──
	const [jsonHeight, setJsonHeight] = useState(300);
	const isJsonResizing = useRef(false);
	const startJY = useRef(0);
	const startJH = useRef(0);
	const onJsonResizeStart = useCallback(
		(e: React.MouseEvent) => {
			isJsonResizing.current = true;
			startJY.current = e.clientY;
			startJH.current = jsonHeight;
			e.preventDefault();
		},
		[jsonHeight],
	);
	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (!isJsonResizing.current) return;
			const delta = startJY.current - e.clientY; // drag up → taller editor
			setJsonHeight(Math.min(700, Math.max(120, startJH.current + delta)));
		};
		const onUp = () => {
			isJsonResizing.current = false;
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	}, []);

	// ── Handle ReactFlow node changes (resize, etc.) ──
	const onNodesChange = useCallback((changes: NodeChange[]) => {
		setNodes((nds) => applyNodeChanges(changes, nds) as typeof nds);
	}, []);

	// ── Sync back: extract uiJson from node state ──
	useEffect(() => {
		onSyncRef.current = () => {
			const node = nodes[0];
			if (!node) return uiJsonRef.current;
			return nodeToUiJson(node, uiJsonRef.current);
		};
	});

	// ── DnD end handler (bridge from DndContext outside ReactFlowProvider) ──
	useEffect(() => {
		onDragEndRef.current = (event: DragEndEvent) => {
			const { active, over } = event;
			if (!over) return;
			const activeId = String(active.id);
			const overId = String(over.id);

			if (activeId.startsWith('template-')) {
				// Drop from sidebar → add new property
				const controlType = active.data.current?.controlType as string;
				if (!controlType) return;
				let newPropId: string | null = null;
				setNodes((nds) =>
					nds.map((n) => {
						if (n.id !== BUILD_NODE_ID) return n;
						const existingIds = ((n.data as any).properties as UiPropertyData[]).map((p) => p.id);
						const newProp = makeDefaultProperty(controlType, existingIds);
						newPropId = newProp.id;
						const props = [...((n.data as any).properties as UiPropertyData[])];
						if (overId !== 'builder-drop-zone') {
							const idx = props.findIndex((p) => p.id === overId);
							if (idx >= 0) props.splice(idx, 0, newProp);
							else props.push(newProp);
						} else {
							props.push(newProp);
						}
						return { ...n, data: { ...n.data, properties: props } };
					}),
				);
				if (newPropId) {
					setSelectedPropId(newPropId);
					setPanelMode('prop');
				}
			} else if (activeId !== overId) {
				// Reorder properties within node
				setNodes((nds) =>
					nds.map((n) => {
						if (n.id !== BUILD_NODE_ID) return n;
						const props = (n.data as any).properties as UiPropertyData[];
						const oldIdx = props.findIndex((p) => p.id === activeId);
						const newIdx = props.findIndex((p) => p.id === overId);
						if (oldIdx < 0 || newIdx < 0) return n;
						return { ...n, data: { ...n.data, properties: arrayMove(props, oldIdx, newIdx) } };
					}),
				);
			}
		};
	});

	// ── Delete property ──
	const deleteProperty = useCallback(
		(id: string) => {
			setNodes((nds) =>
				nds.map((n) => {
					if (n.id !== BUILD_NODE_ID) return n;
					return {
						...n,
						data: {
							...n.data,
							properties: ((n.data as any).properties as UiPropertyData[]).filter((p) => p.id !== id),
						},
					};
				}),
			);
			if (selectedPropId === id) {
				setSelectedPropId(null);
				setPanelMode('types');
			}
		},
		[selectedPropId],
	);

	// ── Handle click on node background → show node settings ──
	const handleNodeClick = useCallback((_event: React.MouseEvent) => {
		// If a property wrapper was clicked, it handles it via stopPropagation
		// This fires only for node background clicks
		setSelectedPropId(null);
		setPanelMode('node');
	}, []);

	// ── Current node data ──
	const currentNode = nodes[0];
	const nodeData = currentNode?.data as any;
	const properties = (nodeData?.properties as UiPropertyData[]) ?? [];
	const selectedProp = selectedPropId ? properties.find((p) => p.id === selectedPropId) : null;

	// ── Build current uiJson for panels ──
	const currentUiJson: UiJsonData = currentNode ? nodeToUiJson(currentNode, uiJsonRef.current) : uiJsonRef.current;

	// ── Update property from right panel ──
	const updateProperty = useCallback(
		(updated: UiPropertyData) => {
			setNodes((nds) =>
				nds.map((n) => {
					if (n.id !== BUILD_NODE_ID) return n;
					const props = ((n.data as any).properties as UiPropertyData[]).map((p) => (p.id === selectedPropId ? updated : p));
					return { ...n, data: { ...n.data, properties: props } };
				}),
			);
			if (updated.id !== selectedPropId) setSelectedPropId(updated.id);
		},
		[selectedPropId],
	);

	// ── Update node data from NodeSettingsPanel ──
	const updateUiJson = useCallback((newUiJson: UiJsonData) => {
		uiJsonRef.current = newUiJson;
		setNodes((nds) =>
			nds.map((n) => {
				if (n.id !== BUILD_NODE_ID) return n;
				return {
					...n,
					width: newUiJson.width,
					height: newUiJson.height,
					data: {
						...n.data,
						label: newUiJson.data.label,
						colorType: newUiJson.data.colorType,
						comment: newUiJson.data.comment,
						output: newUiJson.data.output,
						properties: newUiJson.data.properties, // let raw-JSON edits reach the node
						isValid: true, // always valid in builder so color is applied
					},
				};
			}),
		);
	}, []);

	// ── Sync nodes back to parent on every change ──
	useEffect(() => {
		const current = onSyncRef.current?.();
		if (current) onChange(current);
	}, [nodes, onChange, onSyncRef]);

	// ── Validation ─
	const validationErrors = validateUiJson(currentUiJson);
	const isValid = validationErrors.length === 0;

	return (
		<BuilderContext.Provider value={{ selectedPropId, setSelectedPropId, setPanelMode, deleteProperty, onChange }}>
			<Box sx={{ display: 'flex', height: '100%', overflow: 'hidden', flex: 1, minWidth: 0 }}>
				{/* ── Center: ReactFlow canvas ── */}
				<Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
					<Box sx={{ flex: 1, position: 'relative' }}>
						<ReactFlow
							nodes={nodes}
							edges={[]}
							nodeTypes={BUILDER_NODE_TYPES}
							onNodesChange={onNodesChange}
							onNodeClick={handleNodeClick}
							nodesDraggable={false}
							panOnDrag={false}
							zoomOnScroll={false}
							zoomOnPinch={false}
							zoomOnDoubleClick={false}
							preventScrolling={false}
							proOptions={{ hideAttribution: true }}
							defaultViewport={{ x: 20, y: 20, zoom: 1 }}
							style={{ background: gray17 }}
							// Do NOT set elementsSelectable={false} — it adds pointer-events:none to nodes
						/>
					</Box>

					{/* Validation bar */}
					<Box
						sx={{
							px: 1.5,
							py: 0.5,
							flexShrink: 0,
							borderTop: `1px solid ${gray40}`,
							display: 'flex',
							alignItems: 'center',
							gap: 0.75,
							bgcolor: gray15,
						}}
					>
						{isValid ? (
							<>
								<CheckCircle2 size={13} color='#81c784' />
								<Typography variant='caption' sx={{ color: '#81c784', fontSize: 10.5 }}>
									Нода валидна
								</Typography>
							</>
						) : (
							<>
								<AlertCircle size={13} color='#ef5350' />
								<Typography variant='caption' sx={{ color: '#ef5350', fontSize: 10.5 }}>
									{validationErrors.join(' · ')}
								</Typography>
							</>
						)}
						<Typography variant='caption' sx={{ ml: 'auto', opacity: 0.4, fontSize: 10, fontFamily: 'monospace' }}>
							type: {currentUiJson.type} · {currentUiJson.width}×{currentUiJson.height}
						</Typography>
					</Box>
				</Box>

				{/* ── Right: Settings panel ── */}
				<Box
					sx={{
						width: rightPanelWidth,
						flexShrink: 0,
						bgcolor: gray15,
						borderLeft: `1px solid ${gray40}`,
						display: 'flex',
						flexDirection: 'column',
						overflow: 'hidden',
					}}
				>
					{panelMode === 'types' || (panelMode === 'prop' && !selectedProp) ? (
						<Box sx={{ p: 3, textAlign: 'center', opacity: 0.4 }}>
							<Typography variant='caption' sx={{ fontSize: 11 }}>
								Кликни на ноду для настроек
								<br />
								или на свойство для редактирования
							</Typography>
						</Box>
					) : (
						<>
							{/* Top: structured field editor */}
							<Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
								{panelMode === 'prop' && selectedProp ? (
									<PropertySettingsPanel
										property={selectedProp}
										outputSourceId={nodeData?.output?.sourceProperty}
										allPropertyIds={properties.map((p) => p.id)}
										onChange={updateProperty}
										onClose={() => {
											setSelectedPropId(null);
											setPanelMode('types');
										}}
									/>
								) : (
									<NodeSettingsPanel uiJson={currentUiJson} onChange={updateUiJson} onClose={() => setPanelMode('types')} />
								)}
							</Box>

							{/* Horizontal splitter */}
							<Box
								onMouseDown={onJsonResizeStart}
								sx={{
									height: 5,
									flexShrink: 0,
									cursor: 'ns-resize',
									bgcolor: gray40,
									'&:hover': { bgcolor: 'primary.main' },
									transition: 'background-color 0.2s',
								}}
							/>

							{/* Bottom: raw JSON editor of the selected target */}
							<Box sx={{ height: jsonHeight, flexShrink: 0, minHeight: 0 }}>
								{panelMode === 'node' ? (
									<ComponentJsonEditor editorKey='node' value={currentUiJson} onValidChange={updateUiJson} />
								) : (
									<ComponentJsonEditor editorKey={`prop:${selectedProp!.id}`} value={selectedProp} onValidChange={updateProperty} />
								)}
							</Box>
						</>
					)}
				</Box>
			</Box>
		</BuilderContext.Provider>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab2UiBuilder — DndContext wrapper + sidebar + ReactFlowProvider
// ─────────────────────────────────────────────────────────────────────────────

interface Tab2Props {
	uiJson: UiJsonData;
	onChange: (uiJson: UiJsonData) => void;
}

export function Tab2UiBuilder({ uiJson, onChange }: Tab2Props) {
	const [activeDragId, setActiveDragId] = useState<string | null>(null);
	const gray15 = greyColor(15);
	const gray40 = greyColor(40);

	// Refs that bridge DndContext ↔ ReactFlowProvider
	const onDragEndRef = useRef<((e: DragEndEvent) => void) | null>(null);
	const onSyncRef = useRef<(() => UiJsonData) | null>(null);

	// DnD
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
	const handleDragStart = (event: DragStartEvent) => setActiveDragId(String(event.active.id));
	const handleDragEnd = (event: DragEndEvent) => {
		setActiveDragId(null);
		onDragEndRef.current?.(event);
		// Sync after DnD
		setTimeout(() => {
			const current = onSyncRef.current?.();
			if (current) onChange(current);
		}, 50);
	};

	// Resizable right panel
	const [rightPanelWidth, setRightPanelWidth] = useState(420);
	const isResizing = useRef(false);
	const startRX = useRef(0);
	const startRW = useRef(0);

	const onResizeStart = useCallback(
		(e: React.MouseEvent) => {
			isResizing.current = true;
			startRX.current = e.clientX;
			startRW.current = rightPanelWidth;
			e.preventDefault();
		},
		[rightPanelWidth],
	);

	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (!isResizing.current) return;
			const delta = startRX.current - e.clientX;
			setRightPanelWidth(Math.min(600, Math.max(240, startRW.current + delta)));
		};
		const onUp = () => {
			isResizing.current = false;
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	}, []);

	return (
		<DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
			<Box sx={{ display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }}>
				{/* ── Left: Sidebar with draggable components ── */}
				<Box
					sx={{
						width: 200,
						flexShrink: 0,
						bgcolor: gray15,
						borderRight: `1px solid ${gray40}`,
						display: 'flex',
						flexDirection: 'column',
						overflow: 'hidden',
					}}
				>
					<SidebarComponentList />
				</Box>

				{/* ── Center + Right: inside ReactFlowProvider ── */}
				<ReactFlowProvider>
					<Tab2Inner
						initialUiJson={uiJson}
						onDragEndRef={onDragEndRef}
						onSyncRef={onSyncRef}
						rightPanelWidth={rightPanelWidth}
						onChange={onChange}
					/>
				</ReactFlowProvider>

				{/* ── Right panel resize handle (overlaid) ── */}
				<Box
					onMouseDown={onResizeStart}
					sx={{
						position: 'absolute',
						right: rightPanelWidth - 3,
						top: 0,
						bottom: 0,
						width: 6,
						cursor: 'ew-resize',
						zIndex: 10,
						'&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
						transition: 'background-color 0.2s',
					}}
				/>
			</Box>

			{/* DragOverlay */}
			<DragOverlay>
				{activeDragId?.startsWith('template-') && (
					<Box
						sx={{
							px: 1.5,
							py: 0.6,
							bgcolor: greyColor(25),
							border: '1px solid #90caf955',
							borderRadius: 1,
							fontSize: 12,
							color: '#90caf9',
							fontWeight: 500,
						}}
					>
						+ {activeDragId.replace('template-', '')}
					</Box>
				)}
			</DragOverlay>
		</DndContext>
	);
}
