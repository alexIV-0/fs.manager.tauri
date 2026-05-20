import { greyColor, defGray } from '@/Store/Color/grayColor';
import { PatternStore } from '@/Store/MainWin/pathPattern_store';
import { IconButton, ListItem } from '@mui/material';
import { Trash2, GripVertical } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MyTypography from '../Universal/MyTypography';
import { MyPopoverColor } from '../Universal/MyPopoverColor';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import MyAutocomplete from '../Universal/MyAutocomplete';

export function CustomSettinsElement({
	name,
	id,
	store,
	useColor,
	onColorPickerOpenChange,
	options = [],
	multiSelect = true,
	allowDuplicates = false,
	optionsOnly,
}: {
	name: string;
	id: string;
	store: PatternStore;
	useColor?: any;
	onColorPickerOpenChange?: (isOpen: boolean) => void;
	options?: string[];
	multiSelect?: boolean;
	optionsOnly?: boolean;
	allowDuplicates?: boolean;
}) {
	/* ---------------- dnd-kit ---------------- */
	const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.85 : 1,
	};

	/* ---------------- state ---------------- */
	// const listItemRef = useRef<HTMLLIElement>(null);

	// ИСПРАВЛЕНИЕ: Используем options напрямую из пропсов, а не через state
	const [modPath, setModPath] = useState<string[]>([]);

	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const [color, setColor] = useState(useColor);
	const colorRef = useRef(color);

	const customFolder = 'Custom Folder...';
	const customFile = 'Custom File...';

	/* ---------------- handlers ---------------- */
	const handleColorChange = useCallback(
		(newColor: string) => {
			setColor(newColor);
			colorRef.current = newColor;
			store.updatePatternElementColor(id, newColor);
		},
		[id, store],
	);

	const handleColorPickerOpenChange = useCallback(
		(isOpen: boolean) => {
			onColorPickerOpenChange?.(isOpen);
		},
		[onColorPickerOpenChange],
	);

	const handleSelected = useCallback(
		async (val: string | string[]) => {
			const next = Array.isArray(val) ? val : [val];

			if (next.includes(customFolder)) {
				const singleFolderPath = await window.electronAPI.invoke('selectFolders', {
					multiSelect: false,
				});
				if (Array.isArray(singleFolderPath) && singleFolderPath.length > 0) {
					setModPath(singleFolderPath);
					store.updatePatternElementPath(id, singleFolderPath);
				}
				return;
			}

			if (next.includes(customFile)) {
				const singleFilePath = await window.electronAPI.invoke('selectFiles', {
					multiSelect: false,
				});
				if (Array.isArray(singleFilePath) && singleFilePath.length > 0) {
					setModPath(singleFilePath);
					store.updatePatternElementPath(id, singleFilePath);
				}
				return;
			}

			setModPath(next);
			store.updatePatternElementPath(id, next);
		},
		[id, store],
	);

	// ИСПРАВЛЕНИЕ: Обновляем modPath при изменении store
	useEffect(() => {
		const curElement = store.patternStore.find((el) => el.id === id);
		if (!curElement) return;

		setModPath(curElement.path);

		if (curElement.color !== colorRef.current) {
			setColor(curElement.color);
			colorRef.current = curElement.color;
		}
	}, [store.patternStore, id]);

	// Дефолтные элементы: нельзя удалять и переименовывать (path/color — можно).
	const isDefault = store.patternStore.find((el) => el.id === id)?.isDefault === true;

	// ИСПРАВЛЕНИЕ: Убираем problematic useEffect с newOptions
	// Вместо этого передаем options напрямую в Autocomplete

	const handleDelete = () => {
		store.removePatternElement(id);
	};

	// ИСПРАВЛЕНИЕ: Формируем актуальные опции для автокомплита
	const actualOptions = useMemo(() => {
		// Базовые опции из пропсов (availablePlugins)
		let opts = [...options];

		// Добавляем Custom Folder/File если нужно
		if (!optionsOnly) {
			if (!opts.includes(customFolder)) opts = [...opts, customFolder];
			if (!opts.includes(customFile)) opts = [...opts, customFile];
		}

		// console.log(`Options for ${name} (${id}):`, opts);
		return opts;
	}, [options, optionsOnly]);

	/* ---------------- render ---------------- */
	return (
		<ListItem
			ref={setNodeRef}
			style={style}
			disablePadding
			sx={{
				position: 'relative',
				// borderRadius: '4px',
				m: '0 0 6px 0',
				alignItems: 'center',
				borderBottom: `0.5px solid ${colorTypes.default}`,
				'&:hover': {
					backgroundColor: greyColor(20),
				},
			}}
		>
			{/* drag handle */}
			<IconButton
				size='small'
				{...attributes}
				{...listeners}
				sx={{
					cursor: 'grab',
					mr: 1,
					p: 0.5,
					color: defGray,
					'&:hover': {
						color: greyColor(100),
						backgroundColor: 'transparent',
					},
				}}
			>
				<GripVertical strokeWidth={1.2} size={20} />
			</IconButton>

			<MyTypography
				innerText={name}
				readOnly={isDefault}
				onChange={isDefault ? undefined : (e) => store.updatePatternElementName(id, e)}
			/>

			<MyAutocomplete
				multiSelect={multiSelect}
				allowDuplicates={allowDuplicates}
				options={actualOptions} // ИСПРАВЛЕНИЕ: Используем actualOptions вместо newOptions
				value={modPath}
				onChange={handleSelected}
				optionsOnly={optionsOnly}
			/>

			{color && <MyPopoverColor color={color} onChange={handleColorChange} onOpenChange={handleColorPickerOpenChange} />}

			{!isDefault && (
				<IconButton onClick={handleDelete}>
					<Trash2 strokeWidth={0.5} />
				</IconButton>
			)}
		</ListItem>
	);
}

// export function CustomSettinsElement({
// 	name,
// 	id,
// 	store,
// 	useColor,
// 	onColorPickerOpenChange,
// 	options = [],
// 	multiSelect = true,
// 	allowDuplicates = false,
// 	optionsOnly,
// }: {
// 	name: string;
// 	id: string;
// 	store: PatternStore;
// 	useColor?: any;
// 	onColorPickerOpenChange?: (isOpen: boolean) => void;
// 	options?: string[];
// 	multiSelect?: boolean;
// 	optionsOnly?: boolean;
// 	allowDuplicates?: boolean;
// }) {
// 	/* ---------------- dnd-kit ---------------- */

// 	const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });

// 	const style = {
// 		transform: CSS.Transform.toString(transform),
// 		transition,
// 		opacity: isDragging ? 0.85 : 1,
// 	};

// 	/* ---------------- state ---------------- */

// 	const listItemRef = useRef<HTMLLIElement>(null);

// 	const [newOptions, setNewOptions] = useState<string[]>(options);
// 	const [modPath, setModPath] = useState<string[]>([]);

// 	const colorTypes = colorTypes_store((s) => s.colorTypes);
// 	const [color, setColor] = useState(useColor);
// 	const colorRef = useRef(color);

// 	const customFolder = 'Custom Folder...';
// 	const customFile = 'Custom File...';

// 	/* ---------------- handlers ---------------- */

// 	const handleColorChange = useCallback(
// 		(newColor: string) => {
// 			setColor(newColor);
// 			colorRef.current = newColor;
// 			store.updatePatternElementColor(id, newColor);
// 		},
// 		[id, store],
// 	);

// 	const handleColorPickerOpenChange = useCallback(
// 		(isOpen: boolean) => {
// 			onColorPickerOpenChange?.(isOpen);
// 		},
// 		[onColorPickerOpenChange],
// 	);

// 	const handleSelected = useCallback(
// 		async (val: string | string[]) => {
// 			const next = Array.isArray(val) ? val : [val];

// 			if (next.includes(customFolder)) {
// 				const singleFolderPath = await window.electronAPI.invoke('selectFolders', {
// 					multiSelect: false,
// 				});
// 				if (Array.isArray(singleFolderPath) && singleFolderPath.length > 0) {
// 					setModPath(singleFolderPath);
// 					store.updatePatternElementPath(id, singleFolderPath);
// 				}
// 				return;
// 			}

// 			if (next.includes(customFile)) {
// 				const singleFilePath = await window.electronAPI.invoke('selectFiles', {
// 					multiSelect: false,
// 				});
// 				if (Array.isArray(singleFilePath) && singleFilePath.length > 0) {
// 					setModPath(singleFilePath);
// 					store.updatePatternElementPath(id, singleFilePath);
// 				}
// 				return;
// 			}

// 			setModPath(next);
// 			store.updatePatternElementPath(id, next);
// 		},
// 		[id, store],
// 	);

// 	useEffect(() => {
// 		if (store.patternStore.length > 0) {
// 			setNewOptions([...newOptions]);
// 		} else {
// 			setNewOptions([customFolder]);
// 		}
// 	}, [store.patternStore]);

// 	useEffect(() => {
// 		const curElement = store.patternStore.find((el) => el.id === id);
// 		if (!curElement) return;

// 		setModPath(curElement.path);

// 		if (curElement.color !== colorRef.current) {
// 			setColor(curElement.color);
// 			colorRef.current = curElement.color;
// 		}
// 	}, [store.patternStore, id]);

// 	const handleDelete = () => {
// 		store.removePatternElement(id);
// 	};

// 	/* ---------------- render ---------------- */

// 	return (
// 		<ListItem
// 			ref={setNodeRef}
// 			style={style}
// 			disablePadding
// 			sx={{
// 				position: 'relative',
// 				borderRadius: '4px',
// 				m: '0 0 6px 0',
// 				alignItems: 'center',
// 				borderBottom: `0.5px solid ${colorTypes.default}`,
// 				'&:hover': {
// 					backgroundColor: greyColor(20),
// 				},
// 			}}
// 		>
// 			{/* drag handle */}
// 			<IconButton
// 				size='small'
// 				{...attributes}
// 				{...listeners}
// 				sx={{
// 					cursor: 'grab',
// 					mr: 1,
// 					p: 0.5,
// 					color: defGray,
// 					'&:hover': {
// 						color: greyColor(100),
// 						backgroundColor: 'transparent',
// 					},
// 				}}
// 			>
// 				<GripVertical strokeWidth={1.2} size={20} />
// 			</IconButton>

// 			<MyTypography innerText={name} onChange={(e) => store.updatePatternElementName(id, e)} />

// 			<Autocomplete
// 				multiSelect={multiSelect}
// 				allowDuplicates={allowDuplicates}
// 				options={newOptions}
// 				value={modPath}
// 				onChange={handleSelected}
// 				optionsOnly={optionsOnly}
// 			/>

// 			{color && <MyPopoverColor color={color} onChange={handleColorChange} onOpenChange={handleColorPickerOpenChange} />}

// 			<IconButton onClick={handleDelete}>
// 				<Trash2 strokeWidth={0.5} />
// 			</IconButton>
// 		</ListItem>
// 	);
// }
