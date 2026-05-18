import type { Property } from '@/NODE_WIN/definitions/types';
import { NodeContextProvider } from '@/NODE_WIN/hooks/useNodeContext';
import { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { Comment, GenericProperty, NodeHeader, NodeResize, NodeShell, OutputHandle } from './components';
import './index.css';

function GenericNode(props: NodeProps) {
	const properties = props.data.properties as Property[];
	return (
		<NodeContextProvider nodeId={props.id}>
			<NodeShell nodeId={props.id} sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
				<NodeHeader />
				{properties.map((property) => {
					return <GenericProperty key={property.id} property={property} />;
				})}
				<Comment />
				<div className='nodrag output-handlers'>
					<OutputHandle />
				</div>
				<NodeResize />
			</NodeShell>
		</NodeContextProvider>
	);
}

export default memo(GenericNode);
