import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { useReactFlow, type Edge, type Node, type XYPosition } from '@xyflow/react';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef } from 'react';
import { findLoopAtPoint, getAbsolutePosition, sortLoopsFirst } from '../utils/loopGrouping';
import { useCascadeValidation } from './useCascadeValidation';

// Внутреннее представление буфера. _abs — абсолютная позиция ноды на момент копирования
// (нужна, чтобы корректно восстановить раскладку, в т.ч. для детей Loop).
type ClipNode = Node & { _abs: XYPosition };
type Clip = { nodes: ClipNode[]; edges: Edge[] };

/**
 * Ctrl+C / Ctrl+V для нод флоу.
 *  • Копируются только выделенные ноды (singleton / required / неудаляемые — пропускаются).
 *  • Дети выделенной Loop-ноды копируются вместе с ней.
 *  • Связи копируются, если оба конца попали в выделение.
 *  • Вставка — в точку под курсором. Если точка внутри Loop — ноды становятся его детьми.
 *  • Всем нодам и связям выдаются новые id; parentId перемаппливается.
 */
export function useCopyPaste() {
	const reactFlow = useReactFlow();
	const { cascadeValidation } = useCascadeValidation();

	const clipboard = useRef<Clip | null>(null);
	const mouse = useRef<XYPosition>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			mouse.current = { x: e.clientX, y: e.clientY };
		};
		window.addEventListener('mousemove', onMove);
		return () => window.removeEventListener('mousemove', onMove);
	}, []);

	const copy = useCallback(() => {
		const all = reactFlow.getNodes();

		const selected = all.filter(
			(n) =>
				n.selected &&
				(n.data as any)?.required !== true &&
				(n.data as any)?.isUnique !== true &&
				n.deletable !== false,
		);
		if (selected.length === 0) return;

		const ids = new Set(selected.map((n) => n.id));
		// Дети выделенных Loop-нод копируются вместе с ними, даже если не выделены явно.
		for (const n of selected) {
			if ((n.data as any)?.executionType === 'loop') {
				for (const c of all) if ((c as any).parentId === n.id) ids.add(c.id);
			}
		}

		const nodes: ClipNode[] = all
			.filter((n) => ids.has(n.id))
			.map((n) => {
				const abs = getAbsolutePosition(reactFlow, n.id) ?? n.position;
				return { ...(JSON.parse(JSON.stringify(n)) as Node), _abs: { x: abs.x, y: abs.y } };
			});

		const edges: Edge[] = reactFlow
			.getEdges()
			.filter((e) => ids.has(e.source) && ids.has(e.target))
			.map((e) => JSON.parse(JSON.stringify(e)) as Edge);

		clipboard.current = { nodes, edges };
	}, [reactFlow]);

	const paste = useCallback(() => {
		const clip = clipboard.current;
		if (!clip || clip.nodes.length === 0) return;

		const copiedIds = new Set(clip.nodes.map((n) => n.id));
		const idMap = new Map<string, string>();
		clip.nodes.forEach((n) => idMap.set(n.id, nanoid(5)));

		// Точка вставки — под курсором (flow-координаты).
		const anchor = reactFlow.screenToFlowPosition(mouse.current);

		// top-level = ноды без скопированного родителя; по ним считаем origin/offset.
		const topLevel = clip.nodes.filter((n) => !(n as any).parentId || !copiedIds.has((n as any).parentId));
		const minX = Math.min(...topLevel.map((n) => n._abs.x));
		const minY = Math.min(...topLevel.map((n) => n._abs.y));
		const offset = { x: anchor.x - minX, y: anchor.y - minY };

		// Если точка вставки внутри Loop — top-level ноды становятся его детьми.
		const intoLoop = findLoopAtPoint(reactFlow, anchor);
		const loopAbs = intoLoop ? getAbsolutePosition(reactFlow, intoLoop.id) : null;

		const newNodes: Node[] = clip.nodes.map((src) => {
			const { _abs, ...rest } = src;
			const newId = idMap.get(src.id)!;
			const srcParent = (src as any).parentId as string | undefined;
			const parentCopied = !!srcParent && copiedIds.has(srcParent);

			let parentId: string | undefined;
			let position: XYPosition;

			if (parentCopied) {
				parentId = idMap.get(srcParent!);
				position = { x: src.position.x, y: src.position.y }; // относительная — сохраняем как есть
			} else {
				const absPasted = { x: _abs.x + offset.x, y: _abs.y + offset.y };
				if (intoLoop && loopAbs) {
					parentId = intoLoop.id;
					position = { x: absPasted.x - loopAbs.x, y: absPasted.y - loopAbs.y };
				} else {
					parentId = undefined;
					position = absPasted;
				}
			}

			const data = JSON.parse(JSON.stringify(src.data));
			const node: Node = {
				...rest,
				id: newId,
				position,
				selected: true,
				data: { ...data, id: newId },
			};
			// extent не переносим — иначе ноду нельзя будет вытащить из Loop позже.
			delete (node as any).extent;
			if (parentId) (node as any).parentId = parentId;
			else delete (node as any).parentId;
			return node;
		});

		const newEdges: Edge[] = clip.edges.map((e) => ({
			...e,
			id: `e-${nanoid(8)}`,
			source: idMap.get(e.source)!,
			target: idMap.get(e.target)!,
			selected: false,
			data: { ...(e.data as any), active: true },
		}));

		reactFlow.setNodes((nodes) => sortLoopsFirst([...nodes.map((n) => ({ ...n, selected: false })), ...newNodes]));
		reactFlow.setEdges((edges) => [...edges, ...newEdges]);

		// Пересчитываем валидность вставленных нод: внешние (нескопированные) источники
		// отвалились, внутренние связи сохранены — каскад приведёт inheritedValue в порядок.
		setTimeout(() => {
			newNodes.forEach((n) => cascadeValidation(n.id));
		}, 0);
	}, [reactFlow, cascadeValidation]);

	useKeyboardShortcut({ key: 'c', modifiers: { ctrlOrMeta: true }, callback: copy });
	useKeyboardShortcut({ key: 'v', modifiers: { ctrlOrMeta: true }, callback: paste });
}
