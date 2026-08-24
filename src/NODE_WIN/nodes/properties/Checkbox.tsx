import { CheckboxProperty, CustomNodeData, Property, isDynamicProperty } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useCascadeValidation } from '@/NODE_WIN/hooks/useCascadeValidation';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { Checkbox, Stack } from '@mui/material';
import { useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import { useState, useCallback } from 'react';
import InputHandle from '../components/InputHandle';
import PropertyLabelEditor from './PropertyLabelEditor';
import TooltipOrDelete from './TooltipOrDelete';

interface CheckboxPropertyProps {
	property: CheckboxProperty;
	onChange?: (e: React.ChangeEvent<HTMLInputElement>, checked: boolean) => void;
}

export default function CheckboxPropertyComponent({ property, onChange }: CheckboxPropertyProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const updateNodeInternals = useUpdateNodeInternals();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const { handleEdgeRemoval, handleNodePropertyChange } = useCascadeValidation();

	const { controlProps } = property;
	const initialValue = controlProps?.value ?? false;
	const [checked, setChecked] = useState<boolean>(Boolean(initialValue));

	const editLabel = (controlProps as any)?.editLabel ?? false;
	const tooltip = controlProps?.tooltip ?? '';
	const isDynamic = isDynamicProperty(property);

	// Сохраняем label в node data
	const handleSaveLabel = useCallback(
		(newLabel: string) => {
			reactFlow.updateNode(nodeId, (node) => {
				const nodeData = node.data as CustomNodeData;
				const updatedProperties = nodeData.properties.map((p) => {
					if (p.id !== property.id) return p;
					return { ...p, controlProps: { ...p.controlProps, label: newLabel } };
				});
				return { ...node, data: { ...nodeData, properties: updatedProperties } };
			});
		},
		[nodeId, property.id, reactFlow],
	);

	// Удаляем этот динамический компонент
	const handleDelete = useCallback(() => {
		const incomingEdges = reactFlow.getEdges().filter((e) => e.target === nodeId && e.targetHandle === property.id);

		if (incomingEdges.length > 0) {
			reactFlow.setEdges((eds) => eds.filter((e) => !(e.target === nodeId && e.targetHandle === property.id)));
		}

		reactFlow.updateNode(nodeId, (node) => {
			const nodeData = node.data as CustomNodeData;
			const updatedProperties = nodeData.properties.filter((p) => p.id !== property.id) as Property[];
			return { ...node, data: { ...nodeData, properties: updatedProperties } };
		});

		setTimeout(() => {
			incomingEdges.forEach((edge) => handleEdgeRemoval(edge));
			handleNodePropertyChange(nodeId);
			updateNodeInternals(nodeId);
		}, 0);
	}, [nodeId, property.id, reactFlow, handleEdgeRemoval, handleNodePropertyChange, updateNodeInternals]);

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>, newChecked: boolean) => {
		setChecked(newChecked);
		onChange?.(e, newChecked);
	};

	return (
		<Stack direction='row' alignItems='center' px='12px' className='nodrag' color={colorTypes.default as string}>
			{property.isInput && <InputHandle property={property} />}

			<PropertyLabelEditor label={controlProps?.label ?? ''} editLabel={editLabel} onSave={handleSaveLabel} />

			<Checkbox sx={{ ml: isDynamic ? 0 : 'auto' }} onChange={handleChange} checked={checked} />

			<TooltipOrDelete isDynamic={isDynamic} tooltip={tooltip} onDelete={handleDelete} property={property} />
		</Stack>
	);
}
