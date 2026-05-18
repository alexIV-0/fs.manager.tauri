import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { handleValidation } from '../utils/handleValidation';

export const useValidation = () => {
	const reactFlow = useReactFlow();

	const isValidConnection = useCallback(
		(connection: any) => {
			const isValid = handleValidation(connection, reactFlow.getNodes(), reactFlow.getEdges());
			return isValid;
		},
		[reactFlow]
	);

	return isValidConnection;
};
