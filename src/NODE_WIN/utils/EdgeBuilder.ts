import { Connection, Edge } from "@xyflow/react";
import { nanoid } from "nanoid";

export const buildEdge = (edgeOptions: Connection): Edge => {
	return {
		...edgeOptions,
		id: nanoid(5),
		data: {
			handleName: edgeOptions.sourceHandle,
			source: edgeOptions.source
		}
	};
};
