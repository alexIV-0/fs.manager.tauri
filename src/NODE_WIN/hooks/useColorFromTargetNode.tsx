import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { CustomNode } from '@/NODE_WIN/definitions/types';
import { EdgeProps, useNodesData } from '@xyflow/react';

export const useColorFromTargetNode = (props: EdgeProps) => {
	const sourceNode = useNodesData(props.source) as CustomNode | null;
	const colorTypes = colorTypes_store((s) => s.colorTypes);

	if (!sourceNode?.data?.computedOutput) {
		return colorTypes['default'];
	}

	const computedOutput = sourceNode.data.computedOutput as Record<string, { value: any; type: string }>;
	const sourceProperty = computedOutput[props.sourceHandleId as string];

	if (!sourceProperty?.type) {
		return colorTypes['default'];
	}

	return colorTypes[sourceProperty.type] ?? colorTypes['default'];
};
