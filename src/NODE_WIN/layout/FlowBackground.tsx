import { Background, BackgroundVariant } from '@xyflow/react';
import { memo } from 'react';

function FlowBackground() {
	return <Background variant={BackgroundVariant.Dots} />;
}

export default memo(FlowBackground);
