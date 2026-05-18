import { AutocompletePropertyControlProps, Property } from '@/NODE_WIN/definitions/types';
import { List, ListItem, ListItemButton, Paper, Popper, Stack, TextField, Typography } from '@mui/material';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import ChipAutocompleteContainer from './ChipAutocompleteContainer';
import MyToolTip from './CustomTooltip';

interface AutocompletePathProps {
	onChange: (value: string[]) => void;
	property?: Property;
	controlProps?: AutocompletePropertyControlProps;
	/** Режим работы: 'file' - путь к файлу, 'json' - путь по ключам JSON */
	mode?: 'file' | 'json';
	/** Путь к JSON файлу для режима 'json' */
	jsonFilePath?: string | string[];
}

interface FileSystemItem {
	name: string;
	path: string;
	isDirectory: boolean;
}

interface SpecialOption {
	type: 'file' | 'folder';
	label: string;
}

function AutocompletePath(props: AutocompletePathProps) {
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const settings = props.controlProps ?? (props.property?.controlProps as AutocompletePropertyControlProps);

	if (!settings) {
		console.error('AutocompletePath: settings is undefined');
		return null;
	}

	const mode = props.mode || 'file';

	const [chips, setChips] = useState<string[]>(Array.isArray(settings.value) ? settings.value : []);
	const [filteredOptions, setFilteredOptions] = useState<FileSystemItem[]>([]);
	const [highlightedIndex, setHighlightedIndex] = useState(0);
	const [showDropdown, setShowDropdown] = useState(false);
	const [currentPath, setCurrentPath] = useState<string>('');
	const [baseFolder, setBaseFolder] = useState<string>('');

	const boxRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const highlightedIndexRef = useRef(0);

	/** Чтение содержимого директории */
	const loadDirectoryContents = useCallback(async (path: string) => {
		try {
			// Проверяем существование пути
			const checkedPath = await window.electronAPI.invoke('checkFilePath', path);
			if (!checkedPath) {
				setFilteredOptions([]);
				return;
			}

			// Получаем содержимое папки
			const result: any = await window.electronAPI.invoke('getSomeFromFolder', path, [
				{ type: 'folders', ext: [] },
				{ type: 'files', ext: [] },
			]);

			if (!result || !Array.isArray(result)) {
				setFilteredOptions([]);
				return;
			}

			const items: FileSystemItem[] = result.map((item: any) => {
				const isDir = typeof item === 'string' && item.endsWith('/');
				const cleanName = isDir ? item.slice(0, -1) : item;
				return {
					name: cleanName,
					path: path + '/' + cleanName,
					isDirectory: isDir,
				};
			});

			// Сортируем: сначала папки, потом файлы
			items.sort((a, b) => {
				if (a.isDirectory === b.isDirectory) {
					return a.name.localeCompare(b.name);
				}
				return a.isDirectory ? -1 : 1;
			});

			setFilteredOptions(items);
		} catch (error) {
			console.error('AutocompletePath: Error loading directory contents:', error);
			setFilteredOptions([]);
		}
	}, []);

	/** Получение родительской директории */
	const getParentPath = useCallback(async (path: string): Promise<string | null> => {
		try {
			const parentPath = await window.electronAPI.invoke<string>('pathDirname', path);
			// Проверяем, не достигли ли мы корня
			const basename = await window.electronAPI.invoke<string>('pathBasename', path);
			if (!basename || basename === path) {
				return null;
			}
			return parentPath;
		} catch (error) {
			console.error('AutocompletePath: Error getting parent path:', error);
			return null;
		}
	}, []);

	/** Чтение ключей JSON для режима 'json' */
	const loadJsonKeys = useCallback(async (jsonPath: string, selectedKeys: string[]) => {
		try {
			const checkedPath = await window.electronAPI.invoke('checkFilePath', jsonPath);
			if (!checkedPath) {
				setFilteredOptions([]);
				return;
			}

			const jsonContent: string = await window.electronAPI.invoke('readFileSync', checkedPath);
			const jsonData = JSON.parse(jsonContent);

			// Находим текущий уровень вложенности
			let currentLevel: any = jsonData;
			for (const key of selectedKeys) {
				if (currentLevel && typeof currentLevel === 'object' && key in currentLevel) {
					currentLevel = currentLevel[key];
				} else {
					setFilteredOptions([]);
					return;
				}
			}

			// Извлекаем ключи или индексы массива
			const items: FileSystemItem[] = [];
			if (currentLevel && typeof currentLevel === 'object' && !Array.isArray(currentLevel)) {
				Object.keys(currentLevel).forEach((key) => {
					items.push({
						name: key,
						path: key,
						isDirectory: typeof currentLevel[key] === 'object' && currentLevel[key] !== null,
					});
				});
			} else if (Array.isArray(currentLevel)) {
				currentLevel.forEach((_: any, index: number) => {
					items.push({
						name: index.toString(),
						path: index.toString(),
						isDirectory: typeof currentLevel[index] === 'object' && currentLevel[index] !== null,
					});
				});
			}

			items.sort((a, b) => a.name.localeCompare(b.name));
			setFilteredOptions(items);
		} catch (error) {
			console.error('AutocompletePath: Error loading JSON keys:', error);
			setFilteredOptions([]);
		}
	}, []);

	/** Обновление текущего пути и опций при изменении чипов */
	useEffect(() => {
		const loadPathContents = async () => {
			if (mode === 'file') {
				if (chips.length === 0) {
					// Если чипов нет, возвращаем пустой список
					// Пользователь должен выбрать через Custom Folder/Custom File
					setBaseFolder('');
					setCurrentPath('');
					setFilteredOptions([]);
					return;
				}

				// Собираем текущий путь из чипов
				let path = chips[0];
				for (let i = 1; i < chips.length; i++) {
					path = path + '/' + chips[i];
				}
				setCurrentPath(path);
				setBaseFolder(chips[0]);

				// Проверяем, является ли последний чип директорией
				const lastChipPath = path;

				const exists = await window.electronAPI.invoke('checkFilePath', lastChipPath);
				if (exists) {
					await loadDirectoryContents(lastChipPath);
				} else {
					// Если путь не существует, показываем содержимое родительской директории
					if (chips.length > 1) {
						const parentPath = chips.slice(0, -1).join('/');
						await loadDirectoryContents(parentPath);
					} else {
						setFilteredOptions([]);
					}
				}
			} else if (mode === 'json') {
				// Нормализуем jsonFilePath
				let jsonPath = '';
				if (Array.isArray(props.jsonFilePath)) {
					jsonPath = props.jsonFilePath.join('/');
				} else if (typeof props.jsonFilePath === 'string') {
					jsonPath = props.jsonFilePath;
				}

				if (jsonPath) {
					loadJsonKeys(jsonPath, chips);
				}
			}
		};

		if (showDropdown) {
			loadPathContents();
		}
	}, [chips, mode, props.jsonFilePath, showDropdown, loadDirectoryContents, loadJsonKeys]);

	useEffect(() => {
		setChips(Array.isArray(settings.value) ? settings.value : []);
	}, [settings.value]);

	const updateHighlightedIndex = (index: number) => {
		setHighlightedIndex(index);
		highlightedIndexRef.current = index;
	};

	/** Добавление чипа */
	const addChip = (value: string, keepOpen = false) => {
		if (!value.trim()) return;
		const next = settings.multiSelect ? [...chips, value] : [value];
		setChips(next);
		props.onChange(next);
		if (!keepOpen) setShowDropdown(false);
	};

	/** Переход в выбранную директорию (для режима 'file') */
	const handleNavigateToDirectory = async (item: FileSystemItem) => {
		if (mode === 'file' && item.isDirectory) {
			// Добавляем папку как чип, дропдаун остаётся открытым — сразу показываем содержимое
			addChip(item.name, true);
		} else {
			// Выбираем файл или ключ JSON — закрываем дропдаун
			addChip(item.name);
		}
	};

	/** Обработка клавиш */
	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Escape') {
			setShowDropdown(false);
			return;
		}

		if (e.key === 'Backspace' && chips.length > 0) {
			// Удаляем последний чип при нажатии Backspace в пустом инпуте
			if (!inputRef.current?.value) {
				const next = [...chips];
				next.pop();
				setChips(next);
				props.onChange(next);
			}
			return;
		}

		if (!showDropdown || !filteredOptions.length) return;

		// Корректируем индекс с учётом опции "../"
		const actualIndex = highlightedIndexRef.current - (showGoUp ? 1 : 0);
		// Общее количество опций с учётом "../" и специальных опций
		const specialOptionsCount = mode === 'file' ? 2 : 0; // Custom Folder + Custom File
		const totalOptions = filteredOptions.length + (showGoUp ? 1 : 0) + specialOptionsCount;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			const newIndex = (highlightedIndexRef.current + 1) % totalOptions;
			updateHighlightedIndex(newIndex);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			const newIndex = (highlightedIndexRef.current - 1 + totalOptions) % totalOptions;
			updateHighlightedIndex(newIndex);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			if (showGoUp && highlightedIndexRef.current === 0) {
				handleGoUp();
			} else if (actualIndex >= 0 && actualIndex < filteredOptions.length) {
				handleNavigateToDirectory(filteredOptions[actualIndex]);
			}
			// Special options не поддерживают Tab для простоты
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (showGoUp && highlightedIndexRef.current === 0) {
				handleGoUp();
			} else if (actualIndex >= 0 && actualIndex < filteredOptions.length) {
				handleNavigateToDirectory(filteredOptions[actualIndex]);
			}
			// Special options не поддерживают Enter для простоты
		}
	};

	const handleInputFocus = () => {
		// При фокусе показываем все опции
		setShowDropdown(true);
	};

	const handleClickAway = (event: MouseEvent | TouchEvent) => {
		const target = event.target as Node | null;
		if (boxRef.current?.contains(target)) return;
		setShowDropdown(false);
	};

	/** Фильтрация опций по введенному тексту */
	const filterOptions = useCallback((text: string) => {
		// Для текстового отображения пути просто показываем dropdown
		// Фильтрацию можно добавить позже при необходимости
		setShowDropdown(true);
		updateHighlightedIndex(0);
	}, []);

	/** Виртуальный элемент для Popper */
	const getAnchorEl = () => {
		if (!boxRef.current || !inputRef.current) return null;

		return {
			getBoundingClientRect: () => {
				const boxRect = boxRef.current!.getBoundingClientRect();
				const targetRect = inputRef.current!.getBoundingClientRect();

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

	/** Отображение иконки для элемента */
	const renderOptionLabel = (item: FileSystemItem) => {
		const icon = item.isDirectory ? '📁' : '📄';
		return `${icon} ${item.name}`;
	};

	/** Обработка выбора специальной опции */
	const handleSpecialOption = async (type: 'file' | 'folder') => {
		setShowDropdown(false);
		if (type === 'file') {
			const result = await window.electronAPI.invoke<string[]>('selectFiles', { multiSelect: false });
			if (result && result.length > 0) {
				// Получаем относительный путь от базовой папки
				const selectedPath = result[0];
				if (baseFolder && selectedPath.startsWith(baseFolder)) {
					// Вычисляем относительный путь
					const relativePath = selectedPath.substring(baseFolder.length + 1);
					const parts = relativePath.split(/[\/\\]/);
					setChips(parts);
					props.onChange(parts);
				} else {
					// Если путь не начинается с baseFolder, используем как есть
					const parts = selectedPath.split(/[\/\\]/);
					setChips(parts);
					props.onChange(parts);
				}
			}
		} else {
			const result = await window.electronAPI.invoke<string[]>('selectFolders', { multiSelect: false });
			if (result && result.length > 0) {
				const selectedPath = result[0];
				if (baseFolder && selectedPath.startsWith(baseFolder)) {
					const relativePath = selectedPath.substring(baseFolder.length + 1);
					const parts = relativePath.split(/[\/\\]/);
					setChips(parts);
					props.onChange(parts);
				} else {
					const parts = selectedPath.split(/[\/\\]/);
					setChips(parts);
					props.onChange(parts);
				}
			}
		}
	};

	/** Обработка перехода на уровень выше */
	const handleGoUp = async () => {
		if (chips.length > 0) {
			const next = [...chips];
			next.pop();
			setChips(next);
			props.onChange(next);
		}
	};

	/** Показывать ли опцию "../" */
	const showGoUp = chips.length > 0 && mode === 'file';

	// Сбрасываем highlightedIndex при изменении showGoUp
	useEffect(() => {
		updateHighlightedIndex(0);
	}, [showGoUp]);

	return (
		<Stack direction='column' gap={1} px='12px' color={colorTypes.default as string}>
			<Stack direction='row' alignItems='center' gap={1}>
				<Typography variant='subtitle2' noWrap>
					{props.property?.controlProps?.label}
				</Typography>
				<MyToolTip tooltip={props.property?.controlProps?.tooltip || ''} ml='auto' />
			</Stack>

			<ChipAutocompleteContainer
				boxRef={boxRef}
				onClickAway={handleClickAway}
				onClick={() => inputRef.current?.focus()}
				isFocused={showDropdown}
			>
				{/* Отображение пути текстом */}
				<TextField
					inputRef={inputRef}
					variant='standard'
					value={chips.join('/')}
					onChange={(e) => filterOptions(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={mode === 'file' ? 'Выберите путь...' : 'Выберите ключ...'}
					onFocus={handleInputFocus}
					slotProps={{
						input: {
							disableUnderline: true,
							style: { padding: 0, cursor: 'pointer' },
						},
					}}
					sx={{
						minWidth: 100,
						width: '100%',
						'& .MuiInputBase-input': {
							padding: '4px 0',
						},
					}}
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
							{/* Опция перехода на уровень выше */}
							{showGoUp && (
								<ListItem key='go-up' disablePadding>
									<ListItemButton
										selected={highlightedIndex === 0}
										onMouseDown={(e) => {
											e.preventDefault();
											handleGoUp();
										}}
									>
										📂 ..
									</ListItemButton>
								</ListItem>
							)}
							{/* Остальные опции */}
							{filteredOptions.map((opt, i) => (
								<ListItem key={opt.path} disablePadding>
									<ListItemButton
										selected={highlightedIndex === (showGoUp ? i + 1 : i)}
										onMouseDown={(e) => {
											e.preventDefault();
											handleNavigateToDirectory(opt);
										}}
									>
										{renderOptionLabel(opt)}
									</ListItemButton>
								</ListItem>
							))}
							{/* Специальные опции в конце */}
							{mode === 'file' && (
								<>
									<ListItem key='custom-folder' disablePadding>
										<ListItemButton
											selected={false}
											onMouseDown={(e) => {
												e.preventDefault();
												handleSpecialOption('folder');
											}}
										>
											📁 Custom Folder...
										</ListItemButton>
									</ListItem>
									<ListItem key='custom-file' disablePadding>
										<ListItemButton
											selected={false}
											onMouseDown={(e) => {
												e.preventDefault();
												handleSpecialOption('file');
											}}
										>
											📄 Custom File...
										</ListItemButton>
									</ListItem>
								</>
							)}
						</List>
					</Paper>
				</Popper>
			</ChipAutocompleteContainer>
		</Stack>
	);
}

export default memo(AutocompletePath);
