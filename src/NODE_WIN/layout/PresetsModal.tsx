import { memo, useState, useEffect, useCallback, useMemo } from 'react';
import {
	Box,
	Button,
	Checkbox,
	Chip,
	CircularProgress,
	IconButton,
	InputAdornment,
	List,
	ListItem,
	Modal,
	Stack,
	TextField,
	Tooltip,
	Typography,
} from '@mui/material';
import { BookmarkPlus, Check, LogIn, LogOut, Save, Search, Trash2, X } from 'lucide-react';
import { useNodes, useReactFlow } from '@xyflow/react';
import { nanoid } from 'nanoid';
import { defGray, greyColor } from '@/Store/Color/grayColor';
import { joinPath } from '@/Utils/joinPath';
import { tauriAPI } from '@/Utils/tauri-api';
import { commands, unwrap } from '@/Utils/specta';
import { basename, dirname } from '@/Utils/path';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PresetItem {
	name: string;
	filePath: string;
	description: string;
	tags: string[];
	valid: boolean;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

const api = tauriAPI;

async function getPressetDir(): Promise<string> {
	const userData = unwrap(await commands.getUserDataPath());
	const dir = joinPath(userData, 'pressets');
	unwrap(await commands.testAndCreateFolder(dir));
	return dir;
}

async function loadAllPresets(): Promise<PresetItem[]> {
	const dir = await getPressetDir();

	let fileNames: string[] = [];
	try {
		const result = unwrap(await commands.getSomeFromFolder(dir, [{ type: 'json', ext: ['json'] }])) as any;
		fileNames = result.json ?? [];
	} catch {
		return [];
	}

	const presets: PresetItem[] = [];
	for (const fileName of fileNames) {
		try {
			const filePath = joinPath(dir, fileName);
			const raw = unwrap(await commands.readFileSync(filePath));
			const flow = JSON.parse(raw);
			const name = fileName.replace(/\.json$/, '');
			const descNode = flow.nodes?.find((n: any) => n.type === 'description');
			const comment: string = descNode?.data?.comment ?? '';
			const excluded = new Set(['main', 'helpers']);
			const tags: string[] = [
				...new Set(
					(flow.nodes as any[])
						?.filter((n: any) => !excluded.has(n.data?.colorType))
						.map((n: any) => n.data?.pluginId)
						.filter(Boolean) ?? [],
				),
			];
			presets.push({ name, filePath, description: comment, tags, valid: isValidPresetFlow(flow) });
		} catch {
			/* skip invalid files */
		}
	}
	return presets;
}

async function getUniqueName(dir: string, baseName: string): Promise<string> {
	const exists = async (name: string) => {
		const p = joinPath(dir, `${name}.json`);
		try {
			return !!unwrap(await commands.checkFilePath(p, null));
		} catch {
			return false;
		}
	};
	if (!(await exists(baseName))) return baseName;
	let i = 1;
	while (await exists(`${baseName}_${i}`)) i++;
	return `${baseName}_${i}`;
}

function isValidPresetFlow(flow: any): boolean {
	if (!flow || !Array.isArray(flow.nodes)) return false;
	return flow.nodes.some((n: any) => n.type === 'mainSearch') && flow.nodes.some((n: any) => n.type === 'description');
}

// ── SaveNameModal ─────────────────────────────────────────────────────────────

interface SaveNameModalProps {
	open: boolean;
	onClose: () => void;
	onConfirm: (name: string) => void;
}

function SaveNameModal({ open, onClose, onConfirm }: SaveNameModalProps) {
	const [value, setValue] = useState('');
	const gray15 = greyColor(15);
	const gray40 = greyColor(40);

	useEffect(() => {
		if (open) setValue('');
	}, [open]);

	const handleConfirm = () => {
		if (value.trim()) onConfirm(value.trim());
	};

	return (
		<Modal open={open} onClose={onClose}>
			<Box
				sx={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: 'translate(-50%, -50%)',
					width: 500,
					bgcolor: gray15,
					border: `1px solid ${gray40}`,
					borderRadius: 2,
					boxShadow: 24,
					p: 3,
				}}
			>
				<Typography variant='subtitle1' mb={2} fontWeight={500}>
					Save current flow as preset
				</Typography>
				<Stack direction='row' spacing={1} alignItems='center'>
					<TextField
						size='small'
						placeholder='Preset name...'
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') handleConfirm();
							if (e.key === 'Escape') onClose();
						}}
						autoFocus
						fullWidth
					/>
					<Tooltip title='Save'>
						<span>
							<IconButton size='small' onClick={handleConfirm} disabled={!value.trim()}>
								<Check size={18} />
							</IconButton>
						</span>
					</Tooltip>
					<Tooltip title='Cancel'>
						<IconButton size='small' onClick={onClose}>
							<X size={18} />
						</IconButton>
					</Tooltip>
				</Stack>
			</Box>
		</Modal>
	);
}

// ── PresetsModal ──────────────────────────────────────────────────────────────

interface PresetsModalProps {
	open: boolean;
	onClose: () => void;
}

function PresetsModal({ open, onClose }: PresetsModalProps) {
	const reactFlow = useReactFlow();
	const [presets, setPresets] = useState<PresetItem[]>([]);
	const [search, setSearch] = useState('');
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(false);
	const [saveModalOpen, setSaveModalOpen] = useState(false);
	const [saveMode, setSaveMode] = useState<'all' | 'selected'>('all');

	const allNodes = useNodes();
	const selectedNodeCount = useMemo(() => allNodes.filter((n) => n.selected).length, [allNodes]);

	const gray15 = greyColor(15);
	const gray40 = greyColor(40);
	const gray30 = greyColor(30);
	const gray60 = greyColor(60);

	const loadPresets = useCallback(async () => {
		setLoading(true);
		try {
			setPresets(await loadAllPresets());
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open) {
			setSearch('');
			setSelected(new Set());
			setActiveTags(new Set());
			setSaveModalOpen(false);
			setSaveMode('all');
			loadPresets();
		}
	}, [open, loadPresets]);

	// Collect all unique tags across all presets
	const allTags = useMemo(() => {
		const tagSet = new Set<string>();
		presets.forEach((p) => p.tags.forEach((t) => tagSet.add(t)));
		return [...tagSet].sort();
	}, [presets]);

	// Filter: name search AND all active tags must be present (AND logic)
	const filtered = presets.filter((p) => {
		const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
		const matchTags = activeTags.size === 0 || [...activeTags].every((t) => p.tags.includes(t));
		return matchSearch && matchTags;
	});

	const toggleTag = (tag: string) =>
		setActiveTags((prev) => {
			const next = new Set(prev);
			next.has(tag) ? next.delete(tag) : next.add(tag);
			return next;
		});

	// ── Save current flow (full or selected only) ─────────────────────────────
	const handleSaveConfirm = useCallback(
		async (name: string) => {
			let flow: { nodes: any[]; edges: any[]; viewport: any };
			if (saveMode === 'selected') {
				const allRfNodes = reactFlow.getNodes();
				const allRfEdges = reactFlow.getEdges();
				const selNodes = allRfNodes.filter((n) => n.selected);
				const selIds = new Set(selNodes.map((n) => n.id));
				const selEdges = allRfEdges.filter((e) => selIds.has(e.source) && selIds.has(e.target));
				flow = {
					nodes: selNodes.map((n) => ({ ...n, selected: false })),
					edges: selEdges.map((e) => ({ ...e, selected: false })),
					viewport: reactFlow.getViewport(),
				};
			} else {
				flow = reactFlow.toObject() as any;
			}
			const dir = await getPressetDir();
			const finalName = await getUniqueName(dir, name);
			const filePath = joinPath(dir, `${finalName}.json`);
			unwrap(await commands.writeFile(filePath, JSON.stringify(flow, null, 2)));
			setSaveModalOpen(false);
			loadPresets();
		},
		[reactFlow, loadPresets, saveMode],
	);

	// ── Apply preset: replace entire flow ─────────────────────────────────────
	const handleApplyPreset = useCallback(
		async (preset: PresetItem) => {
			try {
				const raw = unwrap(await commands.readFileSync(preset.filePath));
				const flow = JSON.parse(raw);
				if (flow.nodes) reactFlow.setNodes(flow.nodes);
				if (flow.edges) reactFlow.setEdges(flow.edges ?? []);
				if (flow.viewport) reactFlow.setViewport(flow.viewport);
				onClose();
			} catch {
				/* skip on read error */
			}
		},
		[reactFlow, onClose],
	);

	// ── Add preset: append all nodes/edges except mainSearch & description ────
	const handleAddPreset = useCallback(
		async (preset: PresetItem) => {
			try {
				const raw = unwrap(await commands.readFileSync(preset.filePath));
				const flow = JSON.parse(raw);
				if (!Array.isArray(flow.nodes)) {
					onClose();
					return;
				}

				const excludedTypes = new Set(['mainSearch', 'description']);
				const candidateNodes = flow.nodes.filter((n: any) => !excludedTypes.has(n.type));
				if (!candidateNodes.length) {
					onClose();
					return;
				}

				const idMap = new Map<string, string>();
				candidateNodes.forEach((n: any) => idMap.set(n.id, `n_${nanoid(6)}`));

				const newNodes = candidateNodes.map((n: any) => ({
					...n,
					id: idMap.get(n.id)!,
					selected: true,
				}));

				const newEdges = (Array.isArray(flow.edges) ? flow.edges : [])
					.filter((e: any) => idMap.has(e.source) && idMap.has(e.target))
					.map((e: any) => ({
						...e,
						id: `e_${nanoid(6)}`,
						source: idMap.get(e.source)!,
						target: idMap.get(e.target)!,
						selected: true,
					}));

				reactFlow.setNodes((curr) => [...curr.map((n) => ({ ...n, selected: false })), ...newNodes]);
				reactFlow.setEdges((curr) => [...curr.map((e) => ({ ...e, selected: false })), ...newEdges]);
				onClose();
			} catch {
				/* skip on read error */
			}
		},
		[reactFlow, onClose],
	);

	// ── Update preset: overwrite preset file with current flow ────────────────
	const handleUpdatePreset = useCallback(
		async (preset: PresetItem) => {
			try {
				const flow = reactFlow.toObject();
				unwrap(await commands.writeFile(preset.filePath, JSON.stringify(flow, null, 2)));
				onClose();
			} catch {
				/* skip on write error */
			}
		},
		[reactFlow, onClose],
	);

	// ── Import from files ─────────────────────────────────────────────────────
	const handleImport = useCallback(async () => {
		const files = unwrap(await commands.selectFiles({
			multiSelect: true,
			filters: [{ name: 'JSON Flow Files', extensions: ['json'] }],
		}));
		if (!files?.length) return;
		const dir = await getPressetDir();
		let imported = 0;
		for (const filePath of files) {
			try {
				const raw = unwrap(await commands.readFileSync(filePath));
				const flow = JSON.parse(raw);
				if (!isValidPresetFlow(flow)) continue;
				const baseName = basename(filePath, '.json');
				const finalName = await getUniqueName(dir, baseName);
				const destPath = joinPath(dir, `${finalName}.json`);
				unwrap(await commands.writeFile(destPath, JSON.stringify(flow, null, 2)));
				imported++;
			} catch {
				/* skip invalid */
			}
		}
		if (imported > 0) loadPresets();
	}, [loadPresets]);

	// ── Export selected to folder ─────────────────────────────────────────────
	const handleExport = useCallback(async () => {
		if (!selected.size) return;
		const folders = unwrap(await commands.selectFolders({ multiSelect: false }));
		if (!folders?.length) return;
		const destDir = folders[0];
		for (const preset of presets) {
			if (!selected.has(preset.name)) continue;
			const destPath = joinPath(destDir, `${preset.name}.json`);
			unwrap(await commands.copyItem(preset.filePath, destPath, { overwrite: true }));
		}
	}, [selected, presets]);

	// ── Delete ────────────────────────────────────────────────────────────────
	const handleDelete = useCallback(async (preset: PresetItem) => {
		unwrap(await commands.deleteItem(preset.filePath));
		setPresets((prev) => prev.filter((p) => p.filePath !== preset.filePath));
		setSelected((prev) => {
			const next = new Set(prev);
			next.delete(preset.name);
			return next;
		});
	}, []);

	// ── Rename ────────────────────────────────────────────────────────────────
	const handleRename = useCallback(
		async (preset: PresetItem, newName: string) => {
			const trimmed = newName.trim();
			if (!trimmed || trimmed === preset.name) return;
			const dir = dirname(preset.filePath);
			const newPath = joinPath(dir, `${trimmed}.json`);
			unwrap(await commands.renameFile(preset.filePath, newPath));
			loadPresets();
		},
		[loadPresets],
	);

	const toggleSelect = (name: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			next.has(name) ? next.delete(name) : next.add(name);
			return next;
		});

	return (
		<>
			<Modal open={open} onClose={onClose}>
				<Box
					sx={{
						position: 'absolute',
						top: '50%',
						left: '50%',
						transform: 'translate(-50%, -50%)',
						width: '80vw',
						maxWidth: 800,
						maxHeight: '85vh',
						display: 'flex',
						flexDirection: 'column',
						bgcolor: gray15,
						border: `1px solid ${gray40}`,
						borderRadius: 2,
						boxShadow: 24,
						overflow: 'hidden',
					}}
				>
					{/* Header */}
					<Box sx={{ p: 2, pb: 1.5, flexShrink: 0 }}>
						<Typography variant='h6' mb={1.5}>
							Pressets
						</Typography>

						{/* Search + action buttons */}
						<Stack direction='row' spacing={1} alignItems='center'>
							<TextField
								size='small'
								placeholder='Search...'
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								fullWidth
								variant='standard'
								InputProps={{
									startAdornment: (
										<InputAdornment position='start'>
											<Search size={16} />
										</InputAdornment>
									),
									disableUnderline: false,
								}}
								sx={{
									'& .MuiInput-underline:before': { borderBottomColor: gray30 },
									'& .MuiInput-underline:hover:not(.Mui-disabled):before': { borderBottomColor: gray40 },
								}}
							/>
							<Tooltip title='Save current flow'>
								<IconButton
									size='small'
									onClick={() => {
										setSaveMode('all');
										setSaveModalOpen(true);
									}}
								>
									<Save size={18} />
								</IconButton>
							</Tooltip>
							<Tooltip title='Сохраняем только выделенные ноды'>
								<span>
									<IconButton
										size='small'
										disabled={selectedNodeCount < 2}
										onClick={() => {
											setSaveMode('selected');
											setSaveModalOpen(true);
										}}
									>
										<BookmarkPlus size={18} />
									</IconButton>
								</span>
							</Tooltip>
							<Tooltip title='Import presets'>
								<IconButton size='small' onClick={handleImport}>
									<LogIn size={18} style={{ transform: 'rotate(90deg)' }} />
								</IconButton>
							</Tooltip>
							<Tooltip title={selected.size ? `Export ${selected.size} preset(s)` : 'Select presets to export'}>
								<span>
									<IconButton size='small' onClick={handleExport} disabled={!selected.size}>
										<LogOut size={18} style={{ transform: 'rotate(-90deg)' }} />
									</IconButton>
								</span>
							</Tooltip>
						</Stack>

						{/* Tag filter row */}
						{allTags.length > 0 && (
							<Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', pt: 1.5 }}>
								{allTags.map((tag) => (
									<Chip
										key={tag}
										label={`#${tag}`}
										size='small'
										variant={activeTags.has(tag) ? 'filled' : 'outlined'}
										onClick={() => toggleTag(tag)}
										sx={{
											height: 20,
											cursor: 'pointer',
											color: activeTags.has(tag) ? undefined : gray60,
											borderColor: activeTags.has(tag) ? undefined : gray30,
											'& .MuiChip-label': { px: 0.8, fontSize: '0.65rem' },
										}}
									/>
								))}
							</Box>
						)}
					</Box>

					{/* List */}
					<Box sx={{ flex: 1, overflow: 'auto', px: 2, pb: 2 }}>
						{loading ? (
							<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
								<CircularProgress size={24} />
							</Box>
						) : filtered.length === 0 ? (
							<Typography variant='body2' sx={{ opacity: 0.5, py: 3, textAlign: 'center' }}>
								{search || activeTags.size ? 'No matching presets' : 'No presets yet'}
							</Typography>
						) : (
							<List dense disablePadding>
								{filtered.map((preset) => (
									<PresetListItem
										key={preset.filePath}
										preset={preset}
										isSelected={selected.has(preset.name)}
										onToggleSelect={() => toggleSelect(preset.name)}
										onDelete={() => handleDelete(preset)}
										onRename={(name) => handleRename(preset, name)}
										onApply={() => handleApplyPreset(preset)}
										onAdd={() => handleAddPreset(preset)}
										onUpdate={() => handleUpdatePreset(preset)}
									/>
								))}
							</List>
						)}
					</Box>
				</Box>
			</Modal>

			{/* Save name modal — separate, small, on top */}
			<SaveNameModal open={saveModalOpen} onClose={() => setSaveModalOpen(false)} onConfirm={handleSaveConfirm} />
		</>
	);
}

// ── PresetListItem ────────────────────────────────────────────────────────────

interface PresetListItemProps {
	preset: PresetItem;
	isSelected: boolean;
	onToggleSelect: () => void;
	onDelete: () => void;
	onRename: (newName: string) => void;
	onApply: () => void;
	onAdd: () => void;
	onUpdate: () => void;
}

function PresetListItem({ preset, isSelected, onToggleSelect, onDelete, onRename, onApply, onAdd, onUpdate }: PresetListItemProps) {
	const [editing, setEditing] = useState(false);
	const [editValue, setEditValue] = useState(preset.name);

	const gray30 = greyColor(30);
	const gray80 = greyColor(80);
	const gray50 = greyColor(50);

	const commitRename = () => {
		setEditing(false);
		onRename(editValue);
	};

	return (
		<ListItem
			sx={{
				mb: 0.5,
				p: 0.5,
				pl: 0.5,
				pr: 0.5,
				minHeight: 48,
				cursor: 'default',
				bgcolor: isSelected ? 'action.selected' : 'transparent',
				borderRadius: 1,
				border: '1px solid',
				borderColor: isSelected ? gray50 : gray30,
				'&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
				transition: 'background-color 0.2s, border-color 0.2s',
				display: 'flex',
				alignItems: 'flex-start',
				gap: 0.5,
			}}
		>
			{/* Checkbox for export selection */}
			<Checkbox
				edge='start'
				checked={isSelected}
				onChange={onToggleSelect}
				onClick={(e) => e.stopPropagation()}
				size='small'
				disableRipple
				tabIndex={-1}
				sx={{ p: 0.5, ml: 0.5, mt: 0.25, flexShrink: 0, color: gray50 }}
			/>

			{/* Name / Description / Tags */}
			<Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25, py: 0.5 }}>
				{editing ? (
					<TextField
						size='small'
						value={editValue}
						onChange={(e) => setEditValue(e.target.value)}
						onBlur={commitRename}
						onKeyDown={(e) => {
							if (e.key === 'Enter') commitRename();
							if (e.key === 'Escape') {
								setEditing(false);
								setEditValue(preset.name);
							}
						}}
						onClick={(e) => e.stopPropagation()}
						autoFocus
						variant='standard'
						sx={{ mb: 0.25 }}
					/>
				) : (
					<Typography
						variant='body1'
						sx={{
							fontWeight: 500,
							color: gray80,
							cursor: 'text',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
							userSelect: 'none',
							'&:hover': { textDecoration: 'underline' },
						}}
						onDoubleClick={(e) => {
							e.stopPropagation();
							setEditing(true);
							setEditValue(preset.name);
						}}
					>
						{preset.name}
					</Typography>
				)}

				{/* Double-click on description → apply preset */}
				{preset.description && (
					<Typography
						variant='caption'
						color='text.secondary'
						onDoubleClick={(e) => {
							e.stopPropagation();
							onApply();
						}}
						sx={{
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							userSelect: 'none',
							cursor: 'pointer',
							'&:hover': { opacity: 0.8 },
						}}
					>
						{preset.description}
					</Typography>
				)}

				{preset.tags.length > 0 && (
					<Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}>
						{preset.tags.map((tag) => (
							<Chip
								key={tag}
								label={`#${tag}`}
								size='small'
								variant='outlined'
								sx={{ height: 18, '& .MuiChip-label': { px: 0.8, fontSize: '0.65rem' } }}
							/>
						))}
					</Box>
				)}
			</Box>

			{/* Right side: Apply / Add / Update + Delete */}
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, flexShrink: 0 }}>
				<Tooltip title={preset.valid ? 'Replace flow with this preset' : 'Preset has no mainSearch/description'}>
					<span>
						<Button
							size='small'
							variant='text'
							disabled={!preset.valid}
							onClick={(e) => {
								e.stopPropagation();
								onApply();
							}}
							sx={{
								minWidth: 0,
								px: 1,
								py: 0.25,
								fontSize: '0.7rem',
								height: 22,
								color: gray50,
								'&:hover': { color: gray80 },
							}}
						>
							Apply
						</Button>
					</span>
				</Tooltip>
				<Tooltip title='Append preset nodes to current flow (excluding mainSearch & description)'>
					<Button
						size='small'
						variant='text'
						onClick={(e) => {
							e.stopPropagation();
							onAdd();
						}}
						sx={{
							minWidth: 0,
							px: 1,
							py: 0.25,
							fontSize: '0.7rem',
							height: 22,
							color: gray50,
							'&:hover': { color: gray80 },
						}}
					>
						Add
					</Button>
				</Tooltip>
				<Tooltip title='Overwrite this preset with current flow'>
					<Button
						size='small'
						variant='text'
						onClick={(e) => {
							e.stopPropagation();
							onUpdate();
						}}
						sx={{
							minWidth: 0,
							px: 1,
							py: 0.25,
							fontSize: '0.7rem',
							height: 22,
							color: gray50,
							'&:hover': { color: gray80 },
						}}
					>
						Update
					</Button>
				</Tooltip>
				<IconButton
					size='small'
					onClick={(e) => {
						e.stopPropagation();
						onDelete();
					}}
					sx={{
						p: 0.5,
						flexShrink: 0,
						color: defGray,
						'&:hover': { color: 'error.main', backgroundColor: 'transparent' },
					}}
				>
					<Trash2 strokeWidth={1.2} size={18} />
				</IconButton>
			</Box>
		</ListItem>
	);
}

export default memo(PresetsModal);
