import { usePathStore } from '@/Store/Node/usePathStore';
import { useSavedState } from '@/Store/Node/useSavedState';
import { Button } from '@mui/material';
import { useEdges, useNodes, useReactFlow, type Edge, type Node } from '@xyflow/react';
import { Save } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';

type DirtyKind = 'saved' | 'layout' | 'structural';

// Подпись «структурной» части флоу: всё, что не относится к расположению нод и состоянию viewport.
function structSig(nodes: Node[], edges: Edge[]): string {
	const sortedNodes = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const sortedEdges = [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return JSON.stringify({
		n: sortedNodes.map((n) => ({
			i: n.id,
			t: n.type,
			p: (n as any).parentId,
			d: n.data,
		})),
		e: sortedEdges.map((e) => ({
			i: e.id,
			s: e.source,
			t: e.target,
			sh: e.sourceHandle,
			th: e.targetHandle,
			ty: e.type,
			d: e.data,
		})),
	});
}

// Подпись «layout»-части: только положение и размеры нод.
function layoutSig(nodes: Node[]): string {
	const sorted = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return JSON.stringify(
		sorted.map((n) => ({
			i: n.id,
			x: n.position?.x,
			y: n.position?.y,
			w: (n as any).width ?? (n.style as any)?.width,
			h: (n as any).height ?? (n.style as any)?.height,
		})),
	);
}

function SaveButton() {
	const reactFlow = useReactFlow();
	const { path } = usePathStore();
	const { savedState } = useSavedState();
	const [isSaving, setIsSaving] = useState(false);
	const isMountedRef = useRef(true);
	const buttonRef = useRef<HTMLButtonElement>(null);

	// Подписки на ноды/эджи — viewport (pan/zoom) сюда не входит.
	const liveNodes = useNodes();
	const liveEdges = useEdges();

	// Подпись последнего сохранённого/загруженного состояния.
	const [savedSig, setSavedSig] = useState<{ struct: string; layout: string } | null>(null);

	useEffect(() => {
		if (!savedState) {
			setSavedSig(null);
			return;
		}
		setSavedSig({
			struct: structSig(savedState.nodes ?? [], savedState.edges ?? []),
			layout: layoutSig(savedState.nodes ?? []),
		});
	}, [savedState]);

	// Раньше тут был useMemo, который на каждый ре-рендер делал 2× JSON.stringify
	// от всех нод/эджей. При drag-нодах это давало ~12 МБ/сек мусора и ~1Hz GC-стуттер.
	// Теперь — отложенный пересчёт через 300мс после последнего изменения.
	// Цвет кнопки не realtime-критичен; пользователю достаточно увидеть индикатор «dirty»
	// через долю секунды после остановки.
	const [dirty, setDirty] = useState<DirtyKind>('saved');

	useEffect(() => {
		if (!savedSig) {
			setDirty('saved');
			return;
		}
		const handle = window.setTimeout(() => {
			if (structSig(liveNodes, liveEdges) !== savedSig.struct) setDirty('structural');
			else if (layoutSig(liveNodes) !== savedSig.layout) setDirty('layout');
			else setDirty('saved');
		}, 300);
		return () => window.clearTimeout(handle);
	}, [liveNodes, liveEdges, savedSig]);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	const handleSaveFlow = useCallback(async () => {
		setIsSaving(true);
		const flow = reactFlow.toObject();
		await window.electronAPI.invoke('saveFlowToOptionsFolder', path, flow);
		setSavedSig({
			struct: structSig(flow.nodes, flow.edges),
			layout: layoutSig(flow.nodes),
		});
		if (isMountedRef.current) setIsSaving(false);
	}, [path, reactFlow]);

	useKeyboardShortcut({
		key: 's',
		eventType: 'keyup',
		target: 'document',
		skipOnInput: false,
		modifiers: { ctrlOrMeta: true },
		callback: () => buttonRef.current?.click(),
	});

	const dirtySx = useMemo(() => {
		switch (dirty) {
			case 'structural':
				return {
					backgroundColor: '#74dd78',
					color: '#1b3a1b',
					'&:hover': { backgroundColor: '#4cda4e' },
				};
			case 'layout':
				return {
					backgroundColor: '#f5e09e',
					color: '#3d2f00',
					'&:hover': { backgroundColor: '#e8d178' },
				};
			default:
				return {};
		}
	}, [dirty]);

	return (
		<Button
			ref={buttonRef}
			variant='contained'
			onClick={handleSaveFlow}
			startIcon={<Save strokeWidth={2} />}
			sx={{ position: 'absolute', bottom: '1rem', left: '1rem', borderRadius: 2, ...dirtySx }}
			disabled={isSaving}
			loading={isSaving}
		>
			Save
		</Button>
	);
}

export default memo(SaveButton);
