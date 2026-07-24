import { useCallback, useEffect, useRef } from 'react';
import { type Edge, type EdgeChange, type Node, type NodeChange, useReactFlow } from '@xyflow/react';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';

/**
 * Undo/Redo для холста нод.
 *
 * Почему единый хук, а не «официальный» рецепт React Flow (takeSnapshot() перед
 * каждым действием): у нас правки летят из ~30 мест (useProperty, TextEdit/TimeCode/
 * PathNavigator/ValueRange/Checkbox/Slider, copy-paste, quick-add, drag-drop,
 * пресеты, каскадная валидация…). Но ВСЕ они в контролируемом флоу проходят через
 * onNodesChange/onEdgesChange (RF v12: reactFlow.setNodes/updateNode/deleteElements
 * → батч-очередь → onNodesChange?.(changes), см. index.mjs BatchProvider). Поэтому
 * достаточно наблюдать за этой единой точкой — историю ловим централизованно, без
 * инструментирования 30 файлов.
 *
 * Группировка: непрерывный ввод текста / протяжка мышью / каскад-валидация
 * схлопываются в ОДИН шаг истории (дебаунс), а не пишутся по символу/пикселю.
 * Шум игнорируем: выделение (select) и авто-замеры (dimensions) шаг не создают.
 * Viewport (пан/зум) в снимки не входит — его откатывать не нужно.
 */

type Snapshot = { nodes: Node[]; edges: Edge[] };

interface UseUndoRedoOptions {
	/** Прямой сеттер из useNodesState — восстановление МИНУЕТ onNodesChange (не плодит историю). */
	setNodes: (nodes: Node[]) => void;
	/** Прямой сеттер из useEdgesState. */
	setEdges: (edges: Edge[]) => void;
	/** На сколько шагов назад хранить историю. Default: 50. */
	maxHistory?: number;
	/** Окно схлопывания непрерывной серии изменений в один шаг, мс. Default: 400. */
	debounceMs?: number;
	/** Включён ли хук (слушатели + запись). Default: true. */
	enabled?: boolean;
}

// Изменение «содержательное», если это НЕ чистое выделение и НЕ авто-замер размеров.
// Ресайз ноды (dimensions + resizing) — содержательное. add/remove/replace/position — тоже.
function isSubstantive(changes: NodeChange[] | EdgeChange[]): boolean {
	return (changes as Array<{ type: string; resizing?: boolean }>).some((c) => {
		if (c.type === 'select') return false;
		if (c.type === 'dimensions') return c.resizing === true;
		return true;
	});
}

export function useUndoRedo({
	setNodes,
	setEdges,
	maxHistory = 50,
	debounceMs = 400,
	enabled = true,
}: UseUndoRedoOptions) {
	const reactFlow = useReactFlow();

	const past = useRef<Snapshot[]>([]);
	const future = useRef<Snapshot[]>([]);
	// Снимок ДО начала текущей серии изменений (то, что уйдёт в past при коммите).
	const batchBase = useRef<Snapshot | null>(null);
	// Актуальное состояние, как мы его знаем СИНХРОННО. Ключевой момент: undo/redo
	// читают отсюда, а НЕ из стора RF. После restore стор обновляется лишь через
	// рендер (лаг в один тик), поэтому при зажатом Ctrl+Z чтение стора вернуло бы
	// stale-снимок и шаг бы «проскакивал». Здесь present обновляется мгновенно.
	// null = ещё не знаем (после сброса) → первый снимок возьмём из стора (он к
	// моменту первого действия уже устоялся).
	const present = useRef<Snapshot | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Пока идёт восстановление — не записываем изменения в историю.
	const isRestoring = useRef(false);

	// Живой снимок текущего состояния из стора RF (клоны объектов — «замораживаем» шаг).
	const snapshot = useCallback(
		(): Snapshot => ({ nodes: reactFlow.getNodes(), edges: reactFlow.getEdges() }),
		[reactFlow],
	);

	// Закрыть текущую серию: затолкнуть базовый (до-действия) снимок в past,
	// а present передвинуть на устоявшееся после-действенное состояние.
	const commit = useCallback(() => {
		if (timer.current) {
			clearTimeout(timer.current);
			timer.current = null;
		}
		const base = batchBase.current;
		batchBase.current = null;
		if (!base) return;
		past.current.push(base);
		if (past.current.length > maxHistory) past.current.shift();
		future.current = []; // новое действие обнуляет redo
		// Дебаунс уже отстоялся — стор отражает финал серии, снимок надёжен.
		present.current = snapshot();
	}, [maxHistory, snapshot]);

	const scheduleCommit = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			timer.current = null;
			commit();
		}, debounceMs);
	}, [commit, debounceMs]);

	// Наблюдатель: зовётся из onNodesChange/onEdgesChange ДО применения изменений.
	const record = useCallback(
		(changes: NodeChange[] | EdgeChange[]) => {
			if (!enabled || isRestoring.current) return;
			if (!isSubstantive(changes)) return;
			// Снимок захватываем один раз на серию — на самом первом изменении.
			// present надёжнее стора (см. коммент у present); если его ещё нет —
			// берём из стора (к первому действию он устоялся).
			if (batchBase.current === null) batchBase.current = present.current ?? snapshot();
			scheduleCommit();
		},
		[enabled, snapshot, scheduleCommit],
	);

	const restore = useCallback(
		(snap: Snapshot) => {
			isRestoring.current = true;
			setNodes(snap.nodes.map((n) => ({ ...n })));
			setEdges(snap.edges.map((e) => ({ ...e })));
			// RF после подмены нод может отбить dimensions/select через onNodesChange —
			// они и так отфильтрованы, но снимаем флаг на след. тик для надёжности.
			setTimeout(() => {
				isRestoring.current = false;
			}, 0);
		},
		[setNodes, setEdges],
	);

	const undo = useCallback(() => {
		if (!enabled) return;
		commit(); // зафиксировать незакрытую правку, чтобы её можно было откатить
		if (past.current.length === 0) return;
		const current = present.current ?? snapshot();
		const target = past.current.pop()!;
		future.current.push(current);
		present.current = target; // синхронно — до рендера стора
		restore(target);
	}, [enabled, commit, snapshot, restore]);

	const redo = useCallback(() => {
		if (!enabled) return;
		if (timer.current) commit(); // незакрытая правка = новое действие, redo уже обнулён
		if (future.current.length === 0) return;
		const current = present.current ?? snapshot();
		const target = future.current.pop()!;
		past.current.push(current);
		present.current = target; // синхронно — до рендера стора
		restore(target);
	}, [enabled, commit, snapshot, restore]);

	// Полный сброс истории (при загрузке другого проекта).
	const resetHistory = useCallback(() => {
		if (timer.current) {
			clearTimeout(timer.current);
			timer.current = null;
		}
		past.current = [];
		future.current = [];
		batchBase.current = null;
		present.current = null; // возьмём заново из стора при первом действии
	}, []);

	// Ctrl/Cmd+Z — undo; Ctrl/Cmd+Shift+Z и Ctrl/Cmd+Y — redo.
	// skipOnInput=true (дефолт хука): пока фокус в input/textarea/contentEditable —
	// Ctrl+Z уходит в нативный undo поля ввода, а не откатывает граф.
	useKeyboardShortcut({
		key: ['z', 'Z'],
		modifiers: { ctrlOrMeta: true, shift: false },
		enabled,
		callback: (e) => {
			e.preventDefault();
			undo();
		},
	});
	useKeyboardShortcut({
		key: ['z', 'Z'],
		modifiers: { ctrlOrMeta: true, shift: true },
		enabled,
		callback: (e) => {
			e.preventDefault();
			redo();
		},
	});
	useKeyboardShortcut({
		key: ['y', 'Y'],
		modifiers: { ctrlOrMeta: true },
		enabled,
		callback: (e) => {
			e.preventDefault();
			redo();
		},
	});

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	return { record, undo, redo, resetHistory };
}
