import { createContext, useContext } from "react";

interface NodeContextProps {
	nodeId: string;
	children: React.ReactNode;
}

const NodeContext = createContext<string>("");

export const NodeContextProvider = ({ nodeId, children }: NodeContextProps) => {
	return <NodeContext.Provider value={nodeId}>{children}</NodeContext.Provider>;
};

export const useNodeContext = () => {
	const nodeId = useContext(NodeContext);
	if (!nodeId) throw new Error("useNodeContext must be used within NodeContextProvider");
	return nodeId;
};
