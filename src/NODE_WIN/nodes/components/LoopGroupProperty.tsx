import { Property } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { Handle, Position, useEdges, useNodesData } from '@xyflow/react';
import { memo } from 'react';
import InputHandle from '../components/InputHandle';

interface LoopGroupPropertyProps {
	property: Property;
}

const INNER_H = 24; // высота внутреннего квадратного хэндлера

function LoopGroupProperty({ property }: LoopGroupPropertyProps) {
	const nodeId = useNodeContext();
	const edges = useEdges();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const defColor = colorTypes.default as string;
	const errColor = colorTypes.error as string;

	// computedOutput.inputInLoop / loopInput теперь синхронно считает каскад
	// (useCascadeValidation). Здесь только читаем готовый результат для покраски.
	const node = useNodesData(nodeId);
	const computedOutput = (node?.data?.computedOutput as Record<string, { value: any; type: string }> | null) ?? null;

	const hasInputEdge = edges.some((e) => e.target === nodeId && e.targetHandle === property.id);
	const hasOutputEdge = edges.some((e) => e.target === nodeId && e.targetHandle === 'outputInLoop');

	// Левая полоска (inputInLoop): тип из каскада; если связь есть, но тип ещё не
	// определился — error, без связи — default.
	const inType = computedOutput?.inputInLoop?.type;
	const leftColor = inType && colorTypes[inType] ? (colorTypes[inType] as string) : hasInputEdge ? errColor : defColor;

	// Правая полоска (outputInLoop → выход Loop): тип из каскада.
	const outType = computedOutput?.loopInput?.type;
	const rightColor = outType && colorTypes[outType] ? (colorTypes[outType] as string) : hasOutputEdge ? errColor : defColor;

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
