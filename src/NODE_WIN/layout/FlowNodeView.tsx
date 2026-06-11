import { edgeTypes, getNodeTypes } from '@/NODE_WIN/hooks/useFlowTypes';
import { ReactFlow, SelectionMode } from '@xyflow/react';
import { useConnection, useDragAndDrop, useFlowActions } from '../hooks';
import FlowBackground from './FlowBackground';

import { useMemo } from 'react';
import { greyColor, steelColor } from '@/Store/Color/grayColor';
import { useQuickAdd } from '../hooks/useQuickAdd';
import { useCopyPaste } from '../hooks/useCopyPaste';
import QuickAddModal from './QuickAddModal';
// import { getAllNodes } from '@/NODE_WIN/definitions';

export default function NodeView() {
	const { nodes, edges, onNodesChange, onEdgesChange, onNodeDragStop, onBeforeDelete, onInit } = useFlowActions();
	const { onDragOver, onDrop } = useDragAndDrop();
	const { validateConnection, onConnect } = useConnection();
	const { open, modalPos, addNodeToCanvas, close } = useQuickAdd();

	// Ctrl+C / Ctrl+V для нод (с учётом вставки внутрь Loop).
	useCopyPaste();

	// ✅ ВЫЗЫВАЕМ ПОСЛЕ ТОГО, КАК КОМПОНЕНТ ОТРЕНДЕРИЛСЯ (А ЗНАЧИТ НОДЫ УЖЕ ЗАГРУЖЕНЫ)
	const nodeTypes = useMemo(() => getNodeTypes(), []);

	return (
		<>
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes} // теперь безопасно
				edgeTypes={edgeTypes}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onNodeDragStop={onNodeDragStop}
				onBeforeDelete={onBeforeDelete}
				onDragOver={onDragOver}
				onDrop={onDrop}
				selectionMode={SelectionMode.Partial}
				selectionOnDrag={true}
				panOnDrag={[1]}
				deleteKeyCode={'Delete'}
				onConnect={onConnect}
				isValidConnection={validateConnection}
				onInit={onInit}
				onlyRenderVisibleElements
				proOptions={{ hideAttribution: true }}
				// onClick={() => {

				// }}
				// style={{
				// 	backgroundColor: greyColor(17),
				// }}
				minZoom={0.1}
				maxZoom={3}
			>
				<FlowBackground />
			</ReactFlow>
			<QuickAddModal open={open} position={modalPos} onClose={close} onAddNode={addNodeToCanvas} />
		</>
	);
}
