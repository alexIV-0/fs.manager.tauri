import { createContext, useContext, memo, useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
	Box,
	Chip,
	Collapse,
	Divider,
	InputAdornment,
	Modal,
	Stack,
	TextField,
	ToggleButton,
	ToggleButtonGroup,
	Tooltip,
	Typography,
} from '@mui/material';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ReactFlow, ReactFlowProvider, NodeProps, NodeChange, applyNodeChanges, Background } from '@xyflow/react';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { getNodeDefinitions } from '@/NODE_WIN/definitions';
import { CustomNodeData, Property } from '@/NODE_WIN/definitions/types';
import { complimentColor } from '@/NODE_WIN/utils/complimentColor';
import { greyColor } from '@/Store/Color/grayColor';
import { NodeContextProvider } from '@/NODE_WIN/hooks/useNodeContext';
import { Comment, GenericProperty, NodeHeader, NodeResize, NodeShell, OutputHandle } from '@/NODE_WIN/nodes/components';
import '@/NODE_WIN/nodes/index.css';
import SidebarAccordion from './SidebarAccordion';
import MyDivider from '@/MAIN_WIN/Universal/myDivider';

/** Detect if a string contains HTML tags */
function isHtml(s: string): boolean {
	return /<[a-z][^>]*>/i.test(s);
}

// ── DocContext ────────────────────────────────────────────────────────────────
// Shared context between DocGenericNode (inside mini ReactFlow) and DocModal

interface DocContextValue {
	activePropertyId: string | null;
	onPropertyClick: (id: string) => void;
}

const DocContext = createContext<DocContextValue>({
	activePropertyId: null,
	onPropertyClick: () => {},
});

const useDocContext = () => useContext(DocContext);

// ── DocGenericNode ────────────────────────────────────────────────────────────
// Same as GenericNode. Each property wrapper gets a data-prop-id attribute
// so DocMiniFlow can detect which property was clicked via onNodeClick +
// DOM traversal — without wrapping with onClick (which would block inner controls).

function DocGenericNodeInner(props: NodeProps) {
	const properties = props.data.properties as Property[];
	const { activePropertyId } = useDocContext();

	return (
		<NodeContextProvider nodeId={props.id}>
			<NodeShell nodeId={props.id} sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
				<NodeHeader />
				{properties.map((property) => (
					<Box
						key={property.id}
						data-prop-id={property.id}
						sx={{
							position: 'relative',
							transition: 'background-color 0.2s',
							bgcolor: activePropertyId === property.id ? 'rgba(255,255,255,0.07)' : 'transparent',
						}}
					>
						<GenericProperty property={property} />
					</Box>
				))}
				<Comment />
				<div className='nodrag output-handlers'>
					<OutputHandle />
				</div>
				<NodeResize />
			</NodeShell>
		</NodeContextProvider>
	);
}

const DocGenericNode = memo(DocGenericNodeInner);

// ── DocSidebar ────────────────────────────────────────────────────────────────
// Left-side sidebar mirroring the main Sidebar behavior:
// resize by dragging right edge, ON/OFF/AUTO modes, same content.

type SidebarMode = 'on' | 'off' | 'auto';
const PEEK_W = 16;
const MIN_W = 160;
const MAX_W = 400;

interface DocSection {
	name: string;
	files: { name: string; fileName: string }[];
}

interface SelectedDoc {
	section: string;
	file: string;
}

interface DocSidebarProps {
	selectedNodeType: string | null;
	onNodeSelect: (type: string) => void;
	selectedDoc: SelectedDoc | null;
	onDocSelect: (section: string, file: string) => void;
}

const DOC_SECTION_COLOR = '#89b4fa';

function DocSidebar({ selectedNodeType, onNodeSelect, selectedDoc, onDocSelect }: DocSidebarProps) {
	const [mode, setMode] = useState<SidebarMode>('on');
	const [width, setWidth] = useState(220);
	const [visible, setVisible] = useState(true);
	const [docSections, setDocSections] = useState<DocSection[]>([]);
	const [search, setSearch] = useState('');
	const [openDocGroups, setOpenDocGroups] = useState<Record<string, boolean>>(() => {
		try {
			const saved = localStorage.getItem('doc-sidebar-groups');
			return saved ? JSON.parse(saved) : {};
		} catch {
			return {};
		}
	});

	useEffect(() => {
		localStorage.setItem('doc-sidebar-groups', JSON.stringify(openDocGroups));
	}, [openDocGroups]);

	const gray15 = greyColor(15);
	const gray40 = greyColor(40);
	const gray60 = greyColor(60);
	const gray80 = greyColor(80);

	useEffect(() => {
		window.docs
			.list()
			.then((sections) => setDocSections(sections))
			.catch((err) => {
				console.error('[DocSidebar] Failed to load docs:', err);
				setDocSections([]);
			});
	}, []);

	// Filter doc sections by search (match section name or any file name)
	const filteredDocSections = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return docSections;
		return docSections
			.map((section) => {
				const sectionMatches = section.name.toLowerCase().includes(q);
				const matchingFiles = section.files.filter((f) => f.name.toLowerCase().includes(q));
				if (sectionMatches) return section;
				if (matchingFiles.length > 0) return { ...section, files: matchingFiles };
				return null;
			})
			.filter((s): s is DocSection => s !== null);
	}, [docSections, search]);

	const isDocGroupOpen = (sectionName: string) => {
		if (search.trim()) return true;
		return openDocGroups[sectionName] ?? true;
	};

	const toggleDocGroup = (sectionName: string) => {
		setOpenDocGroups((prev) => ({ ...prev, [sectionName]: !isDocGroupOpen(sectionName) }));
	};

	// Resize by dragging right edge
	const isResizing = useRef(false);
	const startX = useRef(0);
	const startW = useRef(0);

	const onResizeStart = useCallback(
		(e: React.MouseEvent) => {
			isResizing.current = true;
			startX.current = e.clientX;
			startW.current = width;
			e.preventDefault();
		},
		[width],
	);

	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (!isResizing.current) return;
			const delta = e.clientX - startX.current; // right-drag grows the left sidebar
			setWidth(Math.min(MAX_W, Math.max(MIN_W, startW.current + delta)));
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

	// Mode effects
	useEffect(() => {
		if (mode === 'on') setVisible(true);
		if (mode === 'off') setVisible(false);
		if (mode === 'auto') setVisible(false);
	}, [mode]);

	const onPeekEnter = () => {
		if (mode === 'auto') setVisible(true);
	};
	const onPeekLeave = () => {
		if (mode === 'auto') setVisible(false);
	};
	const onPeekClick = () => {
		if (mode === 'off') setVisible((v) => !v);
	};

	return (
		<Box
			onMouseEnter={onPeekEnter}
			onMouseLeave={onPeekLeave}
			sx={{
				width: visible ? width : PEEK_W,
				flexShrink: 0,
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				bgcolor: gray15,
				borderRight: `1px solid ${gray40}`,
				position: 'relative',
				transition: 'width 0.25s ease',
				overflow: 'hidden',
				userSelect: 'none',
			}}
		>
			{/* Content — hidden when collapsed */}
			{visible && (
				<>
					<Box sx={{ flex: 1, overflow: 'auto', pt: 0.5, display: 'flex', flexDirection: 'column' }}>
						{/* Поиск — общий для Programm и Nodes */}
						<Box px={1} py={1}>
							<TextField
								size='small'
								fullWidth
								placeholder='Search...'
								value={search}
								onChange={(e) => setSearch(e.target.value)}
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

						<MyDivider text='Programm' />
						{filteredDocSections.length === 0 ? (
							<Box sx={{ px: 2, py: 1.5, opacity: 0.4 }}>
								<Typography variant='caption' sx={{ fontStyle: 'italic' }}>
									{search.trim() ? 'Ничего не найдено' : 'Документация не найдена'}
								</Typography>
							</Box>
						) : (
							<Stack direction='column' gap={0.5} px={1} py={0.5}>
								{filteredDocSections.map((section) => {
									const open = isDocGroupOpen(section.name);
									const textColor = complimentColor(DOC_SECTION_COLOR);
									return (
										<Box key={section.name}>
											<Stack
												direction='row'
												alignItems='center'
												gap={0.5}
												px={1}
												py={0.3}
												sx={{
													cursor: 'pointer',
													borderRadius: '4px',
													backgroundColor: DOC_SECTION_COLOR + '33',
													borderLeft: `3px solid ${DOC_SECTION_COLOR}`,
													userSelect: 'none',
													'&:hover': { backgroundColor: DOC_SECTION_COLOR + '55' },
												}}
												onClick={() => toggleDocGroup(section.name)}
											>
												{open ? (
													<ChevronDown size={14} color={DOC_SECTION_COLOR} />
												) : (
													<ChevronRight size={14} color={DOC_SECTION_COLOR} />
												)}
												<Typography fontSize={11} fontWeight={600} color={DOC_SECTION_COLOR} textTransform='uppercase'>
													{section.name}
												</Typography>
												<Typography fontSize={10} sx={{ opacity: 0.5, ml: 'auto', color: textColor }}>
													{section.files.length}
												</Typography>
											</Stack>

											<Collapse in={open}>
												<Stack direction='column' gap={0.2} pt={0.3} pb={0.3}>
													{section.files.map((file) => {
														const isActive = selectedDoc?.section === section.name && selectedDoc?.file === file.fileName;
														return (
															<Box
																key={file.fileName}
																onClick={() => onDocSelect(section.name, file.fileName)}
																sx={{
																	px: 1.5,
																	py: 0.5,
																	fontSize: 12,
																	color: isActive ? gray80 : gray60,
																	cursor: 'pointer',
																	borderRadius: '4px',
																	bgcolor: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
																	borderLeft: '2px solid',
																	borderLeftColor: isActive ? DOC_SECTION_COLOR : 'transparent',
																	'&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
																	transition: 'background-color 0.15s, border-left-color 0.15s',
																}}
															>
																{file.name}
															</Box>
														);
													})}
												</Stack>
											</Collapse>
										</Box>
									);
								})}
							</Stack>
						)}

						<MyDivider text='Nodes' />
						<Box sx={{ flex: 1, minHeight: 0 }}>
							<SidebarAccordion onNodeClick={onNodeSelect} selectedNodeType={selectedNodeType} externalSearch={search} />
						</Box>
					</Box>

					{/* Mode buttons at bottom */}
					<Stack alignItems='center' py={1} sx={{ borderTop: `1px solid ${gray40}` }}>
						<ToggleButtonGroup
							value={mode}
							exclusive
							onChange={(_, val) => {
								if (val) setMode(val);
							}}
							size='small'
							sx={{ height: 24 }}
						>
							<Tooltip title='Always visible'>
								<ToggleButton value='on' sx={{ px: 1.5, fontSize: 11 }}>
									ON
								</ToggleButton>
							</Tooltip>
							<Tooltip title='Hidden'>
								<ToggleButton value='off' sx={{ px: 1.5, fontSize: 11 }}>
									OFF
								</ToggleButton>
							</Tooltip>
							<Tooltip title='Show on hover'>
								<ToggleButton value='auto' sx={{ px: 1.5, fontSize: 11 }}>
									AUTO
								</ToggleButton>
							</Tooltip>
						</ToggleButtonGroup>
					</Stack>

					{/* Resize handle — right edge */}
					<Box
						onMouseDown={onResizeStart}
						sx={{
							position: 'absolute',
							right: 0,
							top: 0,
							bottom: 0,
							width: 5,
							cursor: 'ew-resize',
							zIndex: 10,
							'&:hover': { bgcolor: '#ffffff15' },
							transition: 'background-color 0.2s',
						}}
					/>
				</>
			)}

			{/* Peek strip when hidden */}
			{!visible && (
				<Box
					onClick={onPeekClick}
					sx={{
						position: 'absolute',
						right: 0,
						top: 0,
						bottom: 0,
						width: PEEK_W,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						cursor: 'pointer',
						'&::after': {
							content: '""',
							display: 'block',
							width: '3px',
							height: '40px',
							borderRadius: '2px',
							bgcolor: '#ffffff20',
							transition: 'background-color 0.2s',
						},
						'&:hover::after': { bgcolor: '#ffffff50' },
					}}
				/>
			)}
		</Box>
	);
}

// ── DocDescriptionEntry ───────────────────────────────────────────────────────

interface DocDescriptionEntryProps {
	property: Property;
	isActive: boolean;
	entryRef: (el: HTMLDivElement | null) => void;
}

function DocDescriptionEntry({ property, isActive, entryRef }: DocDescriptionEntryProps) {
	const cp = (property as any).controlProps ?? {};
	const label: string = cp.label ?? property.id;
	const tooltip: string = cp.tooltip ?? '';

	const gray80 = greyColor(80);
	const gray50 = greyColor(50);
	const gray15 = greyColor(15);

	return (
		<>
			<Box
				ref={entryRef}
				sx={{
					px: 2,
					py: 1.5,
					bgcolor: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
					borderLeft: '3px solid',
					borderLeftColor: isActive ? 'primary.main' : 'transparent',
					transition: 'background-color 0.3s, border-left-color 0.3s',
					scrollMarginTop: 8,
				}}
			>
				<Typography variant='body2' fontWeight={600} sx={{ color: gray80, mb: 0.75 }}>
					{label}
				</Typography>
				{tooltip ? (
					<Box sx={{ fontSize: 13, lineHeight: 1.6, color: gray50 }}>
						{isHtml(tooltip) ? (
							<div
								// eslint-disable-next-line react/no-danger
								dangerouslySetInnerHTML={{ __html: tooltip }}
								style={{ fontSize: 13, lineHeight: 1.6 }}
							/>
						) : (
							<ReactMarkdown
								components={{
									p: ({ node, ...props }) => <p style={{ margin: '0 0 6px 0' }} {...props} />,
									ul: ({ node, ...props }) => <ul style={{ paddingLeft: 20, margin: '6px 0' }} {...props} />,
									ol: ({ node, ...props }) => <ol style={{ paddingLeft: 20, margin: '6px 0' }} {...props} />,
									li: ({ node, ...props }) => <li style={{ marginBottom: 4 }} {...props} />,
									strong: ({ node, ...props }) => <strong style={{ color: '#eeeeee', fontWeight: 700 }} {...props} />,
									em: ({ node, ...props }) => <em style={{ fontStyle: 'italic' }} {...props} />,
									code: ({ node, ...props }) => (
										<code
											style={{
												backgroundColor: gray15,
												padding: '1px 4px',
												borderRadius: 4,
												fontFamily: 'monospace',
												fontSize: 12,
											}}
											{...props}
										/>
									),
									blockquote: ({ node, ...props }) => (
										<blockquote
											style={{
												borderLeft: '3px solid #89b4fa',
												paddingLeft: 12,
												margin: '8px 0',
												fontStyle: 'italic',
											}}
											{...props}
										/>
									),
									a: ({ node, ...props }) => <a style={{ color: '#89b4fa', textDecoration: 'underline' }} {...props} />,
									h1: ({ node, ...props }) => <h1 style={{ fontSize: 16, fontWeight: 700, margin: '8px 0 4px 0' }} {...props} />,
									h2: ({ node, ...props }) => <h2 style={{ fontSize: 15, fontWeight: 700, margin: '8px 0 4px 0' }} {...props} />,
									h3: ({ node, ...props }) => <h3 style={{ fontSize: 14, fontWeight: 600, margin: '6px 0 4px 0' }} {...props} />,
								}}
							>
								{tooltip}
							</ReactMarkdown>
						)}
					</Box>
				) : (
					<Typography variant='caption' sx={{ color: gray50, opacity: 0.5 }}>
						No description
					</Typography>
				)}
			</Box>
			<Divider sx={{ opacity: 0.25 }} />
		</>
	);
}

// ── DocMiniFlow ───────────────────────────────────────────────────────────────
// Isolated mini ReactFlow that renders a single doc node.
// Wrapped in its own ReactFlowProvider so it doesn't interfere with main flow.

interface DocMiniFlowProps {
	selectedNode: ReturnType<typeof getNodeDefinitions>[number];
	onWidthChange: (w: number) => void;
}

function DocMiniFlow({ selectedNode, onWidthChange }: DocMiniFlowProps) {
	const { onPropertyClick } = useDocContext();

	const initialWidth = selectedNode.width ?? 350;
	const initialHeight = selectedNode.height ?? 400;

	const initialNodes = useMemo(
		() => [
			{
				id: 'doc-preview',
				type: selectedNode.type ?? 'description',
				position: { x: 0, y: 0 },
				width: initialWidth,
				height: initialHeight,
				data: {
					...(selectedNode.data as CustomNodeData),
					isValid: true, // colored header
					isUnique: true, // no delete button in header
				},
				selected: false,
				draggable: false,
				deletable: false,
			},
		],
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[selectedNode.type],
	);

	const [nodes, setNodes] = useState(initialNodes);

	useEffect(() => {
		setNodes(initialNodes);
	}, [initialNodes]);

	const onNodesChange = useCallback(
		(changes: NodeChange[]) => {
			setNodes((nds) => applyNodeChanges(changes, nds) as typeof nds);
			changes.forEach((c) => {
				if (c.type === 'dimensions' && (c as any).dimensions?.width) {
					onWidthChange((c as any).dimensions.width);
				}
			});
		},
		[onWidthChange],
	);

	// Walk up the DOM from click target to find [data-prop-id] attribute
	const handleNodeClick = useCallback(
		(event: React.MouseEvent) => {
			let el = event.target as HTMLElement | null;
			while (el) {
				const propId = el.dataset.propId;
				if (propId) {
					onPropertyClick(propId);
					break;
				}
				el = el.parentElement;
			}
		},
		[onPropertyClick],
	);

	// All node types → DocGenericNode
	const allDefinitions = getNodeDefinitions();
	const docNodeTypes = useMemo(() => {
		const types: Record<string, typeof DocGenericNode> = {};
		allDefinitions.forEach((n) => {
			if (n.type) types[n.type] = DocGenericNode;
		});
		return types;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const gray17 = greyColor(17);

	return (
		<ReactFlow
			nodes={nodes}
			edges={[]}
			nodeTypes={docNodeTypes}
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
			// Do NOT set elementsSelectable={false} — it adds pointer-events:none to nodes,
			// which blocks all clicks to inner property controls.
		/>
	);
}

// ── DocModal ──────────────────────────────────────────────────────────────────

interface DocModalProps {
	open: boolean;
	onClose: () => void;
}

function DocModal({ open, onClose }: DocModalProps) {
	const colorTypes = colorTypes_store((s) => s.colorTypes);

	const [selectedType, setSelectedType] = useState<string | null>(null);
	const [activePropertyId, setActivePropertyId] = useState<string | null>(null);
	const [selectedDoc, setSelectedDoc] = useState<SelectedDoc | null>(null);
	const [docContent, setDocContent] = useState<string>('');
	// Width of the mini ReactFlow container — tracks node resize
	const [canvasWidth, setCanvasWidth] = useState(370);

	const gray15 = greyColor(15);
	const gray40 = greyColor(40);
	const gray30 = greyColor(30);
	const gray60 = greyColor(60);

	// Refs to description entries for scroll-into-view
	const descRefs = useRef<Record<string, HTMLDivElement | null>>({});

	useEffect(() => {
		if (!open) {
			setSelectedType(null);
			setActivePropertyId(null);
			setSelectedDoc(null);
			setDocContent('');
		}
	}, [open]);

	useEffect(() => {
		if (!selectedDoc) {
			setDocContent('');
			return;
		}
		let cancelled = false;
		window.docs
			.read(selectedDoc.section, selectedDoc.file)
			.then((content) => {
				if (!cancelled) setDocContent(content);
			})
			.catch((err) => {
				console.error('[DocModal] Failed to read doc:', err);
				if (!cancelled) setDocContent(`_Не удалось загрузить: ${err?.message ?? 'unknown error'}_`);
			});
		return () => {
			cancelled = true;
		};
	}, [selectedDoc]);

	const nodes = getNodeDefinitions();

	const selectedNode = useMemo(() => (selectedType ? (nodes.find((n) => n.type === selectedType) ?? null) : null), [selectedType, nodes]);

	const selectedData = selectedNode?.data as CustomNodeData | undefined;
	const nodeColor = selectedData ? ((colorTypes[selectedData.colorType] as string) ?? (colorTypes.default as string)) : null;
	const nodeTc = nodeColor ? complimentColor(nodeColor) : '#fff';

	// Properties that have tooltip → shown in description panel
	const propertiesWithDesc = useMemo(() => (selectedData?.properties ?? []).filter((p) => !!(p as any).controlProps?.tooltip), [selectedData]);

	const handlePropertyClick = useCallback((propertyId: string) => {
		setActivePropertyId(propertyId);
		// Scroll description entry into view
		setTimeout(() => {
			descRefs.current[propertyId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}, 0);
	}, []);

	const handleNodeSelect = useCallback((type: string) => {
		setSelectedType(type);
		setActivePropertyId(null);
		setSelectedDoc(null);
		setCanvasWidth(370);
	}, []);

	const handleDocSelect = useCallback((section: string, file: string) => {
		setSelectedDoc({ section, file });
		setSelectedType(null);
		setActivePropertyId(null);
	}, []);

	const handleWidthChange = useCallback((w: number) => {
		setCanvasWidth(w + 40); // node width + padding
	}, []);

	const docContextValue = useMemo(() => ({ activePropertyId, onPropertyClick: handlePropertyClick }), [activePropertyId, handlePropertyClick]);

	return (
		<Modal open={open} onClose={onClose}>
			<Box
				sx={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: 'translate(-50%, -50%)',
					width: '96vw',
					height: '88vh',
					display: 'flex',
					flexDirection: 'row',
					bgcolor: gray15,
					border: `1px solid ${gray40}`,
					borderRadius: 2,
					boxShadow: 24,
					overflow: 'hidden',
				}}
			>
				{/* ── Left: sidebar ──────────────────────────────────────────── */}
				<DocSidebar selectedNodeType={selectedType} onNodeSelect={handleNodeSelect} selectedDoc={selectedDoc} onDocSelect={handleDocSelect} />

				{/* ── Right: content ─────────────────────────────────────────── */}
				<Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
					{selectedDoc ? (
						<Box sx={{ flex: 1, overflow: 'auto', px: 4, py: 3 }}>
							<Box
								sx={{
									maxWidth: 820,
									color: gray60,
									fontSize: 14,
									lineHeight: 1.65,
									'& h1': { fontSize: 24, fontWeight: 700, mt: 0, mb: 1.5, color: '#eee' },
									'& h2': { fontSize: 19, fontWeight: 700, mt: 2.5, mb: 1, color: '#eee' },
									'& h3': { fontSize: 16, fontWeight: 600, mt: 2, mb: 0.75, color: '#eee' },
									'& p': { margin: '0 0 10px 0' },
									'& ul, & ol': { paddingLeft: 3, margin: '8px 0' },
									'& li': { marginBottom: '4px' },
									'& li p': { margin: 0 },
									'& img': { maxWidth: '100%', borderRadius: '4px', display: 'block', margin: '12px 0' },
									'& strong': { color: '#eee', fontWeight: 700 },
									'& em': { fontStyle: 'italic' },
									'& code': {
										bgcolor: gray15,
										px: '4px',
										py: '1px',
										borderRadius: '4px',
										fontFamily: 'monospace',
										fontSize: 12,
									},
									'& pre': {
										bgcolor: gray15,
										p: 1.5,
										borderRadius: 1,
										overflow: 'auto',
										fontSize: 12,
										lineHeight: 1.5,
									},
									'& blockquote': {
										borderLeft: '3px solid #89b4fa',
										paddingLeft: 2,
										margin: '10px 0',
										fontStyle: 'italic',
									},
									'& a': { color: '#89b4fa', textDecoration: 'underline' },
								}}
							>
								<ReactMarkdown>{docContent}</ReactMarkdown>
							</Box>
						</Box>
					) : !selectedNode ? (
						<Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
							<Typography variant='body2'>Выберите документ или ноду слева</Typography>
						</Box>
					) : (
						<>
							{/* Node info header */}
							<Box sx={{ px: 2.5, py: 1.5, flexShrink: 0, borderBottom: `1px solid ${gray40}` }}>
								<Stack direction='row' alignItems='center' gap={1.5} mb={selectedData!.comment ? 0.5 : 0}>
									<Box sx={{ px: 1.5, py: 0.4, bgcolor: nodeColor ?? 'transparent', borderRadius: 1 }}>
										<Typography variant='h6' sx={{ color: nodeTc, fontWeight: 700, lineHeight: 1.3 }}>
											{selectedData!.label}
										</Typography>
									</Box>
									<Chip
										label={selectedData!.colorType}
										size='small'
										variant='outlined'
										sx={{
											height: 20,
											borderColor: nodeColor ?? gray30,
											color: nodeColor ?? gray60,
											'& .MuiChip-label': { px: 1, fontSize: '0.65rem' },
										}}
									/>
								</Stack>
								{selectedData!.comment && (
									<Box
										sx={{
											color: gray60,
											mt: 0.5,
											fontSize: 14,
											lineHeight: 1.5,
											'& p': { margin: '0 0 4px 0' },
											'& ul, & ol': { paddingLeft: 2.5, margin: '4px 0' },
											'& strong': { fontWeight: 700 },
											'& em': { fontStyle: 'italic' },
										}}
										dangerouslySetInnerHTML={{ __html: selectedData!.comment }}
									/>
								)}
							</Box>

							{/* Two-area row: node preview + descriptions (no visual separator) */}
							<DocContext.Provider value={docContextValue}>
								<Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
									{/* Mini ReactFlow — width tracks node resize */}
									<Box
										sx={{
											width: canvasWidth,
											flexShrink: 0,
											overflow: 'hidden',
											transition: 'width 0.1s',
										}}
									>
										<ReactFlowProvider>
											<DocMiniFlow selectedNode={selectedNode} onWidthChange={handleWidthChange} />
										</ReactFlowProvider>
									</Box>

									{/* Descriptions — fills remaining width */}
									<Box sx={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
										{propertiesWithDesc.length === 0 ? (
											<Box sx={{ p: 3, opacity: 0.4 }}>
												<Typography variant='body2'>No property descriptions available</Typography>
											</Box>
										) : (
											propertiesWithDesc.map((property) => (
												<DocDescriptionEntry
													key={property.id}
													property={property}
													isActive={activePropertyId === property.id}
													entryRef={(el) => {
														descRefs.current[property.id] = el;
													}}
												/>
											))
										)}
									</Box>
								</Box>
							</DocContext.Provider>
						</>
					)}
				</Box>
			</Box>
		</Modal>
	);
}

export default memo(DocModal);
