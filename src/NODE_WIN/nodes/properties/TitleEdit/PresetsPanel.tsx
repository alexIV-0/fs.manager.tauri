// src/NODE_WIN/nodes/properties/TitleEdit/PresetsPanel.tsx

import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography, IconButton, TextField, InputAdornment, Divider, Tooltip } from '@mui/material';
import { Search, Plus, Trash2, Check, X } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { TitlePresetItem, TitleSettings } from './types';
import { loadPresetIndex, loadPresetData, saveNewPreset, deletePreset, savePresetIndex } from './presetUtils';
import { DEFAULT_PRESETS_WIDTH, MIN_PRESETS_WIDTH, MAX_PRESETS_WIDTH } from './constants';

interface PresetsPanelProps {
	isOpen: boolean;
	currentSettings: TitleSettings;
	onLoad: (settings: TitleSettings) => void;
	onClose: () => void;
	canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export default function PresetsPanel({ isOpen, currentSettings, onLoad, onClose, canvasRef }: PresetsPanelProps) {
	const [presets, setPresets] = useState<TitlePresetItem[]>([]);
	const [search, setSearch] = useState('');
	const [width, setWidth] = useState(DEFAULT_PRESETS_WIDTH);
	const [isSaving, setIsSaving] = useState(false);
	const [newPresetName, setNewPresetName] = useState('');
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	const panelRef = useRef<HTMLDivElement>(null);
	const isResizing = useRef(false);
	const startX = useRef(0);
	const startWidth = useRef(0);

	const border = greyColor(25);
	const bg = greyColor(12);
	const bgHover = greyColor(18);
	const bgActive = greyColor(22);
	const defColor = greyColor(80);
	const labelColor = greyColor(55);

	// ── Загрузка пресетов ─────────────────────────────────────────────────────

	const loadPresets = useCallback(async () => {
		const index = await loadPresetIndex();
		setPresets(index);
	}, []);

	useEffect(() => {
		if (isOpen) loadPresets();
	}, [isOpen, loadPresets]);

	// ── Закрытие по клику вне панели ──────────────────────────────────────────

	useEffect(() => {
		if (!isOpen) return;

		const handleClickOutside = (e: MouseEvent) => {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
				onClose();
			}
		};

		// Небольшая задержка чтобы не закрылось сразу при открытии
		const timer = setTimeout(() => {
			document.addEventListener('mousedown', handleClickOutside);
		}, 100);

		return () => {
			clearTimeout(timer);
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen, onClose]);

	// ── Resize панели ─────────────────────────────────────────────────────────

	const handleResizeMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			isResizing.current = true;
			startX.current = e.clientX;
			startWidth.current = width;
		},
		[width],
	);

	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (!isResizing.current) return;
			const delta = e.clientX - startX.current;
			const newWidth = Math.min(MAX_PRESETS_WIDTH, Math.max(MIN_PRESETS_WIDTH, startWidth.current + delta));
			setWidth(newWidth);
		};

		const handleMouseUp = () => {
			isResizing.current = false;
		};

		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
		return () => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	}, []);

	// ── Сохранение нового пресета ─────────────────────────────────────────────

	const handleSavePreset = useCallback(async () => {
		if (!newPresetName.trim()) return;

		// Генерируем превью из canvas
		let previewBase64 = '';
		if (canvasRef.current) {
			const previewCanvas = document.createElement('canvas');
			previewCanvas.width = 200;
			previewCanvas.height = 112;
			const ctx = previewCanvas.getContext('2d');
			if (ctx) {
				ctx.drawImage(canvasRef.current, 0, 0, 200, 112);
				previewBase64 = previewCanvas.toDataURL('image/png');
			}
		}

		await saveNewPreset(newPresetName.trim(), '', currentSettings, previewBase64);

		setNewPresetName('');
		setIsSaving(false);
		await loadPresets();
	}, [newPresetName, currentSettings, canvasRef, loadPresets]);

	// ── Загрузка пресета ──────────────────────────────────────────────────────

	const handleLoadPreset = useCallback(
		async (item: TitlePresetItem) => {
			const data = await loadPresetData(item.id);
			if (data) onLoad(data);
		},
		[onLoad],
	);

	// ── Удаление пресета ──────────────────────────────────────────────────────

	const handleDeletePreset = useCallback(
		async (e: React.MouseEvent, item: TitlePresetItem) => {
			e.stopPropagation();
			await deletePreset(item.id);
			const index = await loadPresetIndex();
			await savePresetIndex(index.filter((p) => p.id !== item.id));
			await loadPresets();
		},
		[loadPresets],
	);

	// ── Фильтрация ────────────────────────────────────────────────────────────

	const filtered = presets.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

	// ── Рендер ───────────────────────────────────────────────────────────────

	if (!isOpen) return null;

	return (
		<Box
			ref={panelRef}
			sx={{
				position: 'absolute',
				top: 0,
				left: 0,
				bottom: 0,
				width,
				zIndex: 10,
				backgroundColor: bg,
				borderRight: `1px solid ${border}`,
				display: 'flex',
				flexDirection: 'column',
				boxShadow: '4px 0 20px rgba(0,0,0,0.4)',
				animation: 'slideInLeft 0.2s ease',
				'@keyframes slideInLeft': {
					from: { transform: 'translateX(-100%)' },
					to: { transform: 'translateX(0)' },
				},
			}}
		>
			{/* ── Поиск + кнопка добавления ─────────────────────────────────── */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: 0.5,
					p: 1,
					borderBottom: `1px solid ${border}`,
					flexShrink: 0,
				}}
			>
				<TextField
					size='small'
					placeholder='Search...'
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					sx={{
						flex: 1,
						'& .MuiInputBase-input': {
							fontSize: 12,
							py: '4px',
							color: defColor,
						},
						'& .MuiOutlinedInput-notchedOutline': {
							borderColor: border,
						},
					}}
					slotProps={{
						input: {
							startAdornment: (
								<InputAdornment position='start'>
									<Search size={14} color={labelColor} />
								</InputAdornment>
							),
						},
					}}
				/>

				<Divider orientation='vertical' flexItem sx={{ borderColor: border }} />

				<Tooltip title='Save current settings as preset'>
					<IconButton
						size='small'
						onClick={() => setIsSaving(true)}
						sx={{
							color: labelColor,
							'&:hover': { color: defColor },
						}}
					>
						<Plus size={18} />
					</IconButton>
				</Tooltip>
			</Box>

			{/* ── Форма сохранения нового пресета ──────────────────────────── */}
			{isSaving && (
				<Box
					sx={{
						p: 1,
						borderBottom: `1px solid ${border}`,
						backgroundColor: bgActive,
						flexShrink: 0,
					}}
				>
					<Typography fontSize={11} color={labelColor} mb={0.5}>
						Preset name:
					</Typography>
					<Box sx={{ display: 'flex', gap: 0.5 }}>
						<TextField
							size='small'
							autoFocus
							placeholder='My preset...'
							value={newPresetName}
							onChange={(e) => setNewPresetName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') handleSavePreset();
								if (e.key === 'Escape') {
									setIsSaving(false);
									setNewPresetName('');
								}
							}}
							sx={{
								flex: 1,
								'& .MuiInputBase-input': {
									fontSize: 12,
									py: '4px',
									color: defColor,
								},
								'& .MuiOutlinedInput-notchedOutline': {
									borderColor: border,
								},
							}}
						/>
						<IconButton size='small' onClick={handleSavePreset} disabled={!newPresetName.trim()} sx={{ color: '#4caf50' }}>
							<Check size={16} />
						</IconButton>
						<IconButton
							size='small'
							onClick={() => {
								setIsSaving(false);
								setNewPresetName('');
							}}
							sx={{ color: labelColor }}
						>
							<X size={16} />
						</IconButton>
					</Box>
				</Box>
			)}

			{/* ── Список пресетов ───────────────────────────────────────────── */}
			<Box
				sx={{
					flex: 1,
					overflowY: 'auto',
					p: 1,
					'&::-webkit-scrollbar': { width: 4 },
					'&::-webkit-scrollbar-thumb': {
						backgroundColor: greyColor(30),
						borderRadius: 2,
					},
				}}
			>
				{filtered.length === 0 && (
					<Typography fontSize={11} color={labelColor} textAlign='center' mt={3}>
						{search ? 'Nothing found' : 'No presets yet'}
					</Typography>
				)}

				{filtered.map((item) => (
					<Box
						key={item.id}
						onClick={() => handleLoadPreset(item)}
						onMouseEnter={() => setHoveredId(item.id)}
						onMouseLeave={() => setHoveredId(null)}
						sx={{
							mb: 1,
							borderRadius: 1,
							border: `1px solid ${border}`,
							overflow: 'hidden',
							cursor: 'pointer',
							backgroundColor: hoveredId === item.id ? bgHover : bg,
							transition: 'background-color 0.15s',
							position: 'relative',
							'&:hover': { borderColor: greyColor(40) },
						}}
					>
						{/* Превью */}
						{item.preview ? (
							<img
								src={item.preview}
								alt={item.name}
								style={{
									width: '100%',
									aspectRatio: '16/9',
									objectFit: 'cover',
									display: 'block',
								}}
							/>
						) : (
							<Box
								sx={{
									width: '100%',
									aspectRatio: '16/9',
									backgroundColor: '#000',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
								}}
							>
								<Typography fontSize={10} color={labelColor}>
									No preview
								</Typography>
							</Box>
						)}

						{/* Название */}
						<Box sx={{ px: 1, py: 0.5 }}>
							<Typography fontSize={11} color={defColor} noWrap>
								{item.name}
							</Typography>
						</Box>

						{/* Кнопка удаления — при наведении */}
						{hoveredId === item.id && (
							<IconButton
								size='small'
								onClick={(e) => handleDeletePreset(e, item)}
								sx={{
									position: 'absolute',
									top: 4,
									right: 4,
									backgroundColor: 'rgba(0,0,0,0.6)',
									color: '#f44336',
									width: 22,
									height: 22,
									'&:hover': {
										backgroundColor: 'rgba(0,0,0,0.8)',
									},
								}}
							>
								<Trash2 size={12} />
							</IconButton>
						)}
					</Box>
				))}
			</Box>

			{/* ── Resize handle (правый край) ───────────────────────────────── */}
			<Box
				onMouseDown={handleResizeMouseDown}
				sx={{
					position: 'absolute',
					top: 0,
					right: -3,
					bottom: 0,
					width: 6,
					cursor: 'ew-resize',
					zIndex: 11,
					'&:hover': {
						backgroundColor: 'rgba(255,255,255,0.1)',
					},
				}}
			/>
		</Box>
	);
}
