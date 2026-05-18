import { Handle, HandleProps } from "@xyflow/react";
import { memo } from "react";

interface CustomHandleProps extends HandleProps {}

function CustomHandle(props: CustomHandleProps) {
	return <Handle {...props} />;
}

export default memo(CustomHandle);
