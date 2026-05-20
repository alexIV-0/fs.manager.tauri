import { IconButton, List, ListItem, ListItemButton, Paper, Popper, TextField } from '@mui/material';
import { X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChipAutocompleteContainer from '@/NODE_WIN/nodes/properties/ChipAutocompleteContainer';
import ControlledChip from '@/NODE_WIN/nodes/properties/ControlledChip';
import { userInputHistory_store } from '@/Store/Node/userInputHistory_store';

/** Достаёт ключ из токена `#historyValue(key)`. Поддерживает голый `#historyValue`. */
function parseHistoryKey(token: string): string | null {
	const m = token.match(/^#historyValue(?:\((.+)\))?$/);
	return m ? (m[1] ?? '') : null;
}

const WORD_SPLIT_REGEX = /[\s\[\]\{\}\(\)"'`.,\-_/\\:;!?]+/;

function getActiveWord(value: string, cursor: number) {
	let start = cursor;
	let end = cursor;

	while (start > 0 && !WORD_SPLIT_REGEX.test(value[start - 1])) start--;
	while (end < value.length && !WORD_SPLIT_REGEX.test(value[end])) end++;

	return { word: value.slice(start, end), start, end };
}

interface MyAutocompleteProps {
	options: string[];
	value: string[];
	multiSelect?: boolean;
	allowDuplicates?: boolean;
	optionsOnly?: boolean;
	onChange: (value: string[]) => void;
}

function MyAutocomplete(props: MyAutocompleteProps) {
	const [chips, setChips] = useState<string[]>(props.value ?? []);
	const [inputValue, setInputValue] = useState('');
	const [editingChipIndex, setEditingChipIndex] = useState<number | null>(null);
	const [editingChipValue, setEditingChipValue] = useState('');

	const [filteredOptions, setFilteredOptions] = useState<string[]>([]);
	// -1 = ничего не подсвечено. Чтобы подсветить первую опцию, пользователь должен нажать ↓.
	// Если оставить 0 — первая опция всегда визуально «выбрана», даже если её ещё не трогали.
	const [highlightedIndex, setHighlightedIndex] = useState(-1);
	const highlightedIndexRef = useRef(-1);
	const [showDropdown, setShowDropdown] = useState(false);
	const [dropdownType, setDropdownType] = useState<'input' | 'chip' | null>(null);

	const boxRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const editingChipRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		setChips(props.value ?? []);
	}, [props.value]);

	// ── History support ──────────────────────────────────────────────────────
	// Если в options встречается токен `#historyValue(<key>)`, мы:
	//   1) подменяем его на актуальные значения из userInputHistory_store
	//   2) при добавлении chip сохраняем введённое в историю
	//   3) рядом с history-элементами в дропдауне рисуем X для удаления
	const historyKeys = useMemo(
		() =>
			(props.options ?? [])
				.map(parseHistoryKey)
				.filter((k): k is string => k !== null && k !== ''),
		[props.options],
	);

	// Подписываемся на стор истории — чтобы дропдаун обновлялся при add/remove.
	const historyMap = userInputHistory_store((s) => s.history);

	// Системные опции (без #historyValue) — имеют приоритет: они не дублируются истории
	// и не получают ✕-кнопку в дропдауне.
	const systemOptions = useMemo(() => {
		const result: string[] = [];
		for (const opt of props.options ?? []) {
			if (parseHistoryKey(opt) === null) result.push(opt);
		}
		return result;
	}, [props.options]);

	// effectiveOptions = системные опции + история (с дедупликацией: значения из истории,
	// которые уже есть среди системных, отбрасываются — чтобы $projectName не появлялся дважды).
	const effectiveOptions = useMemo(() => {
		const systemSet = new Set(systemOptions);
		const result: string[] = [...systemOptions];
		for (const k of historyKeys) {
			for (const v of historyMap[k] ?? []) {
				if (!systemSet.has(v) && !result.includes(v)) result.push(v);
			}
		}
		return result;
	}, [systemOptions, historyKeys, historyMap]);

	// Значения принадлежат истории ТОЛЬКО если они не дублируют системную опцию.
	// Это гарантирует что ✕ не появится рядом с $projectName и другими системными паттернами.
	const historyValueSet = useMemo(() => {
		const systemSet = new Set(systemOptions);
		const s = new Set<string>();
		for (const k of historyKeys) {
			for (const v of historyMap[k] ?? []) {
				if (!systemSet.has(v)) s.add(v);
			}
		}
		return s;
	}, [historyKeys, historyMap, systemOptions]);

	const updateHighlightedIndex = (index: number) => {
		setHighlightedIndex(index);
		highlightedIndexRef.current = index;
	};

	const filterOptions = useCallback(
		(text: string, cursor: number) => {
			let options = effectiveOptions;

			if (!props.allowDuplicates) {
				options = options.filter((opt) => !chips.includes(opt));
			}

			if (!text.trim()) {
				setFilteredOptions(options);
				updateHighlightedIndex(-1);
				setShowDropdown(options.length > 0);
				return;
			}

			const { word } = getActiveWord(text, cursor);
			const searchWord = word.toLowerCase();

			const filtered = options.filter((opt) => opt.toLowerCase().includes(searchWord));
			setFilteredOptions(filtered);
			updateHighlightedIndex(-1);
			setShowDropdown(filtered.length > 0);
		},
		[effectiveOptions, props.allowDuplicates, chips],
	);

	const addChip = (value: string) => {
		if (!value.trim()) return;
		const next = props.multiSelect ? [...chips, value] : [value];
		setChips(next);
		props.onChange(next);

		// Сохраняем в историю — для всех historyKey'ев, привязанных к этому полю.
		// Это решает кейс: пользователь ввёл произвольный путь / название БД,
		// при следующем открытии оно появится в дропдауне.
		if (historyKeys.length > 0) {
			const addToHistory = userInputHistory_store.getState().addToHistory;
			for (const k of historyKeys) addToHistory(k, value);
		}

		setInputValue('');
		setShowDropdown(false);
		setDropdownType(null);
	};

	/** Удаление значения из истории (X-кнопка справа от history-элемента). */
	const handleRemoveFromHistory = (value: string) => {
		const remove = userInputHistory_store.getState().removeFromHistory;
		for (const k of historyKeys) remove(k, value);
		// Локально подрезаем filtered, чтобы дропдаун обновился сразу,
		// до того как effectiveOptions пересчитается через useMemo.
		setFilteredOptions((prev) => prev.filter((opt) => opt !== value));
	};

	const handleSelectOption = async (replacement: string, commit = false) => {
		if (replacement === 'Custom Folder...') {
			const singleFolderPath = await window.electronAPI.invoke('selectFolders', {
				multiSelect: false,
			});
			if (Array.isArray(singleFolderPath) && singleFolderPath.length > 0) {
				singleFolderPath.forEach((path) => addChip(path));
			}
			setShowDropdown(false);
			setDropdownType(null);
			return;
		}

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

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		const cursor = e.target.selectionStart ?? value.length;
		setInputValue(value);
		setDropdownType('input');
		filterOptions(value, cursor);
	};

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

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Escape') {
			setShowDropdown(false);
			if (dropdownType === 'chip') setEditingChipIndex(null);
			setDropdownType(null);
			return;
		}

		if (e.key === 'Enter' && dropdownType === 'chip' && !showDropdown) {
			setEditingChipIndex(null);
			setDropdownType(null);
			return;
		}

		if (e.key === 'Enter' && dropdownType === 'input' && !showDropdown && inputValue.trim()) {
			addChip(inputValue);
			return;
		}

		if (!showDropdown || !filteredOptions.length) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			const cur = highlightedIndexRef.current;
			// Из «ничего не выбрано» (-1) сразу прыгаем на первую опцию.
			updateHighlightedIndex(cur < 0 ? 0 : (cur + 1) % filteredOptions.length);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			const cur = highlightedIndexRef.current;
			updateHighlightedIndex(cur < 0 ? filteredOptions.length - 1 : (cur - 1 + filteredOptions.length) % filteredOptions.length);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			const currentOption = filteredOptions[highlightedIndexRef.current];
			if (currentOption) handleSelectOption(currentOption, false);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const currentOption = filteredOptions[highlightedIndexRef.current];
			if (currentOption) handleSelectOption(currentOption, true);
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
		if (props.optionsOnly) return;
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
		<ChipAutocompleteContainer
			boxRef={boxRef}
			onClickAway={handleClickAway}
			onClick={() => editingChipIndex === null && inputRef.current?.focus()}
			isFocused={showDropdown}
		>
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
				autoComplete='off'
				slotProps={{
					input: { disableUnderline: true, style: { padding: 0 } },
					htmlInput: {
						autoComplete: 'off',
						autoCorrect: 'off',
						autoCapitalize: 'off',
						spellCheck: false,
						'data-1p-ignore': 'true',
						'data-lpignore': 'true',
						'data-form-type': 'other',
					},
				}}
				sx={{ flex: '1 1 120px', minWidth: '80px' }}
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
						maxHeight: 200,
						overflowY: 'auto',
					}}
				>
					<List dense>
						{filteredOptions.map((opt, i) => {
							const isFromHistory = historyValueSet.has(opt);
							return (
								<ListItem
									key={opt}
									disablePadding
									secondaryAction={
										isFromHistory ? (
											<IconButton
												edge='end'
												size='small'
												aria-label='Remove from history'
												onMouseDown={(e) => {
													// preventDefault — иначе ListItemButton получит mousedown и закроет дропдаун.
													e.preventDefault();
													e.stopPropagation();
													handleRemoveFromHistory(opt);
												}}
												sx={{ mr: 0.25 }}
											>
												<X size={14} />
											</IconButton>
										) : null
									}
								>
									<ListItemButton
										selected={i === highlightedIndex}
										onMouseDown={(e) => {
											e.preventDefault();
											handleSelectOption(opt, true);
										}}
									>
										{opt}
									</ListItemButton>
								</ListItem>
							);
						})}
					</List>
				</Paper>
			</Popper>
		</ChipAutocompleteContainer>
	);
}

export default memo(MyAutocomplete);
