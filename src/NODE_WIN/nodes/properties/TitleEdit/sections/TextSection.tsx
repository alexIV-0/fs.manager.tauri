// src/NODE_WIN/nodes/properties/TitleEdit/sections/TextSection.tsx

import { memo, useCallback, useState, useEffect, useRef } from 'react';
import { Select, MenuItem, Stack, FormControlLabel, Switch, Typography, InputAdornment, OutlinedInput } from '@mui/material';
import { Search } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { SectionAccordion, Row, ColorRow, SliderRow } from './SectionUI';
import { SectionProps } from './sectionTypes';

interface FontListItem {
	name: string;
	path: string;
	loadable: boolean; // false для .ttc
}

const loadedFontNames = new Set<string>();

async function loadFont(font: FontListItem): Promise<boolean> {
	if (!font.loadable) return false;
	if (loadedFontNames.has(font.name)) return true;
	try {
		const dataUrl = await window.tauriAPI.invoke<string>('fonts:load-one', font.path);
		if (!dataUrl) return false;
		const face = new FontFace(font.name, `url("${dataUrl}")`);
		await face.load();
		document.fonts.add(face);
		loadedFontNames.add(font.name);
		return true;
	} catch {
		return false;
	}
}

// ── Поиск — стабильный компонент, не перемонтируется при фильтрации ──────────

interface FontSearchProps {
	value: string;
	onChange: (v: string) => void;
	defColor: string;
	grey50: string;
	searchBg: string;
}

const FontSearch = memo(function FontSearch({ value, onChange, defColor, grey50, searchBg }: FontSearchProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const t = setTimeout(() => inputRef.current?.focus(), 80);
		return () => clearTimeout(t);
	}, []);

	return (
		<OutlinedInput
			inputRef={inputRef}
			fullWidth
			size='small'
			placeholder='Search fonts...'
			value={value}
			onChange={(e) => onChange(e.target.value)}
			onKeyDown={(e) => {
				e.stopPropagation();
				if (e.key === 'Escape') onChange('');
			}}
			startAdornment={
				<InputAdornment position='start'>
					<Search size={12} color={grey50} />
				</InputAdornment>
			}
			sx={{
				fontSize: 12,
				color: defColor,
				backgroundColor: searchBg,
				'& .MuiOutlinedInput-notchedOutline': { border: 'none' },
			}}
		/>
	);
});

// ── Основной компонент ────────────────────────────────────────────────────────

export const TextSection = memo(function TextSection({ settings, expanded, onToggle, onChange }: SectionProps) {
	const [fonts, setFonts] = useState<FontListItem[]>([]);
	const [search, setSearch] = useState('');
	const [menuOpen, setMenuOpen] = useState(false);
	const [menuWidth, setMenuWidth] = useState<number | undefined>(undefined);
	const selectRef = useRef<HTMLDivElement>(null);
	const [, setTick] = useState(0);
	const bump = useCallback(() => setTick((t) => t + 1), []);

	const border = greyColor(25);
	const bg = greyColor(15);
	const defColor = greyColor(80);
	const labelColor = greyColor(55);
	const searchBg = greyColor(20);
	const grey50 = greyColor(50);

	// ── Загрузка списка ───────────────────────────────────────────────────────

	useEffect(() => {
		window.tauriAPI
			.invoke<FontListItem[]>('fonts:get-list')
			.then(async (list) => {
				setFonts(list);
				const current = list.find((f) => f.name === settings.text.font);
				if (current) {
					await loadFont(current);
					bump();
				}
			})
			.catch(() => setFonts([]));
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Фиксируем ширину при первом открытии ─────────────────────────────────

	const handleOpen = useCallback(() => {
		if (menuWidth === undefined && selectRef.current) {
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.font = '14px sans-serif';
				const maxW = fonts.reduce((m, f) => Math.max(m, ctx.measureText(f.name).width), 0);
				const selectW = selectRef.current.offsetWidth;
				setMenuWidth(Math.min(420, Math.max(selectW, Math.ceil(maxW) + 64)));
			}
		}
		setMenuOpen(true);
	}, [fonts, menuWidth]);

	const handleClose = useCallback(() => {
		setSearch('');
		setMenuOpen(false);
	}, []);

	// ── Фильтрация ────────────────────────────────────────────────────────────

	// Пока список не загружен — текущий шрифт как заглушка чтобы не было MUI warning
	const fontsReady = fonts.length > 0;
	const filteredFonts = !fontsReady
		? [{ name: settings.text.font, path: '', loadable: false }]
		: search.trim()
			? fonts.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
			: fonts;

	// ── Настройки ────────────────────────────────────────────────────────────

	const update = useCallback(
		(key: string, value: any) => {
			onChange({ ...settings, text: { ...settings.text, [key]: value } });
		},
		[settings, onChange],
	);

	const handleFontChange = useCallback(
		async (fontName: string) => {
			update('font', fontName);
			const font = fonts.find((f) => f.name === fontName);
			if (font) {
				await loadFont(font);
				bump();
			}
		},
		[fonts, update, bump],
	);

	const handleHover = useCallback(
		async (font: FontListItem) => {
			if (!font.loadable || loadedFontNames.has(font.name)) return;
			await loadFont(font);
			bump();
		},
		[bump],
	);

	const selectSx = {
		fontSize: 12,
		color: defColor,
		'& .MuiOutlinedInput-notchedOutline': { borderColor: border },
		'&:hover .MuiOutlinedInput-notchedOutline': { borderColor: grey50 },
		'& .MuiSelect-select': { py: '4px', px: '8px' },
	};

	return (
		<SectionAccordion title='Text' expanded={expanded} onToggle={onToggle}>
			<Row label='Font'>
				<Select
					ref={selectRef}
					fullWidth
					size='small'
					open={menuOpen}
					onOpen={handleOpen}
					onClose={handleClose}
					value={settings.text.font}
					onChange={(e) => handleFontChange(e.target.value)}
					sx={selectSx}
					MenuProps={{
						disablePortal: false,
						style: { zIndex: 10001 },
						PaperProps: {
							style: { maxHeight: 320, backgroundColor: bg, width: menuWidth, minWidth: menuWidth },
						},
					}}
					renderValue={(selected) => <span style={{ fontFamily: loadedFontNames.has(selected) ? selected : 'inherit' }}>{selected}</span>}
				>
					{/* Поиск sticky — отдельный memo, не теряет фокус при фильтрации */}
					<MenuItem
						disableRipple
						onClickCapture={(e) => e.stopPropagation()}
						sx={{
							p: '4px 8px',
							position: 'sticky',
							top: 0,
							zIndex: 2,
							backgroundColor: `${bg} !important`,
							'&:hover': { backgroundColor: `${bg} !important` },
							cursor: 'default',
						}}
					>
						<FontSearch value={search} onChange={setSearch} defColor={defColor} grey50={grey50} searchBg={searchBg} />
					</MenuItem>

					{filteredFonts.length === 0 ? (
						<MenuItem disabled sx={{ fontSize: 12, color: grey50, fontStyle: 'italic' }}>
							No fonts found
						</MenuItem>
					) : (
						filteredFonts.map((f) => (
							<MenuItem
								key={f.path}
								value={f.name}
								onMouseEnter={() => handleHover(f)}
								sx={{
									fontSize: 14,
									// Для .ttc — не показываем в своём шрифте (не загружается)
									fontFamily: f.loadable && loadedFontNames.has(f.name) ? f.name : 'inherit',
									color: f.loadable ? defColor : grey50,
								}}
							>
								{f.name}
								{!f.loadable && <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.4 }}>.ttc</span>}
							</MenuItem>
						))
					)}
				</Select>
			</Row>

			<SliderRow label='Size px' value={settings.text.size} min={10} max={200} onChange={(v) => update('size', v)} />
			<ColorRow label='Color' value={settings.text.color} onChange={(v) => update('color', v)} />

			<Stack direction='row' gap={1} mb={1}>
				<FormControlLabel
					control={<Switch size='small' checked={settings.text.bold} onChange={(e) => update('bold', e.target.checked)} />}
					label={
						<Typography fontSize={11} color={labelColor}>
							Bold
						</Typography>
					}
				/>
				<FormControlLabel
					control={<Switch size='small' checked={settings.text.italic} onChange={(e) => update('italic', e.target.checked)} />}
					label={
						<Typography fontSize={11} color={labelColor}>
							Italic
						</Typography>
					}
				/>
			</Stack>

			<SliderRow label='Wrap Width %' value={settings.text.wrapWidth} min={20} max={100} onChange={(v) => update('wrapWidth', v)} />
			<SliderRow label='Max Lines' value={settings.text.maxLines} min={1} max={10} onChange={(v) => update('maxLines', v)} />
			<SliderRow
				label='Line Spacing px'
				value={settings.text.lineSpacing ?? 0}
				min={-20}
				max={100}
				onChange={(v) => update('lineSpacing', v)}
			/>
		</SectionAccordion>
	);
});
