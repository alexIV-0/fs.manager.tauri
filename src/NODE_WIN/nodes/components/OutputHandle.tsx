import { CustomNode, CustomNodeData } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { resolveTypeByExtension } from '@/NODE_WIN/utils/resolveTypeByExtension';
import { Position, useEdges, useNodesData, useReactFlow } from '@xyflow/react';
import { memo, useEffect, useState } from 'react';
import CustomHandle from './CustomHandle';

function OutputHandle() {
	const nodeId = useNodeContext();
	const node = useNodesData(nodeId) as CustomNode;
	const edges = useEdges();
	const reactFlow = useReactFlow();
	const data = node.data as CustomNodeData;
	const outputProperty = node.data.properties.find((property) => property.id === node.data.output?.sourceProperty);

	// Раньше тут было голое useNodes() — широкая подписка, ре-рендерящая компонент
	// на любое изменение в любой ноде графа. На drag-tick это умножало работу
	// на количество OutputHandles в графе (~15+). Теперь подписываемся только
	// на ту source-ноду, чей computedOutput реально читаем в useEffect ниже.
	const incomingEdge = outputProperty
		? edges.find((e) => e.target === nodeId && e.targetHandle === outputProperty.id)
		: undefined;
	useNodesData(incomingEdge?.source ?? '');

	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const [label, setLabel] = useState<string>('');
	const [color, setColor] = useState('default');

	const isLoopNode = (data as any).executionType === 'loop';

	useEffect(() => {
		const resetHandle = () => {
			setLabel('');
			setColor('default');
		};

		if (!data.isValid) return resetHandle();

		// ── Loop нода ────────────────────────────────────────────────────
		if (isLoopNode) {
			const co = data.computedOutput as Record<string, { value: any; type: string }> | null;
			const loopOut = co?.['loopInput'];
			if (loopOut?.type) {
				setLabel(loopOut.type);
				setColor(loopOut.type);
			} else {
				resetHandle();
			}
			return;
		}

		// ── Стандартная логика ───────────────────────────────────────────
		if (!outputProperty) return resetHandle();

		// link + accepted — тип берём из source ноды через edge
		if (outputProperty.controlType === 'link' && outputProperty.outputType === 'accepted') {
			const incomingEdge = edges.find((e) => e.target === nodeId && e.targetHandle === outputProperty.id);
			if (incomingEdge) {
				const sourceNode = reactFlow.getNode(incomingEdge.source) as CustomNode;
				const computedOutput = sourceNode?.data?.computedOutput as Record<string, { value: any; type: string }> | null;
				const sourceOutput = computedOutput?.[incomingEdge.sourceHandle ?? ''];
				if (sourceOutput?.type) {
					setLabel(sourceOutput.type);
					setColor(sourceOutput.type);
					return;
				}
			}
			return resetHandle();
		}

		// link + фиксированный тип (например 'audio') — тип задан явно в outputType
		if (outputProperty.controlType === 'link' && outputProperty.outputType !== 'accepted') {
			setLabel(outputProperty.outputType);
			setColor(outputProperty.outputType);
			return;
		}

		// addLink / addPathLink
		if (outputProperty.controlType === 'addLink' || outputProperty.controlType === 'addPathLink') {
			const value = outputProperty.controlProps.value?.[0];
			if (value) {
				setLabel(value);
				setColor(value);
			} else {
				resetHandle();
			}
			return;
		}

		// autocomplete
		if (outputProperty.controlType === 'autocomplete') {
			if (outputProperty.outputType === 'array') {
				const value = outputProperty.controlProps.value[0];
				setLabel(value || '');
				setColor(value);
				return;
			}
			if (outputProperty.outputType === 'path') {
				setLabel(outputProperty.controlProps.label || '');
				setColor('path');
				return;
			}
			if (outputProperty.outputType === 'timecode') {
				setLabel(outputProperty.outputType || '');
				setColor('timecode');
				return;
			}
			if (outputProperty.outputType === 'typeByExtension') {
				if (!outputProperty.controlProps.value?.length) return resetHandle();
				const value = outputProperty.controlProps.value[0];
				if (!value) return resetHandle();
				const { label, color } = resolveTypeByExtension(value);
				setLabel(label);
				setColor(color);
				return;
			}
		}

		// textedit — тип задан явно в outputType (например 'string')
		if (outputProperty.controlType === 'textedit') {
			setLabel(outputProperty.outputType);
			setColor(outputProperty.outputType);
			return;
		}

		// checkbox + outputTypeMap — тип зависит от значения чекбокса
		if (outputProperty.controlType === 'checkbox' && outputProperty.outputTypeMap) {
			const mappedType = outputProperty.outputTypeMap[String(outputProperty.controlProps.value)];
			if (mappedType) {
				setLabel(mappedType);
				setColor(mappedType);
			} else {
				resetHandle();
			}
			return;
		}

		// keying — output type mirrors the connected input (same as link + accepted)
		if (outputProperty.controlType === 'keying') {
			if (outputProperty.outputType === 'accepted') {
				const incomingEdge = edges.find((e) => e.target === nodeId && e.targetHandle === outputProperty.id);
				if (incomingEdge) {
					const sourceNode = reactFlow.getNode(incomingEdge.source) as CustomNode;
					const computedOutput = sourceNode?.data?.computedOutput as Record<string, { value: any; type: string }> | null;
					const sourceOutput = computedOutput?.[incomingEdge.sourceHandle ?? ''];
					if (sourceOutput?.type) {
						setLabel(sourceOutput.type);
						setColor(sourceOutput.type);
						return;
					}
				}
			} else {
				setLabel(outputProperty.outputType);
				setColor(outputProperty.outputType);
				return;
			}
			return resetHandle();
		}

		// ddm
		if (outputProperty.controlType === 'ddm') {
			if (outputProperty.outputType === 'typeByExtension') {
				const raw = Array.isArray(outputProperty.controlProps.value)
					? (outputProperty.controlProps.value[0] ?? '')
					: (outputProperty.controlProps.value ?? '');
				if (!raw) return resetHandle();
				const { label, color } = resolveTypeByExtension(raw);
				setLabel(label);
				setColor(color);
				return;
			}
			// Фиксированный тип (string, path, boolean, etc.)
			if (outputProperty.outputType) {
				setLabel(outputProperty.outputType);
				setColor(outputProperty.outputType);
				return;
			}
		}

		// convertSettings — тип определяется по выбранному расширению финального файла
		if (outputProperty.controlType === 'convertSettings') {
			if (outputProperty.outputType === 'typeByExtension') {
				const raw = outputProperty.controlProps.value;
				if (!raw) return resetHandle();
				try {
					const s = JSON.parse(raw);
					const ext: string | undefined = s.outputExtension;
					if (!ext) return resetHandle();
					const { label, color } = resolveTypeByExtension(ext);
					setLabel(label);
					setColor(color);
				} catch {
					return resetHandle();
				}
				return;
			}
			// outputType задан явно (например 'video', 'audio')
			setLabel(outputProperty.outputType);
			setColor(outputProperty.outputType);
			return;
		}

		// pathNavigator
		if (outputProperty.controlType === 'pathNavigator' && outputProperty.outputType === 'typeByExtension') {
			const filePath = outputProperty.controlProps.value;
			if (!filePath) return resetHandle();
			const ext = filePath.match(/\.([^./\\]+)$/)?.[1] ?? '';
			if (!ext) return resetHandle();
			const { label, color } = resolveTypeByExtension(ext);
			setLabel(label);
			setColor(color);
			return;
		}

		resetHandle();
	}, [outputProperty, data.isValid, data.computedOutput, nodeId, node, data, edges, reactFlow, isLoopNode]);

	// Loop нода
	if (isLoopNode) {
		return (
			<div className='output-handler'>
				<span>{label}</span>
				<CustomHandle
					id='loopInput'
					type='source'
					position={Position.Right}
					style={{ backgroundColor: colorTypes[color] as string }}
					isConnectable={true}
				/>
			</div>
		);
	}

	return (
		outputProperty && (
			<div className='output-handler'>
				<span>{label}</span>
				<CustomHandle
					id={outputProperty.id}
					type='source'
					position={Position.Right}
					style={{ backgroundColor: colorTypes[color] as string }}
					isConnectable={true}
				/>
			</div>
		)
	);
}

export default memo(OutputHandle);
