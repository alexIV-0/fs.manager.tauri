import { List, ListItem, ListItemButton, Paper, Popper, TextField } from '@mui/material';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import ChipAutocompleteContainer from '@/NODE_WIN/nodes/properties/ChipAutocompleteContainer';
import ControlledChip from '@/NODE_WIN/nodes/properties/ControlledChip';

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
	const [highlightedIndex, setHighlightedIndex] = useState(0);
	const highlightedIndexRef = useRef(0);
	const [showDropdown, setShowDropdown] = useState(false);
	const [dropdownType, setDropdownType] = useState<'input' | 'chip' | null>(null);

	const boxRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const editingChipRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		setChips(props.value ?? []);
	}, [props.value]);

	const updateHighlightedIndex = (index: number) => {
		setHighlightedIndex(index);
		highlightedIndexRef.current = index;
	};

	const filterOptions = useCallback(
		(text: string, cursor: number) => {
			let options = props.options ?? [];

			if (!props.allowDuplicates) {
				options = options.filter((opt) => !chips.includes(opt));
			}

			if (!text.trim()) {
				setFilteredOptions(options);
				updateHighlightedIndex(0);
				setShowDropdown(options.length > 0);
				return;
			}

			const { word } = getActiveWord(text, cursor);
			const searchWord = word.toLowerCase();

			const filtered = options.filter((opt) => opt.toLowerCase().includes(searchWord));
			setFilteredOptions(filtered);
			updateHighlightedIndex(0);
			setShowDropdown(filtered.length > 0);
		},
		[props.options, props.allowDuplicates, chips],
	);

	const addChip = (value: string) => {
		if (!value.trim()) return;
		const next = props.multiSelect ? [...chips, value] : [value];
		setChips(next);
		props.onChange(next);
		setInputValue('');
		setShowDropdown(false);
		setDropdownType(null);
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
			updateHighlightedIndex((highlightedIndexRef.current + 1) % filteredOptions.length);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			updateHighlightedIndex((highlightedIndexRef.current - 1 + filteredOptions.length) % filteredOptions.length);
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
						{filteredOptions.map((opt, i) => (
							<ListItem key={opt} disablePadding>
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
						))}
					</List>
				</Paper>
			</Popper>
		</ChipAutocompleteContainer>
	);
}

export default memo(MyAutocomplete);
