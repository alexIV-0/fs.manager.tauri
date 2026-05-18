import { JsonNavigatorProperty, CustomNodeData, Property } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useCascadeValidation } from '@/NODE_WIN/hooks/useCascadeValidation';
import { greyColor } from '@/Store/Color/grayColor';
import { usePathStore } from '@/Store/Node/usePathStore';
import { Box, InputBase, List, ListItem, ListItemButton, Paper, Popper, Stack, Typography } from '@mui/material';
import { useEdges, useNodesData, useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react';
import { ChevronRight, Braces, FileJson, Brackets, Search } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import InputHandle from '../components/InputHandle';
import PropertyLabelEditor from './PropertyLabelEditor';
import TooltipOrDelete from './TooltipOrDelete';
import { joinPath } from '@/Utils/joinPath';

interface JsonNavigatorProps {
	property: JsonNavigatorProperty;
	onChange?: (value: string) => void;
}

interface SearchResult {
	path: string[];
	displayPath: string;
	valuePreview: string;
	isLeaf: boolean;
}

// Возвращает ключи/индексы на заданном уровне (поддерживает массивы)
function getKeysAtPath(json: any, keyPath: string[]): string[] {
	let current = json;
	for (const key of keyPath) {
		if (current === null || typeof current !== 'object') return [];
		current = (current as any)[key];
	}
	if (current === null || typeof current !== 'object') return [];
	if (Array.isArray(current)) return current.map((_, i) => String(i));
	return Object.keys(current);
}

function isArrayAtPath(json: any, keyPath: string[]): boolean {
	let current = json;
	for (const key of keyPath) {
		if (current === null || typeof current !== 'object') return false;
		current = (current as any)[key];
	}
	return Array.isArray(current);
}

function getValueType(json: any, keyPath: string[]): string {
	let current = json;
	for (const key of keyPath) {
		if (current === null || typeof current !== 'object') return '';
		current = (current as any)[key];
	}
	if (current === null) return 'null';
	if (Array.isArray(current)) return 'array';
	return typeof current;
}

function buildDisplayPath(path: string[], json: any): string {
	const parts: string[] = [];
	let current = json;
	for (const key of path) {
		const parentIsArr = Array.isArray(current);
		parts.push(parentIsArr ? `[${key}]` : key);
		if (current !== null && typeof current === 'object') {
			current = (current as any)[key];
		}
	}
	return parts.join('.');
}

function searchJson(json: any, query: string): SearchResult[] {
	if (!query || query.length < 2) return [];
	const q = query.toLowerCase();
	const results: SearchResult[] = [];

	function traverse(obj: any, path: string[]) {
		if (results.length >= 50) return;
		if (obj === null || typeof obj !== 'object') return;

		const keys = Array.isArray(obj) ? obj.map((_, i) => String(i)) : Object.keys(obj);
		for (const key of keys) {
			if (results.length >= 50) return;
			const val = (obj as any)[key];
			const newPath = [...path, key];
			const isLeaf = val === null || typeof val !== 'object';

			const keyMatches = !Array.isArray(obj) && key.toLowerCase().includes(q);
			const valMatches = isLeaf && String(val).toLowerCase().includes(q);

			if (keyMatches || valMatches) {
				results.push({
					path: newPath,
					displayPath: buildDisplayPath(newPath, json),
					valuePreview: isLeaf ? String(val).slice(0, 40) : '',
					isLeaf,
				});
			}

			if (!isLeaf) traverse(val, newPath);
		}
	}

	traverse(json, []);
	return results;
}

// "key.subkey.leaf:video" -> { keys: ["key","subkey","leaf"], suffix: ":video" }
function parseValue(val: string): { keys: string[]; suffix: string } {
	const colonIdx = val.lastIndexOf(':');
	if (colonIdx !== -1) {
		const keysStr = val.slice(0, colonIdx);
		const suffix = val.slice(colonIdx);
		return { keys: keysStr ? keysStr.split('.').filter(Boolean) : [], suffix };
	}
	return { keys: val ? val.split('.').filter(Boolean) : [], suffix: '' };
}

function JsonNavigator({ property, onChange }: JsonNavigatorProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const updateNodeInternals = useUpdateNodeInternals();
	const { handleEdgeRemoval, handleNodePropertyChange } = useCascadeValidation();
	const { path: projectPath } = usePathStore();
	// useViewport() ре-рендерит на каждый pan-tick. Подписываемся только на zoom.
	const zoom = useStore((s) => s.transform[2]);
	const edges = useEdges();

	const { controlProps } = property;
	const editLabel = controlProps?.editLabel ?? false;
	const tooltip = controlProps?.tooltip ?? '';
	const isDynamic = editLabel && !tooltip;

	const [value, setValue] = useState<string>(controlProps.value ?? '');
	const [jsonData, setJsonData] = useState<any>(null);
	const [jsonLoadError, setJsonLoadError] = useState<string>('');
	const [activeKeyIndex, setActiveKeyIndex] = useState<number | null>(null);
	const [dropdownKeys, setDropdownKeys] = useState<string[]>([]);
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
	const [searchQuery, setSearchQuery] = useState<string>('');

	const containerRef = useRef<HTMLDivElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const popperRef = useRef<HTMLDivElement>(null);
	const valueRef = useRef(value);

	const { keys: keySegments } = parseValue(value);

	// Реактивно читаем значение source property (pathNavigator или другого)
	const nodeSnapshot = useNodesData(nodeId);
	const jsonSourcePath = useMemo(() => {
		if (!nodeSnapshot) return '';
		const props = (nodeSnapshot.data as CustomNodeData).properties as Property[];
		const sourceId = controlProps.jsonSourcePropertyId;
		if (sourceId) {
			const sourceProp = props.find((p) => p.id === sourceId);
			if (sourceProp) {
				const val = (sourceProp.controlProps as any)?.value;
				return Array.isArray(val) ? (val[0] ?? '') : (val ?? '');
			}
		}
		for (const p of props) {
			if (p.id === property.id) continue;
			if (p.controlType === 'pathNavigator') {
				const val = (p.controlProps as any)?.value ?? '';
				if (val) return val as string;
			}
		}
		for (const p of props) {
			if (p.id === property.id) continue;
			const val = (p.controlProps as any)?.value;
			const strVal = Array.isArray(val) ? val[0] : val;
			if (typeof strVal === 'string' && strVal.endsWith('.json')) return strVal;
		}
		return '';
	}, [nodeSnapshot, controlProps.jsonSourcePropertyId, property.id]);

	// Тип из подключённого inputHandle
	const inputType = useMemo(() => {
		const edge = edges.find((e) => e.target === nodeId && e.targetHandle === property.id);
		if (!edge) return '';
		const sourceNode = reactFlow.getNode(edge.source);
		const co = sourceNode?.data?.computedOutput as Record<string, { type: string }> | null;
		return co?.[edge.sourceHandle ?? '']?.type ?? '';
	}, [edges, nodeId, property.id, reactFlow]);

	useEffect(() => {
		setValue(controlProps.value ?? '');
	}, [controlProps.value]);

	// Синхронизируем ref чтобы не было stale closure в эффекте ниже
	useEffect(() => {
		valueRef.current = value;
	}, [value]);

	// При смене JSON обрезаем путь до ближайшего валидного сегмента
	useEffect(() => {
		if (!jsonData) return;
		const currentValue = valueRef.current;
		if (!currentValue) return;

		const { keys } = parseValue(currentValue);
		if (keys.length === 0) return;

		let validLength = 0;
		let current = jsonData;
		for (const key of keys) {
			if (current === null || typeof current !== 'object') break;
			if (Array.isArray(current)) {
				const idx = parseInt(key);
				if (isNaN(idx) || idx >= current.length) break;
			} else {
				if (!(key in current)) break;
			}
			current = (current as any)[key];
			validLength++;
		}

		if (validLength === keys.length) return; // путь полностью валиден

		const newValue = keys.slice(0, validLength).join('.');
		setValue(newValue);
		onChange?.(newValue);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [jsonData]);

	const buildFullJsonPath = useCallback(
		async (relativePath: string): Promise<string> => {
			if (!relativePath) return '';
			if (relativePath.startsWith('/') || /^[A-Za-z]:\\/.test(relativePath)) return relativePath;
			if (!projectPath) return relativePath;
			return joinPath(projectPath, relativePath);
		},
		[projectPath],
	);

	useEffect(() => {
		const loadJson = async () => {
			if (!jsonSourcePath) {
				setJsonData(null);
				setJsonLoadError('No JSON file found in node');
				return;
			}
			try {
				const fullPath = await buildFullJsonPath(jsonSourcePath);
				if (!fullPath) {
					setJsonLoadError('Cannot resolve JSON path');
					setJsonData(null);
					return;
				}
				const content = (await window.electronAPI.invoke('readFileSync', fullPath)) as string;
				if (!content) {
					setJsonLoadError('File is empty or not found');
					setJsonData(null);
					return;
				}
				const parsed = JSON.parse(content);
				setJsonData(parsed);
				setJsonLoadError('');
			} catch {
				setJsonData(null);
				setJsonLoadError('Failed to parse JSON');
			}
		};
		loadJson();
	}, [jsonSourcePath, buildFullJsonPath]);

	// Авто-открытие при загрузке JSON если путь не выбран
	useEffect(() => {
		if (!jsonData || value || !containerRef.current) return;
		const keys = getKeysAtPath(jsonData, []);
		if (keys.length === 0) return;
		setDropdownKeys(keys);
		setActiveKeyIndex(0);
		setAnchorEl(containerRef.current);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [jsonData]);

	// Фокус на поиск при открытии дропдауна
	useEffect(() => {
		if (activeKeyIndex !== null && anchorEl) {
			setTimeout(() => searchInputRef.current?.focus(), 50);
		} else {
			setSearchQuery('');
		}
	}, [activeKeyIndex, anchorEl]);

	const saveValue = useCallback(
		(newValue: string) => {
			setValue(newValue);
			onChange?.(newValue);
		},
		[onChange],
	);

	const closeDropdown = useCallback(() => {
		setActiveKeyIndex(null);
		setAnchorEl(null);
		setSearchQuery('');
	}, []);

	const handleKeySegmentClick = useCallback(
		(segIndex: number, e: React.MouseEvent<HTMLElement>) => {
			e.stopPropagation();
			if (!jsonData) return;
			if (activeKeyIndex === segIndex) {
				closeDropdown();
				return;
			}
			const pathToHere = keySegments.slice(0, segIndex);
			const keys = getKeysAtPath(jsonData, pathToHere);
			setDropdownKeys(keys);
			setActiveKeyIndex(segIndex);
			setAnchorEl(e.currentTarget);
			setSearchQuery('');
		},
		[jsonData, activeKeyIndex, keySegments, closeDropdown],
	);

	const handleAppendClick = useCallback(
		(e: React.MouseEvent<HTMLElement>) => {
			e.stopPropagation();
			if (!jsonData) return;
			const nextIndex = keySegments.length;
			if (activeKeyIndex === nextIndex) {
				closeDropdown();
				return;
			}
			const keys = getKeysAtPath(jsonData, keySegments);
			if (keys.length === 0) return;
			setDropdownKeys(keys);
			setActiveKeyIndex(nextIndex);
			setAnchorEl(containerRef.current);
			setSearchQuery('');
		},
		[jsonData, activeKeyIndex, keySegments, closeDropdown],
	);

	const handleSelectKey = useCallback(
		(key: string) => {
			if (activeKeyIndex === null) return;
			const newKeys = [...keySegments.slice(0, activeKeyIndex), key];
			const valueType = getValueType(jsonData, newKeys);
			const isLeaf = valueType !== 'object' && valueType !== 'array' && valueType !== '';

			if (isLeaf) {
				const suffix = inputType ? `:${inputType}` : `:${valueType}`;
				saveValue(newKeys.join('.') + suffix);
				closeDropdown();
			} else {
				saveValue(newKeys.join('.'));
				const nextKeys = getKeysAtPath(jsonData, newKeys);
				setDropdownKeys(nextKeys);
				setActiveKeyIndex(newKeys.length);
				setAnchorEl(containerRef.current);
				setSearchQuery('');
			}
		},
		[activeKeyIndex, keySegments, jsonData, inputType, saveValue, closeDropdown],
	);

	const handleSelectSearchResult = useCallback(
		(result: SearchResult) => {
			if (result.isLeaf) {
				const suffix = inputType ? `:${inputType}` : '';
				saveValue(result.path.join('.') + suffix);
				closeDropdown();
			} else {
				saveValue(result.path.join('.'));
				const nextKeys = getKeysAtPath(jsonData, result.path);
				setDropdownKeys(nextKeys);
				setActiveKeyIndex(result.path.length);
				setAnchorEl(containerRef.current);
				setSearchQuery('');
			}
		},
		[inputType, jsonData, saveValue, closeDropdown],
	);

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			const inContainer = containerRef.current?.contains(e.target as Node);
			const inPopper = popperRef.current?.contains(e.target as Node);
			if (!inContainer && !inPopper) closeDropdown();
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [closeDropdown]);

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
	const typeColor = '#4a9eff';

	const hasNextLevel = jsonData && keySegments.length > 0 && getKeysAtPath(jsonData, keySegments).length > 0;
	const isAtLeaf = jsonData && keySegments.length > 0 && !hasNextLevel;

	const searchResults = useMemo(() => (jsonData && searchQuery.length >= 2 ? searchJson(jsonData, searchQuery) : []), [jsonData, searchQuery]);
	const isSearchActive = searchQuery.length >= 2;

	return (
		<Stack direction='column' px='12px' className='nodrag' gap={0.5}>
			<Stack direction='row' alignItems='center' gap={1}>
				{property.isInput && <InputHandle property={property} />}
				<PropertyLabelEditor label={controlProps?.label ?? ''} editLabel={editLabel} onSave={handleSaveLabel} />
				<TooltipOrDelete isDynamic={isDynamic} tooltip={tooltip} onDelete={handleDelete} />
			</Stack>

			{jsonLoadError && (
				<Typography sx={{ fontSize: '1rem', color: greyColor(45), fontStyle: 'italic', px: '4px' }}>{jsonLoadError}</Typography>
			)}

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
					cursor: jsonData ? 'pointer' : 'default',
					userSelect: 'none',
					opacity: jsonData ? 1 : 0.5,
				}}
			>
				{keySegments.length === 0 && (
					<Typography sx={{ fontSize: '1.1rem', color: greyColor(40), flex: 1, pointerEvents: 'none' }}>
						{jsonData ? 'Click to select key...' : 'Waiting for JSON...'}
					</Typography>
				)}

				{keySegments.map((seg, i) => {
					const isActive = activeKeyIndex === i;
					const parentIsArr = i > 0 && isArrayAtPath(jsonData, keySegments.slice(0, i));
					const displaySeg = parentIsArr ? `[${seg}]` : seg;
					const segIsArr = isArrayAtPath(jsonData, keySegments.slice(0, i + 1));
					return (
						<Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
							{i > 0 && <ChevronRight size={12} color={sepColor} style={{ flexShrink: 0 }} />}
							<Box
								onClick={(e) => handleKeySegmentClick(i, e)}
								sx={{
									px: '4px',
									py: '1px',
									borderRadius: '3px',
									fontSize: '1.1rem',
									color: isActive ? '#fff' : segColor,
									backgroundColor: isActive ? greyColor(35) : 'transparent',
									cursor: jsonData ? 'pointer' : 'default',
									display: 'flex',
									alignItems: 'center',
									gap: '4px',
									'&:hover': jsonData ? { backgroundColor: greyColor(28), color: '#fff' } : {},
									transition: 'background-color 0.15s',
								}}
							>
								{i === 0 &&
									(segIsArr ? (
										<Brackets size={12} color={greyColor(50)} style={{ flexShrink: 0 }} />
									) : (
										<Braces size={12} color={greyColor(50)} style={{ flexShrink: 0 }} />
									))}
								{displaySeg}
							</Box>
						</Box>
					);
				})}

				{/* Следующий уровень: стрелка если есть дети, :type если лист */}
				{hasNextLevel && (
					<Box onClick={(e) => e.stopPropagation()} sx={{ px: '2px', display: 'flex', alignItems: 'center', color: greyColor(35) }}>
						<ChevronRight size={12} />
					</Box>
				)}
				{isAtLeaf && inputType && (
					<Typography sx={{ fontSize: '1rem', color: typeColor, fontStyle: 'italic', ml: '2px', pointerEvents: 'none' }}>
						:{inputType}
					</Typography>
				)}
			</Box>

			{/* Backdrop — блокирует скролл канваса и клики вне дропдауна */}
			{activeKeyIndex !== null && (
				<Box onMouseDown={() => closeDropdown()} onWheel={(e) => e.stopPropagation()} sx={{ position: 'fixed', inset: 0, zIndex: 1299 }} />
			)}

			<Popper
				open={activeKeyIndex !== null && Boolean(anchorEl)}
				anchorEl={containerRef.current}
				placement='bottom-start'
				style={{ zIndex: 1300, width: containerRef.current?.offsetWidth }}
				modifiers={[{ name: 'offset', options: { offset: [0, 4] } }]}
			>
				<Paper
					ref={popperRef}
					className='nowheel'
					sx={{
						width: '100%',
						maxHeight: 320,
						display: 'flex',
						flexDirection: 'column',
						backgroundColor: greyColor(18),
						border: `1px solid ${borderColor}`,
						transform: `scale(${zoom}) !important`,
						transformOrigin: 'top left',
					}}
				>
					{/* Поиск */}
					<Box
						sx={{
							display: 'flex',
							alignItems: 'center',
							gap: 1,
							px: 1.5,
							py: 0.75,
							borderBottom: `1px solid ${borderColor}`,
						}}
					>
						<Search size={13} color={greyColor(50)} style={{ flexShrink: 0 }} />
						<InputBase
							inputRef={searchInputRef}
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder='Search keys & values...'
							onMouseDown={(e) => e.stopPropagation()}
							sx={{ fontSize: '1.05rem', color: segColor, flex: 1, '& input': { padding: 0 } }}
						/>
					</Box>

					<List dense disablePadding sx={{ overflowY: 'auto', flex: 1 }}>
						{isSearchActive ? (
							searchResults.length === 0 ? (
								<ListItem>
									<Typography sx={{ fontSize: '1rem', color: greyColor(45), fontStyle: 'italic', py: 0.5 }}>No results</Typography>
								</ListItem>
							) : (
								searchResults.map((result, idx) => (
									<ListItem key={idx} disablePadding>
										<ListItemButton
											onMouseDown={(e) => {
												e.preventDefault();
												handleSelectSearchResult(result);
											}}
											sx={{
												gap: 1,
												py: '3px',
												color: segColor,
												'&:hover': { backgroundColor: hoverColor, color: '#fff' },
											}}
										>
											{result.isLeaf ? (
												<FileJson size={13} color={greyColor(45)} style={{ flexShrink: 0 }} />
											) : (
												<Braces size={13} color={greyColor(55)} style={{ flexShrink: 0 }} />
											)}
											<Box sx={{ flex: 1, minWidth: 0 }}>
												<Typography sx={{ fontSize: '1.05rem', lineHeight: 1.3 }}>{result.displayPath}</Typography>
												{result.valuePreview && (
													<Typography
														sx={{
															fontSize: '0.9rem',
															color: typeColor,
															lineHeight: 1.2,
															opacity: 0.8,
														}}
														noWrap
													>
														{result.valuePreview}
													</Typography>
												)}
											</Box>
										</ListItemButton>
									</ListItem>
								))
							)
						) : (
							dropdownKeys.map((key) => {
								const parentPath = keySegments.slice(0, activeKeyIndex ?? 0);
								const parentIsArray = isArrayAtPath(jsonData, parentPath);
								const pathToKey = [...parentPath, key];
								const valType = getValueType(jsonData, pathToKey);
								const isObj = valType === 'object';
								const isArr = valType === 'array';
								const displayKey = parentIsArray ? `[${key}]` : key;

								return (
									<ListItem key={key} disablePadding>
										<ListItemButton
											onMouseDown={(e) => {
												e.preventDefault();
												handleSelectKey(key);
											}}
											sx={{
												gap: 1,
												py: '3px',
												color: segColor,
												'&:hover': { backgroundColor: hoverColor, color: '#fff' },
											}}
										>
											{isArr ? (
												<Brackets size={13} color={greyColor(55)} style={{ flexShrink: 0 }} />
											) : isObj ? (
												<Braces size={13} color={greyColor(55)} style={{ flexShrink: 0 }} />
											) : (
												<FileJson size={13} color={greyColor(45)} style={{ flexShrink: 0 }} />
											)}
											<Typography sx={{ fontSize: '1.1rem', lineHeight: 1.4, flex: 1 }}>{displayKey}</Typography>
											{!isObj && (
												<Typography
													sx={{
														fontSize: '0.95rem',
														color: typeColor,
														fontStyle: 'italic',
														flexShrink: 0,
													}}
												>
													{valType}
												</Typography>
											)}
										</ListItemButton>
									</ListItem>
								);
							})
						)}
					</List>
				</Paper>
			</Popper>
		</Stack>
	);
}

export default memo(JsonNavigator);
