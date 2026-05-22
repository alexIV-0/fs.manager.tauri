import { AutocompletePropertyControlProps, Property } from '@/NODE_WIN/definitions/types';
import { Box, IconButton, List, ListItem, ListItemButton, Paper, Popper, Stack, TextField, Typography } from '@mui/material';
import { X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useResolveOptions } from '@/NODE_WIN/hooks/useResolveOptions';
import { userInputHistory_store } from '@/Store/Node/userInputHistory_store';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import InputHandle from '../components/InputHandle';
import ChipAutocompleteContainer from './ChipAutocompleteContainer';
import ControlledChip from './ControlledChip';
import MyToolTip from './CustomTooltip';

const WORD_SPLIT_REGEX = /[\s\[\]\{\}\(\)"'`.,\-_/\\:;!?]+/;
const EMPTY_ARRAY: string[] = [];

function getActiveWord(value: string, cursor: number) {
	let start = cursor;
	let end = cursor;

	while (start > 0 && !WORD_SPLIT_REGEX.test(value[start - 1])) start--;
	while (end < value.length && !WORD_SPLIT_REGEX.test(value[end])) end++;

	return { word: value.slice(start, end), start, end };
}

interface ChipAutocompletePropertyProps {
	onChange: (value: string[]) => void;
	property?: Property;
	controlProps?: AutocompletePropertyControlProps;
}

function ChipAutocompleteProperty(props: ChipAutocompletePropertyProps) {
	const colorTypes = colorTypes_store((s) => s.colorTypes);

	const settings = props.controlProps ?? (props.property?.controlProps as AutocompletePropertyControlProps);
	// Поддерживает оба формата: #historyValue и #historyValue(customKey)
	const historyOption = settings?.options?.find((o) => /^#historyValue(\(.+\))?$/.test(o)) ?? null;
	const historyKey: string | null = (() => {
		if (!historyOption) return null;
		const m = historyOption.match(/^#historyValue\((.+)\)$/);
		return m ? m[1] : (props.property?.id ?? null);
	})();

	const { resolveOptions } = useResolveOptions(historyKey ?? undefined);
	const addToHistory = userInputHistory_store((s) => s.addToHistory);
	const removeFromHistory = userInputHistory_store((s) => s.removeFromHistory);
	const historyItems = userInputHistory_store((s) => (historyKey ? (s.history[historyKey] ?? EMPTY_ARRAY) : EMPTY_ARRAY));

	// Системные опции (без #historyValue) — их значения не нужно сохранять в историю
	const systemOptionsRef = useRef<Set<string>>(new Set());

	const [inheritedChips, setInheritedChips] = useState<string[]>(
		Array.isArray(settings?.inheritedValue)
			? settings.inheritedValue
			: settings?.inheritedValue != null
				? [settings.inheritedValue]
				: [],
	);

	const [chips, setChips] = useState<string[]>(Array.isArray(settings?.value) ? settings.value : []);
	const [inputValue, setInputValue] = useState('');
	const [editingChipIndex, setEditingChipIndex] = useState<number | null>(null);
	const [editingChipValue, setEditingChipValue] = useState('');

	// Состояние для dropdown
	const [filteredOptions, setFilteredOptions] = useState<string[]>([]);
	const [deletableOptionsSet, setDeletableOptionsSet] = useState<Set<string>>(new Set());
	const [highlightedIndex, setHighlightedIndex] = useState(-1);
	const highlightedIndexRef = useRef(-1); // Используем ref для мгновенного доступа к индексу
	const [showDropdown, setShowDropdown] = useState(false);
	const [dropdownType, setDropdownType] = useState<'input' | 'chip' | null>(null);

	const boxRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const editingChipRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!settings) return;
		const newInherited = Array.isArray(settings.inheritedValue)
			? settings.inheritedValue
			: settings.inheritedValue != null
				? [settings.inheritedValue]
				: [];

		setInheritedChips(newInherited);
	}, [settings?.inheritedValue]);

	useEffect(() => {
		if (!settings) return;
		setChips(Array.isArray(settings.value) ? settings.value : []);
	}, [settings?.value]);

	if (!settings) {
		console.error('ChipAutocompleteProperty: settings is undefined');
		return null;
	}

	// Синхронизируем ref с состоянием
	const updateHighlightedIndex = (index: number) => {
		setHighlightedIndex(index);
		highlightedIndexRef.current = index;
	};

	/** Универсальная фильтрация */
	const filterOptions = useCallback(
		async (text: string, cursor: number) => {
			// #historyValue резолвится через useResolveOptions (с переданным propertyId)
			const options = await resolveOptions(settings.options ?? []);

			// Обновляем кэш системных опций (без #historyValue) для проверки при сохранении
			const sysOnlyOpts = (settings.options ?? []).filter((o) => !/^#historyValue(\(.+\))?$/.test(o));
			const sysResolved = await resolveOptions(sysOnlyOpts);
			systemOptionsRef.current = new Set(sysResolved);

			// Элементы из истории могут уже присутствовать среди resolved options (через #historyValue).
			// Дополнительно вставляем те, которых ещё нет — для корректной работы deletableSet.
			const optionsSet = new Set(options);
			const historyOnly = historyItems.filter((h) => !optionsSet.has(h));
			const allOptions = [...historyOnly, ...options];
			const historySet = new Set(historyItems);

			if (!text.trim()) {
				setFilteredOptions(allOptions);
				setDeletableOptionsSet(new Set(allOptions.filter((o) => historySet.has(o))));
				updateHighlightedIndex(-1);
				setShowDropdown(allOptions.length > 0);
				return;
			}

			const { word } = getActiveWord(text, cursor);
			const searchWord = word.toLowerCase();

			const filtered = allOptions.filter((opt) => opt.toLowerCase().includes(searchWord));
			setFilteredOptions(filtered);
			setDeletableOptionsSet(new Set(filtered.filter((o) => historySet.has(o))));
			updateHighlightedIndex(-1);
			setShowDropdown(filtered.length > 0);
		},
		[settings.options, historyItems, resolveOptions],
	);

	/** Добавление чипа */
	const addChip = (value: string) => {
		if (!value.trim()) return;
		const next = settings.multiSelect ? [...chips, value] : [value];
		setChips(next);
		props.onChange(next);
		setInputValue('');
		setShowDropdown(false);
		setDropdownType(null);
		if (historyKey && !systemOptionsRef.current.has(value)) addToHistory(historyKey, value);
	};

	/** Универсальная замена слова/значения */
	const handleSelectOption = async (replacement: string, commit = false) => {
		// Обработка специальных опций
		if (replacement === 'Custom Folder...') {
			const singleFolderPath = await window.electronAPI.invoke('selectFolders', {
				multiSelect: false,
			});
			if (Array.isArray(singleFolderPath) && singleFolderPath.length > 0) {
				// Добавляем выбранную папку как чип
				singleFolderPath.forEach((path) => addChip(path));
			}
			setShowDropdown(false);
			setDropdownType(null);
			return;
		}

		if (replacement === 'Custom File...') {
			const singleFilePath = await window.electronAPI.invoke('selectFiles', {
				multiSelect: false,
			});
			if (Array.isArray(singleFilePath) && singleFilePath.length > 0) {
				// Добавляем выбранный файл как чип
				singleFilePath.forEach((path) => addChip(path));
			}
			setShowDropdown(false);
			setDropdownType(null);
			return;
		}

		// Обычная обработка для остальных опций
		if (dropdownType === 'input') {
			if (!inputRef.current) return;
			const cursor = inputRef.current.selectionStart ?? inputValue.length;
			const { start, end } = getActiveWord(inputValue, cursor);
			const newValue = inputValue.slice(0, start) + replacement + inputValue.slice(end);

			if (commit) {
				addChip(newValue);
			} else {
				setInputValue(newValue);
				filterOptions(newValue, start + replacement.length);
				requestAnimationFrame(() => {
					const pos = start + replacement.length;
					inputRef.current?.setSelectionRange(pos, pos);
				});
			}
		} else if (dropdownType === 'chip' && editingChipIndex !== null) {
			const chipInput = editingChipRef.current?.querySelector('input');
			if (!chipInput) return;

			const cursor = chipInput.selectionStart ?? editingChipValue.length;
			const { start, end } = getActiveWord(editingChipValue, cursor);
			const newValue = editingChipValue.slice(0, start) + replacement + editingChipValue.slice(end);

			const next = [...chips];
			next[editingChipIndex] = newValue;
			setChips(next);
			props.onChange(next);
			setEditingChipValue(newValue);

			if (commit) {
				if (historyKey && !systemOptionsRef.current.has(newValue)) addToHistory(historyKey, newValue);
				setEditingChipIndex(null);
				setShowDropdown(false);
				setDropdownType(null);
			} else {
				filterOptions(newValue, start + replacement.length);
				requestAnimationFrame(() => {
					const pos = start + replacement.length;
					chipInput.setSelectionRange(pos, pos);
				});
			}
		}
	};

	/** Обработка изменения input */
	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		const cursor = e.target.selectionStart ?? value.length;
		setInputValue(value);
		setDropdownType('input');
		filterOptions(value, cursor);
	};

	/** Обработка изменения редактируемого чипа */
	const handleEditingChipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		const cursor = e.target.selectionStart ?? value.length;
		setEditingChipValue(value);

		if (editingChipIndex !== null) {
			const next = [...chips];
			next[editingChipIndex] = value;
			setChips(next);
			props.onChange(next);
		}

		setDropdownType('chip');
		filterOptions(value, cursor);
	};

	/** Универсальная обработка клавиш */
	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Escape') {
			setShowDropdown(false);
			if (dropdownType === 'chip') setEditingChipIndex(null);
			setDropdownType(null);
			return;
		}

		// Если список закрыт и нажат Enter в режиме чипа - выходим из редактирования
		if (e.key === 'Enter' && dropdownType === 'chip' && !showDropdown) {
			if (historyKey && editingChipValue.trim() && !systemOptionsRef.current.has(editingChipValue)) addToHistory(historyKey, editingChipValue);
			setEditingChipIndex(null);
			setDropdownType(null);
			return;
		}

		// Если список закрыт и нажат Enter в инпуте - создаем чип
		if (e.key === 'Enter' && dropdownType === 'input' && !showDropdown && inputValue.trim()) {
			addChip(inputValue);
			return;
		}

		if (!showDropdown || !filteredOptions.length) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			const cur = highlightedIndexRef.current;
			if (cur === -1) {
				updateHighlightedIndex(0);
			} else if (cur === filteredOptions.length - 1) {
				updateHighlightedIndex(-1);
			} else {
				updateHighlightedIndex(cur + 1);
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			const cur = highlightedIndexRef.current;
			if (cur === -1) {
				updateHighlightedIndex(filteredOptions.length - 1);
			} else if (cur === 0) {
				updateHighlightedIndex(-1);
			} else {
				updateHighlightedIndex(cur - 1);
			}
		} else if (e.key === 'Tab') {
			e.preventDefault();
			const currentOption = filteredOptions[highlightedIndexRef.current];
			if (currentOption) handleSelectOption(currentOption, false);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const currentOption = filteredOptions[highlightedIndexRef.current];
			if (currentOption) {
				handleSelectOption(currentOption, true);
			} else {
				// Нет выделенного элемента — применяем введённый текст
				if (dropdownType === 'input' && inputValue.trim()) {
					addChip(inputValue);
				} else if (dropdownType === 'chip' && editingChipIndex !== null) {
					setEditingChipIndex(null);
					setShowDropdown(false);
					setDropdownType(null);
				}
			}
		}
	};

	const handleInputFocus = () => {
		setDropdownType('input');
		filterOptions(inputValue, inputRef.current?.selectionStart ?? inputValue.length);
	};

	const handleClickAway = (event: MouseEvent | TouchEvent) => {
		const target = event.target as Node | null;
		if (boxRef.current?.contains(target)) return;

		setShowDropdown(false);
		setDropdownType(null);
		setEditingChipIndex(null);
	};

	const handleRemoveChip = (index: number) => {
		const next = [...chips];
		next.splice(index, 1);
		setChips(next);
		props.onChange(next);
		setEditingChipIndex(null);
		setShowDropdown(false);
		setDropdownType(null);
	};

	const handleChipDoubleClick = (index: number) => {
		if (settings.optionsOnly) return;
		setEditingChipIndex(index);
		setEditingChipValue(chips[index]);
		setDropdownType('chip');
		setTimeout(() => {
			const chipInput = editingChipRef.current?.querySelector('input');
			const cursor = chipInput?.selectionStart ?? chips[index].length;
			filterOptions(chips[index], cursor);
		}, 0);
	};

	const handleChipBlur = () => {
		setTimeout(() => {
			setEditingChipIndex(null);
			setShowDropdown(false);
			setDropdownType(null);
		}, 200);
	};

	// Создаем виртуальный элемент для Popper
	const getAnchorEl = () => {
		const targetRef = dropdownType === 'chip' ? editingChipRef : inputRef;
		if (!boxRef.current || !targetRef.current) return null;

		return {
			getBoundingClientRect: () => {
				const boxRect = boxRef.current!.getBoundingClientRect();
				const targetRect = targetRef.current!.getBoundingClientRect();

				return {
					top: targetRect.top,
					bottom: targetRect.bottom,
					left: boxRect.left,
					right: boxRect.right,
					width: boxRect.width,
					height: targetRect.height,
					x: boxRect.left,
					y: targetRect.top,
				} as DOMRect;
			},
		};
	};

	return (
		<Stack direction='column' gap={1} px='12px' color={colorTypes.default as string}>
			<Stack direction='row' alignItems='center' gap={1}>
				{props.property?.isInput && <InputHandle property={props.property} />}
				<Typography variant='subtitle2' noWrap>
					{props.property?.controlProps?.label}
				</Typography>
				<MyToolTip tooltip={props.property?.controlProps?.tooltip || ''} ml='auto' />
			</Stack>

			<ChipAutocompleteContainer
				boxRef={boxRef}
				onClickAway={handleClickAway}
				onClick={() => editingChipIndex === null && inputRef.current?.focus()}
				isFocused={showDropdown}
			>
				{inheritedChips.map((c, i) => (
					<ControlledChip key={`inherited-${i}`} label={c} disabled isEditing={false} />
				))}

				{chips.map((c, i) => (
					<ControlledChip
						key={`chip-${i}`}
						label={c}
						isEditing={editingChipIndex === i}
						editingValue={editingChipValue}
						chipRef={editingChipRef as any}
						onDelete={() => handleRemoveChip(i)}
						onDoubleClick={() => handleChipDoubleClick(i)}
						onChange={handleEditingChipChange}
						onKeyDown={handleKeyDown}
						onBlur={handleChipBlur}
					/>
				))}

				<TextField
					inputRef={inputRef}
					variant='standard'
					value={inputValue}
					onChange={handleInputChange}
					onKeyDown={handleKeyDown}
					placeholder='Выберите...'
					onFocus={handleInputFocus}
					slotProps={{ input: { disableUnderline: true, style: { padding: 0 } } }}
				/>

				<Popper
					open={showDropdown && filteredOptions.length > 0}
					anchorEl={getAnchorEl() as any}
					placement='bottom-start'
					style={{ zIndex: 1300 }}
				>
					<Paper
						sx={{
							width: boxRef.current?.getBoundingClientRect().width || 200,
							maxHeight: 250,
							overflowY: 'auto',
						}}
					>
						<List dense>
							{filteredOptions.map((opt, i) => (
								<ListItem key={opt} disablePadding>
									<ListItemButton
										selected={i === highlightedIndex}
										onMouseDown={(e) => {
											e.preventDefault();
											handleSelectOption(opt, true);
										}}
										sx={{
											pr: 0.5,
											'& .history-delete': { opacity: 0, transition: 'opacity 0.15s' },
											'&:hover .history-delete': { opacity: 1 },
										}}
									>
										<Box sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt}</Box>
										{deletableOptionsSet.has(opt) && (
											<IconButton
												className='history-delete'
												size='small'
												onMouseDown={(e) => {
													e.preventDefault();
													e.stopPropagation();
													removeFromHistory(historyKey!, opt);
													setFilteredOptions((prev) => prev.filter((o) => o !== opt));
													setDeletableOptionsSet((prev) => {
														const next = new Set(prev);
														next.delete(opt);
														return next;
													});
												}}
												sx={{ p: 0.25, ml: 0.5, flexShrink: 0 }}
											>
												<X size={12} />
											</IconButton>
										)}
									</ListItemButton>
								</ListItem>
							))}
						</List>
					</Paper>
				</Popper>
			</ChipAutocompleteContainer>
		</Stack>
	);
}

export default memo(ChipAutocompleteProperty);
