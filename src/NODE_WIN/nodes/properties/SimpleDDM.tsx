import { DDMProperty } from '@/NODE_WIN/definitions/types';
import { useResolveOptions } from '@/NODE_WIN/hooks/useResolveOptions';
import { defGray, greyColor } from '@/Store/Color/grayColor';
import { Box, Divider, InputBase, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useStore } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import InputHandle from '../components/InputHandle';
import MyToolTip from './CustomTooltip';

// Опция считается разделителем если начинается с одного или нескольких тире
const isDivider = (opt: string): boolean => /^-+/.test(opt.trim());
// Текст после тире (пустая строка → просто линия)
const getDividerText = (opt: string): string =>
	opt
		.trim()
		.replace(/^-+\s*/, '')
		.trim();

interface SimpleDDMProps {
	property: DDMProperty;
	onChange: (value: string) => void;
}

function SimpleDDM({ property, onChange }: SimpleDDMProps) {
	const { controlProps } = property;
	// useViewport() ре-рендерит на каждый pan-tick. Подписываемся только на zoom.
	const zoom = useStore((s) => s.transform[2]);
	const { resolveOptions } = useResolveOptions();

	const defColor = defGray;
	const borderColor = greyColor(30);
	const searchBg = greyColor(18);

	// Нормализуем value — может прийти массив
	const normalizeValue = (v: string | string[]): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

	const [selectValue, setSelectValue] = useState<string>(normalizeValue(controlProps.value));
	const [resolvedOptions, setResolvedOptions] = useState<string[]>(() => {
		const currentValue = normalizeValue(controlProps.value);
		return currentValue ? [currentValue] : [];
	});
	const [searchQuery, setSearchQuery] = useState('');
	const [open, setOpen] = useState(false);

	const searchRef = useRef<HTMLInputElement>(null);

	// Синхронизация value снаружи
	useEffect(() => {
		setSelectValue(normalizeValue(controlProps.value));
	}, [controlProps.value]);

	// Резолвим опции при монтировании и при изменении списка
	useEffect(() => {
		const currentValue = normalizeValue(controlProps.value);
		resolveOptions(controlProps.options ?? []).then((resolved) => {
			if (currentValue && !resolved.includes(currentValue)) {
				setResolvedOptions([currentValue, ...resolved]);
			} else {
				setResolvedOptions(resolved);
			}
		});
	}, [controlProps.options, controlProps.value, resolveOptions]);

	// Фильтрация по поисковому запросу — разделители не фильтруются
	const filteredOptions = resolvedOptions.filter((opt) => isDivider(opt) || opt.toLowerCase().includes(searchQuery.toLowerCase()));
	const hasRealOptions = filteredOptions.some((opt) => !isDivider(opt));

	const handleChange = (val: string) => {
		setSelectValue(val);
		onChange(val);
	};

	const handleOpen = () => {
		setSearchQuery('');
		setOpen(true);
		// Фокус на поиск после открытия
		setTimeout(() => searchRef.current?.focus(), 50);
	};

	const handleClose = () => {
		setOpen(false);
		setSearchQuery('');
	};

	return (
		<Stack direction='column' px='12px' gap={0.5}>
			{/* Label + tooltip */}
			<Stack direction='row' alignItems='center' gap={1}>
				{property.isInput && <InputHandle property={property} />}
				<Typography variant='subtitle2' noWrap fontWeight={400} color={defColor}>
					{controlProps.label}
				</Typography>
				<MyToolTip tooltip={controlProps.tooltip ?? ''} ml='auto' />
			</Stack>

			{/* Select */}
			<Select
				value={selectValue}
				onChange={(e) => handleChange(e.target.value as string)}
				open={open}
				onOpen={handleOpen}
				onClose={handleClose}
				variant='standard'
				disableUnderline
				fullWidth
				className='nodrag'
				sx={{
					fontSize: '1.2rem',
					color: greyColor(80),
					borderBottom: `1px solid ${borderColor}`,
					'.MuiSelect-select': { py: 0 },
				}}
				MenuProps={{
					disablePortal: false,
					anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
					transformOrigin: { vertical: 'top', horizontal: 'left' },
					// Отключаем авто-фокус на пункты меню — фокус уходит на search
					autoFocus: false,
					PaperProps: {
						sx: {
							transform: `scale(${zoom}) !important`,
							transformOrigin: 'top left',
							marginTop: `${-(1 - zoom) * 0}px`,
						},
					},
				}}
			>
				{/* Поле поиска — только если freeInput или список длинный */}
				{(controlProps.freeInput || resolvedOptions.length > 10) && (
					<Box sx={{ px: 1, pt: 1, pb: 0.5, backgroundColor: searchBg }} onKeyDown={(e) => e.stopPropagation()}>
						<InputBase
							inputRef={searchRef}
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder='Поиск...'
							fullWidth
							sx={{
								fontSize: '1.2rem',
								color: defColor,
								borderBottom: `1px solid ${borderColor}`,
								pb: '2px',
							}}
						/>
					</Box>
				)}

				{(controlProps.freeInput || resolvedOptions.length > 10) && <Divider />}

				{/* Если freeInput и есть текст поиска — показываем опцию ввода произвольного значения */}
				{controlProps.freeInput && searchQuery && !resolvedOptions.includes(searchQuery) && (
					<MenuItem value='__free_input__' sx={{ fontSize: '1.2rem', fontStyle: 'italic', color: greyColor(60) }}>
						Использовать: «{searchQuery}»
					</MenuItem>
				)}

				{/* Основные опции */}
				{hasRealOptions ? (
					filteredOptions.map((opt, i) =>
						isDivider(opt) ? (
							<Box key={`div-${i}`} sx={{ px: 1.5, py: 0.25, pointerEvents: 'none', userSelect: 'none' }}>
								<Divider textAlign='center' sx={{ my: 0.25, borderColor: 'rgba(255,255,255,0.12)' }}>
									{getDividerText(opt) && (
										<Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1 }}>
											{getDividerText(opt)}
										</Typography>
									)}
								</Divider>
							</Box>
						) : (
							<MenuItem key={opt} value={opt} sx={{ fontSize: '1.2rem', p: '1px 12px' }}>
								{opt}
							</MenuItem>
						),
					)
				) : (
					<MenuItem disabled sx={{ fontSize: 13, p: '1px 12px', color: greyColor(45) }}>
						Ничего не найдено
					</MenuItem>
				)}
			</Select>
		</Stack>
	);
}

export default memo(SimpleDDM);
