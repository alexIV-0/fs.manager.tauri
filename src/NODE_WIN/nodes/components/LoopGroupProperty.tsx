import { Property, CustomNode } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { Handle, Position, useEdges, useReactFlow } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import InputHandle from '../components/InputHandle';
import { useCascadeValidation } from '@/NODE_WIN/hooks/useCascadeValidation';

interface LoopGroupPropertyProps {
	property: Property;
}

const BORDER_W = 28; // ширина полоски границы
const BORDER_H = 60; // высота полоски — охватывает оба хэндлера
const INNER_H = 24; // высота внутреннего квадратного хэндлера
const OUTER_D = 16; // диаметр внешнего круглого хэндлера (из InputHandle)

// Внешний хэндлер — в центре полоски по вертикали
// Внутренний — на 24px ниже внешнего
const OUTER_TOP = BORDER_H / 2 - INNER_H;
const INNER_TOP = BORDER_H / 2 + 8;

function LoopGroupProperty({ property }: LoopGroupPropertyProps) {
	const nodeId = useNodeContext();
	const edges = useEdges();
	const reactFlow = useReactFlow();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const defColor = colorTypes.default as string;

	// ── Цвет левой полоски = тип loopInput ──────────────────────────
	const [leftColor, setLeftColor] = useState<string>(defColor);

	useEffect(() => {
		const edge = edges.find((e) => e.target === nodeId && e.targetHandle === property.id);

		if (!edge) {
			setLeftColor(defColor);
			reactFlow.updateNode(nodeId, (n) => ({
				...n,
				data: {
					...n.data,
					computedOutput: {
						...((n.data.computedOutput as object) ?? {}),
						inputInLoop: { value: null, type: '' },
					},
				},
			}));
			return;
		}

		const sourceNode = reactFlow.getNode(edge.source) as CustomNode;
		if (!sourceNode?.data?.isValid) {
			setLeftColor(colorTypes.error as string);
			return;
		}

		const computedOutput = sourceNode.data.computedOutput as Record<string, { value: any; type: string }> | null;
		const sourceOutput = computedOutput?.[edge.sourceHandle as string];

		if (sourceOutput?.type) {
			const color = (colorTypes[sourceOutput.type] as string) ?? defColor;
			setLeftColor(color);
			// Пробрасываем тип — edges от inputInLoop окрашиваются
			reactFlow.updateNode(nodeId, (n) => ({
				...n,
				data: {
					...n.data,
					computedOutput: {
						...((n.data.computedOutput as object) ?? {}),
						inputInLoop: { value: null, type: sourceOutput.type },
					},
				},
			}));
		} else {
			setLeftColor(defColor);
		}
	}, [edges, nodeId, property.id, reactFlow, colorTypes, defColor]);

	// ── Цвет правой полоски = тип outputInLoop ──────────────────────
	const [rightColor, setRightColor] = useState<string>(defColor);

	// В LoopGroupProperty замени useEffect правой полоски на:

	useEffect(() => {
		const outEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'outputInLoop');
		if (!outEdge) {
			setRightColor(defColor);
			// Сбрасываем computedOutput для выходного хэндлера Loop ноды
			reactFlow.updateNode(nodeId, (n) => ({
				...n,
				data: {
					...n.data,
					computedOutput: {
						...((n.data.computedOutput as object) ?? {}),
						loopInput: { value: null, type: '' },
					},
				},
			}));
			return;
		}
		const src = reactFlow.getNode(outEdge.source) as CustomNode;
		const co = src?.data?.computedOutput as Record<string, { value: any; type: string }> | null;
		const t = co?.[outEdge.sourceHandle ?? '']?.type;
		const color = t && colorTypes[t] ? (colorTypes[t] as string) : defColor;
		setRightColor(color);

		// Записываем тип в computedOutput['loopInput'] — это sourceProperty Loop ноды
		// OutputHandle Loop ноды читает именно этот ключ
		if (t) {
			reactFlow.updateNode(nodeId, (n) => ({
				...n,
				data: {
					...n.data,
					computedOutput: {
						...((n.data.computedOutput as object) ?? {}),
						loopInput: { value: null, type: t },
					},
				},
			}));
		}
	}, [edges, nodeId, reactFlow, colorTypes, defColor]);

	const { cascadeValidation } = useCascadeValidation();
	const prevIsValid = useRef<boolean | null>(null);

	useEffect(() => {
		const hasInput = !!edges.find((e) => e.target === nodeId && e.targetHandle === property.id);
		const hasOutput = !!edges.find((e) => e.target === nodeId && e.targetHandle === 'outputInLoop');
		const isValid = hasInput && hasOutput;

		// Обновляем ноду только если isValid изменился
		if (prevIsValid.current === isValid) return;
		prevIsValid.current = isValid;

		reactFlow.updateNode(nodeId, (n) => ({
			...n,
			data: { ...n.data, isValid },
		}));

		// Каскадная валидация внешних нод — после применения updateNode
		setTimeout(() => {
			cascadeValidation(nodeId);
		}, 0);
	}, [edges, nodeId, property.id, reactFlow, cascadeValidation]);

	return (
		<div
			style={{
				flexGrow: 1,
				flexShrink: 1,
				margin: '0 -1px',
				position: 'relative',
				overflow: 'visible',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				minHeight: 60,
				backgroundColor: 'transparent',
				// Без border — рисуем полоски через абсолютные div
			}}
		>
			{/* loopInput: внешний круглый target */}
			<div
				style={{
					position: 'absolute',
					left: 1,
					top: '50%',
					transform: `translateY(calc(-50% - ${16}px))`,
					zIndex: 11,
				}}
			>
				<InputHandle property={property} />
			</div>

			{/* inputInLoop: внутренний квадратный source, на 24px ниже внешнего */}
			<Handle
				id='inputInLoop'
				type='source'
				position={Position.Right}
				style={{
					position: 'absolute',
					// left: BORDER_W / 2 - INNER_H / 2,
					left: 5,
					right: 'auto',
					top: `calc(50% + ${6}px)`,
					transform: `translateY(calc(-50% + ${6}px))`,
					width: INNER_H,
					height: INNER_H,
					borderRadius: 3,
					backgroundColor: leftColor,
					border: '2px solid #111',
					zIndex: 10,
					transition: 'background-color 0.3s ease',
				}}
			/>

			{/* outputInLoop: внутренний квадратный target, вверху правой полоски */}
			<Handle
				id='outputInLoop'
				type='target'
				position={Position.Left}
				style={{
					position: 'absolute',
					right: 6,
					left: 'auto',
					bottom: 55,
					top: 'auto',
					transform: 'none',
					width: INNER_H,
					height: INNER_H,
					borderRadius: 3,
					backgroundColor: rightColor,
					border: '2px solid #111',
					zIndex: 10,
					transition: 'background-color 0.3s ease',
				}}
			/>
		</div>
	);
}

export default memo(LoopGroupProperty);
