import { useCallback, useEffect, useRef, useState } from 'react';
import { Node, useReactFlow } from '@xyflow/react';
import { nanoid } from 'nanoid';
import { getNodeDefinitions } from '../definitions';
import { Property } from '../definitions/types';
import { isValueValid } from '../utils/validation';
import { getPropertyValueAndType } from '../utils/getPropertyData';
import { useNodeQuickAdd_store } from '@/Store/Node/useNodeQuickAdd_store';

const MODAL_W = 280;
const MODAL_H = 260;

function findParentLoopNode(nodes: Node[], position: { x: number; y: number }): Node | undefined {
	return nodes.find((node) => {
		if ((node.data as any)?.executionType !== 'loop') return false;
		const nodeX = node.position.x;
		const nodeY = node.position.y;
		const nodeW = node.measured?.width ?? (node as any).width ?? 600;
		const nodeH = node.measured?.height ?? (node as any).height ?? 400;
		return position.x >= nodeX && position.x <= nodeX + nodeW && position.y >= nodeY && position.y <= nodeY + nodeH;
	});
}

export function useQuickAdd() {
	const reactFlow = useReactFlow();
	const addUsed = useNodeQuickAdd_store((s) => s.addUsed);

	const [open, setOpen] = useState(false);
	const [modalPos, setModalPos] = useState({ x: 0, y: 0 });
	const mouseScreenPosRef = useRef({ x: 0, y: 0 });
	const capturedScreenPosRef = useRef({ x: 0, y: 0 });

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			mouseScreenPosRef.current = { x: e.clientX, y: e.clientY };
		};
		window.addEventListener('mousemove', onMouseMove);
		return () => window.removeEventListener('mousemove', onMouseMove);
	}, []);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Tab') return;
			if (open) {
				e.preventDefault();
				return;
			}
			const target = e.target as HTMLElement;
			const tag = target.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;

			e.preventDefault();

			const screenPos = mouseScreenPosRef.current;
			capturedScreenPosRef.current = { ...screenPos };

			const { innerWidth, innerHeight } = window;
			let x = screenPos.x - MODAL_W / 2;
			let y = screenPos.y;
			if (x + MODAL_W > innerWidth) x = innerWidth - MODAL_W - 10;
			if (x < 0) x = 10;
			if (y + MODAL_H > innerHeight) y = screenPos.y - MODAL_H;
			if (y < 0) y = 0;

			setModalPos({ x, y });
			setOpen(true);
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open]);

	const addNodeToCanvas = useCallback(
		(nodeType: string) => {
			const nodeReference = getNodeDefinitions().find((node) => node.type === nodeType);
			if (!nodeReference) return;

			const nodeWidth = typeof nodeReference.width === 'number' ? nodeReference.width : 0;
			const screenPos = capturedScreenPosRef.current;

			const cursorFlowPos = reactFlow.screenToFlowPosition(screenPos);
			const flowPosition = {
				x: cursorFlowPos.x - nodeWidth / 2,
				y: cursorFlowPos.y - 18,
			};

			const allNodes = reactFlow.getNodes();
			const parentLoopNode = findParentLoopNode(allNodes, flowPosition);

			const newId = nanoid(5);
			const isValid = (nodeReference.data.properties as Property[]).filter((p) => p.required).every(isValueValid);

			let computedOutput = null;
			if (isValid) {
				const outputPropertyId = (nodeReference.data as any).output?.sourceProperty;
				if (outputPropertyId) {
					const outputProperty = (nodeReference.data.properties as Property[]).find((p) => p.id === outputPropertyId);
					if (outputProperty) {
						const { value, type } = getPropertyValueAndType(outputProperty);
						computedOutput = { [outputPropertyId]: { value, type } };
					}
				}
			}

			let position = flowPosition;
			let parentId: string | undefined;

			if (parentLoopNode) {
				position = {
					x: flowPosition.x - parentLoopNode.position.x,
					y: flowPosition.y - parentLoopNode.position.y,
				};
				parentId = parentLoopNode.id;
			}

			const newNode: Node = {
				...nodeReference,
				position,
				id: newId,
				...(parentId ? { parentId, extent: 'parent' } : {}),
				data: {
					...nodeReference.data,
					id: newId,
					isValid,
					computedOutput,
					disabled: false,
					pluginId: (nodeReference as any).pluginId,
					pluginVersion: (nodeReference as any).pluginVersion,
				},
			};

			reactFlow.setNodes((nodes) => [...nodes, newNode]);

			addUsed({
				type: nodeType,
				label: (nodeReference.data as any).label ?? nodeType,
			});

			setOpen(false);
		},
		[reactFlow, addUsed],
	);

	const close = useCallback(() => setOpen(false), []);

	return { open, modalPos, addNodeToCanvas, close };
}
