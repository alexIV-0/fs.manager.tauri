import { useEdges, useReactFlow } from "@xyflow/react";
import { useEffect } from "react";

export const useEdgesData = () => {
	const reactFlow = useReactFlow();
	const edges = useEdges();

	useEffect(() => {}, [edges]);

	return {};
};
