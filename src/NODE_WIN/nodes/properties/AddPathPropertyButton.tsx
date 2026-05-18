import { CustomNodeData, Property, JsonNavigatorProperty } from '@/NODE_WIN/definitions/types';
import { useCascadeValidation } from '@/NODE_WIN/hooks/useCascadeValidation';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import { IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material';
import { useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCallback, useState } from 'react';
import DDMonly from './DDMonly';

interface AddPathPropertyButtonProps {
	property: Property;
}

export default function AddPathPropertyButton({ property }: AddPathPropertyButtonProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const updateNodeInternals = useUpdateNodeInternals();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const fileTypes = typeOfFile_store((s) => s.patternStore);
	const { handleNodePropertyChange } = useCascadeValidation();
	const defColor = colorTypes.default as string;

	const addLinkProp = property.controlType === 'addPathLink' ? property : null;
	const label = (addLinkProp?.controlProps as any)?.label ?? '';

	// Текущий выбранный тип файла — будет добавлен как суффикс ":type" в jsonNavigator
	const selectedType: string[] = (addLinkProp?.controlProps as any)?.value ?? [fileTypes[0]?.name || 'video'];

	const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

	const handleOpenMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
		setMenuAnchor(e.currentTarget);
	}, []);

	const handleCloseMenu = useCallback(() => {
		setMenuAnchor(null);
	}, []);

	// Обновляем выбранный тип в controlProps кнопки
	const handleTypeChange = useCallback(
		(newType: string | string[]) => {
			const value = Array.isArray(newType) ? newType : [newType];
			reactFlow.updateNode(nodeId, (node) => {
				const nodeData = node.data as CustomNodeData;
				const updatedProperties = (nodeData.properties as Property[]).map((p) => {
					if (p.id !== property.id) return p;
					return { ...p, controlProps: { ...p.controlProps, value } };
				}) as Property[];
				return { ...node, data: { ...nodeData, properties: updatedProperties } };
			});
			// Откладываем каскадную валидацию — xyflow обрабатывает updateNode через очередь
			// (batchContext.nodeQueue), которая применяется в useIsomorphicLayoutEffect.
			// Синхронный вызов читал бы устаревшее состояние и перезаписывал только что
			// выбранный тип обратно на старый.
			setTimeout(() => handleNodePropertyChange(nodeId), 0);
		},
		[nodeId, property.id, reactFlow, handleNodePropertyChange],
	);

	// Находим id property в этой же ноде, которое содержит путь до json файла
	// Ищем первый pathNavigator или autocomplete/textedit со значением *.json
	const findJsonSourcePropertyId = useCallback((): string | undefined => {
		const node = reactFlow.getNode(nodeId);
		if (!node) return undefined;

		const props = (node.data as CustomNodeData).properties as Property[];

		// Сначала ищем pathNavigator
		const pathNav = props.find((p) => p.controlType === 'pathNavigator');
		if (pathNav) return pathNav.id;

		// Затем любой с .json значением
		for (const p of props) {
			if (p.id === property.id) continue;
			const val = (p.controlProps as any)?.value;
			const strVal = Array.isArray(val) ? val[0] : val;
			if (typeof strVal === 'string' && strVal.endsWith('.json')) return p.id;
		}

		return undefined;
	}, [nodeId, property.id, reactFlow]);

	// Считаем сколько jsonNavigator уже добавлено — для label
	const getJsonNavCount = useCallback((): number => {
		const node = reactFlow.getNode(nodeId);
		if (!node) return 0;
		return (node.data as CustomNodeData).properties.filter((p) => p.controlType === 'jsonNavigator').length;
	}, [nodeId, reactFlow]);

	// Добавляем новый jsonNavigator перед кнопкой
	const handleAdd = useCallback(() => {
		handleCloseMenu();

		const count = getJsonNavCount();
		const type = selectedType[0] || 'video';
		const jsonSourceId = findJsonSourcePropertyId();

		const newProperty: JsonNavigatorProperty = {
			id: `jsonNav_${nanoid(5)}`,
			controlType: 'jsonNavigator',
			controlProps: {
				label: `Path ${count + 1}`,
				tooltip: '',
				value: '',
				jsonSourcePropertyId: jsonSourceId,
				editLabel: true,
			},
			isInput: true,
			isOutput: false,
			acceptedTypes: ['all'],
			outputType: 'string',
			required: false,
		};

		reactFlow.updateNode(nodeId, (node) => {
			const nodeData = node.data as CustomNodeData;
			const addBtnIndex = (nodeData.properties as Property[]).findIndex((p) => p.id === property.id);
			const updatedProperties = [
				...(nodeData.properties as Property[]).slice(0, addBtnIndex),
				newProperty,
				...(nodeData.properties as Property[]).slice(addBtnIndex),
			];
			return { ...node, data: { ...nodeData, properties: updatedProperties } };
		});

		setTimeout(() => {
			updateNodeInternals(nodeId);
			handleNodePropertyChange(nodeId);
		}, 0);
	}, [
		handleCloseMenu,
		getJsonNavCount,
		selectedType,
		findJsonSourcePropertyId,
		nodeId,
		property.id,
		reactFlow,
		updateNodeInternals,
		handleNodePropertyChange,
	]);

	return (
		<Stack direction='column' px='12px' className='nodrag' gap={0.5}>
			{label && (
				<Typography variant='subtitle2' fontWeight={400} noWrap color={defColor} sx={{ cursor: 'default', opacity: 0.7 }}>
					{label}
				</Typography>
			)}

			<Stack direction='row' alignItems='center' gap={1}>
				{/* Кнопка + */}
				<IconButton
					size='small'
					onClick={handleAdd}
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

				{/* Тип результата */}
				<DDMonly
					items={fileTypes.map((ft) => ({ value: ft.name, color: ft.color ?? undefined }))}
					value={selectedType}
					onChange={handleTypeChange}
				/>
			</Stack>
		</Stack>
	);
}
