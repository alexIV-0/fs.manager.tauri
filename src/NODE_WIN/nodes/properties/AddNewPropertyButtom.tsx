import {
	AddNewProperty,
	AddableType,
	ALL_ADDABLE_TYPES,
	CustomNodeData,
	Property,
	CheckboxProperty,
	TextEditProperty,
	TimeCodeProperty,
	SliderProperty,
} from '@/NODE_WIN/definitions/types';
import { useCascadeValidation } from '@/NODE_WIN/hooks/useCascadeValidation';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import { IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material';
import { useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCallback, useState, useRef } from 'react';
import DDMonly from './DDMonly';
import MyToolTip from './CustomTooltip';

interface AddNewPropertyProps {
	property: Property;
}

export default function AddNewPropertyButton({ property }: AddNewPropertyProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const updateNodeInternals = useUpdateNodeInternals();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const fileTypes = typeOfFile_store((s) => s.patternStore);
	const { handleNodePropertyChange } = useCascadeValidation();

	const defColor = colorTypes.default as string;
	const tooltip = property.controlProps?.tooltip ?? '';

	const addLinkProp = property.controlType === 'addLink' ? (property as AddNewProperty) : null;
	const label = addLinkProp?.controlProps?.label ?? '';
	const selectedType = addLinkProp?.controlProps?.value ?? [fileTypes[0]?.name || 'video'];

	const rawAllowedTypes = addLinkProp?.controlProps?.allowedTypes;
	const activeTypes: AddableType[] =
		rawAllowedTypes && rawAllowedTypes.length > 0
			? ALL_ADDABLE_TYPES.filter((t) => rawAllowedTypes.includes(t))
			: ALL_ADDABLE_TYPES;

	const isOutputSource = useStore((s) => {
		const node = s.nodeLookup.get(nodeId);
		return (node?.data as CustomNodeData | undefined)?.output?.sourceProperty === property.id;
	});

	// ── Состояние меню ────────────────────────────────────────────────────────
	const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	const handleOpenMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
		setMenuAnchor(e.currentTarget);
	}, []);

	const handleCloseMenu = useCallback(() => {
		setMenuAnchor(null);
	}, []);

	// ── Счётчик для генерации label ───────────────────────────────────────────
	const getDynamicCount = useCallback(
		(controlType: string) => {
			const node = reactFlow.getNode(nodeId);
			if (!node) return 0;
			const nodeData = node.data as CustomNodeData;
			return nodeData.properties.filter((p) => p.controlType === controlType && (p.controlProps as any)?.editLabel === true)
				.length;
		},
		[nodeId, reactFlow],
	);

	// ── Обновляем selectedType ────────────────────────────────────────────────
	const handleTypeChange = useCallback(
		(newType: string | string[]) => {
			const value = Array.isArray(newType) ? newType : [newType];
			reactFlow.updateNode(nodeId, (node) => {
				const nodeData = node.data as CustomNodeData;
				const updatedProperties = nodeData.properties.map((p) => {
					if (p.id !== property.id) return p;
					return { ...p, controlProps: { ...p.controlProps, value } };
				}) as Property[];
				return { ...node, data: { ...nodeData, properties: updatedProperties } };
			});
			// Пересчитать computedOutput этой ноды и протолкнуть новый тип вниз по цепочке.
			// Без этого смена типа в выпадашке меняла только controlProps.value, а
			// исходящий коннектор (и downstream-ноды) оставались со старым/пустым типом.
			// ВАЖНО: через setTimeout(0), как handleAdd ниже. Синхронный вызов читает
			// узел из стора ДО того как updateNode выше «осел», ловит старое value и
			// откатывает выпадашку назад (баг «что ни выбери — всегда старый тип»).
			setTimeout(() => handleNodePropertyChange(nodeId), 0);
		},
		[nodeId, property.id, reactFlow, handleNodePropertyChange],
	);

	// ── Фабрика новых свойств ─────────────────────────────────────────────────
	const createNewProperty = useCallback(
		(type: AddableType): Property => {
			const count = getDynamicCount(type.toLowerCase());
			const baseLabel = `New ${type} ${count + 1}`;

			switch (type) {
				case 'Link':
					return {
						id: `dynLink_${nanoid(5)}`,
						controlType: 'link',
						controlProps: {
							label: baseLabel,
							tooltip: '',
							value: '',
							editLabel: true,
						},
						isInput: true,
						isOutput: false,
						acceptedTypes: ['all'],
						isDynamic: true,
						outputType: 'accepted',
						required: true,
					} satisfies Property;

				case 'TextEdit':
					return {
						id: `dynTextEdit_${nanoid(5)}`,
						controlType: 'textedit',
						controlProps: {
							label: baseLabel,
							tooltip: '',
							value: '',
							language: 'plaintext',
							editLabel: true,
						},
						isInput: false,
						isOutput: false,
						acceptedTypes: [],
						isDynamic: true,
						outputType: 'string',
						required: false,
					} satisfies Property;

				case 'Timecode':
					return {
						id: `dynTimecode_${nanoid(5)}`,
						controlType: 'timecode',
						controlProps: {
							label: baseLabel,
							tooltip: '',
							value: 0,
							editLabel: true,
						},
						isInput: true,
						isOutput: false,
						acceptedTypes: ['timecode'],
						isDynamic: true,
						outputType: 'timecode',
						required: false,
					} satisfies Property;

				case 'Slider':
					return {
						id: `dynSlider_${nanoid(5)}`,
						controlType: 'slider',
						controlProps: {
							label: baseLabel,
							tooltip: '',
							value: 0,
							minValue: 0,
							maxValue: 100,
							step: 1,
							useValuesAsLabels: true,
							minMaxValueVisible: true,
							initValue: 0,
							editLabel: true,
						},
						isInput: false,
						isOutput: false,
						acceptedTypes: [],
						isDynamic: true,
						outputType: 'string',
						required: false,
					} satisfies Property;

				case 'Checkbox':
					return {
						id: `dynCheckbox_${nanoid(5)}`,
						controlType: 'checkbox',
						controlProps: {
							label: baseLabel,
							tooltip: '',
							value: false,
							editLabel: true,
						},
						isInput: false,
						isOutput: false,
						acceptedTypes: [],
						isDynamic: true,
						outputType: 'boolean',
						required: false,
					} satisfies Property;

				// Диапазон-таймкод: HH:MM:SS, 0..00:10:00. Слайдер хранит секунды → на выходе [секунды, секунды].
				case 'TimeRange':
					return {
						id: `dynValueRange_${nanoid(5)}`,
						controlType: 'valueRange',
						controlProps: {
							label: baseLabel,
							tooltip: '',
							value: [0, 600],
							format: 'timecode',
							range: [0, 600],
							step: 5,
							allowManualOverride: true,
							editLabel: true,
						},
						isInput: false,
						isOutput: false,
						acceptedTypes: [],
						isDynamic: true,
						outputType: 'timecode',
						required: false,
					} satisfies Property;

				// Диапазон-число: целые 0..10. На выходе [число, число].
				case 'NumberRange':
					return {
						id: `dynValueRange_${nanoid(5)}`,
						controlType: 'valueRange',
						controlProps: {
							label: baseLabel,
							tooltip: '',
							value: [0, 10],
							format: 'integer',
							range: [0, 10],
							step: 1,
							allowManualOverride: true,
							editLabel: true,
						},
						isInput: false,
						isOutput: false,
						acceptedTypes: [],
						isDynamic: true,
						outputType: 'string',
						required: false,
					} satisfies Property;
			}
		},
		[getDynamicCount],
	);

	// ── Добавляем новое свойство перед addLink ────────────────────────────────
	const handleAdd = useCallback(
		(type: AddableType) => {
			handleCloseMenu();

			const newProperty = createNewProperty(type);

			reactFlow.updateNode(nodeId, (node) => {
				const nodeData = node.data as CustomNodeData;
				const addLinkIndex = nodeData.properties.findIndex((p) => p.id === property.id);
				const updatedProperties = [
					...nodeData.properties.slice(0, addLinkIndex),
					newProperty,
					...nodeData.properties.slice(addLinkIndex),
				] as Property[];
				return { ...node, data: { ...nodeData, properties: updatedProperties } };
			});

			setTimeout(() => {
				updateNodeInternals(nodeId);
				handleNodePropertyChange(nodeId);
			}, 0);
		},
		[createNewProperty, handleCloseMenu, nodeId, property.id, reactFlow, updateNodeInternals, handleNodePropertyChange],
	);

	const handleButtonClick = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			if (activeTypes.length === 1) {
				handleAdd(activeTypes[0]);
			} else {
				handleOpenMenu(e);
			}
		},
		[activeTypes, handleAdd, handleOpenMenu],
	);

	return (
		<Stack direction='column' px='12px' className='nodrag' gap={0.5}>
			<Stack direction='row' alignItems='center' position='relative' gap={1}>
				{/* Нередактируемый label */}
				{label && (
					<Typography
						variant='subtitle2'
						fontWeight={400}
						noWrap
						color={defColor}
						sx={{ cursor: 'default', opacity: 0.7 }}
					>
						{label}
					</Typography>
				)}
				<MyToolTip tooltip={tooltip} ml='auto' />
			</Stack>

			{/* Строка с кнопкой + и выпадашкой типов файлов */}
			<Stack direction='row' alignItems='center' gap={1}>
				{/* Кнопка + открывает меню выбора типа */}
				<IconButton
					ref={buttonRef}
					size='small'
					onClick={handleButtonClick}
					className='nodrag'
					sx={{
						width: 22,
						height: 22,
						border: `1px solid ${defColor}`,
						borderRadius: '4px',
						padding: 0,
						color: defColor,
						'&:hover': {
							backgroundColor: 'rgba(255,255,255,0.08)',
							borderColor: '#fff',
							color: '#fff',
						},
					}}
				>
					<Plus size={14} />
				</IconButton>

				{/* Выпадающий список типов файлов — только если это output source */}
				{isOutputSource && (
					<DDMonly
						items={fileTypes.map((ft) => ({ value: ft.name, color: ft.color ?? undefined }))}
						value={selectedType}
						onChange={handleTypeChange}
					/>
				)}
			</Stack>

			{/* Меню выбора типа добавляемого свойства */}
			<Menu
				anchorEl={menuAnchor}
				open={Boolean(menuAnchor)}
				onClose={handleCloseMenu}
				className='nodrag'
				slotProps={{
					paper: {
						sx: {
							backgroundColor: colorTypes.bg as string,
							border: `1px solid rgba(255,255,255,0.1)`,
							borderRadius: '6px',
							minWidth: 130,
							boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
						},
					},
				}}
			>
				{activeTypes.map((type) => (
					<MenuItem
						key={type}
						onClick={() => handleAdd(type)}
						dense
						sx={{
							fontSize: 13,
							color: defColor,
							'&:hover': { backgroundColor: 'rgba(255,255,255,0.07)' },
						}}
					>
						{type}
					</MenuItem>
				))}
			</Menu>
		</Stack>
	);
}
