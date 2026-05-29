import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, CssBaseline, Tab, Tabs, ThemeProvider, createTheme } from '@mui/material';
import { Archive, Zap } from 'lucide-react';
import { themeOptions } from '../theme/themeOptions';
import type { ArchiveDay, LogEntry, ProcessingItemGroup, SourceFilter, StepInfo, TabKey } from './types';
import { LIVE_FINISHED_LIMIT, effectiveCounts, findStepDeep, groupByHierarchy } from './utils';
import { ArchiveView } from './components/ArchiveView';
import { LiveView } from './components/LiveView';
import { Toolbar } from './components/Toolbar';

const theme = createTheme(themeOptions);

// Fire-and-forget диагностическая запись в `app_data_dir/logs/diag.log` (см. diag_log.rs).
// Используется только для отладки зависания LogApp — после починки можно снести вместе с
// `diag:log` алиасом и diag_log.rs модулем.
function diag(msg: string) {
	try {
		(window as any).electronAPI?.invoke?.('diag:log', `[LogApp] ${msg}`);
	} catch {
		/* noop */
	}
}

// Глубокий пересчёт размеров текущего состояния — сколько узлов/логов сейчас
// держим в RAM. Считается из самой Map'ы, без копирования массивов.
function snapshotState(map: Map<string, ProcessingItemGroup>): string {
	let steps = 0;
	let substeps = 0;
	let logs = 0;
	let maxSubs = 0;
	let maxLogs = 0;
	const visit = (s: StepInfo) => {
		steps++;
		logs += s.logs.length;
		if (s.logs.length > maxLogs) maxLogs = s.logs.length;
		if (s.subSteps && s.subSteps.length) {
			substeps += s.subSteps.length;
			if (s.subSteps.length > maxSubs) maxSubs = s.subSteps.length;
			for (const sub of s.subSteps) visit(sub);
		}
	};
	for (const g of map.values()) {
		for (const s of g.steps) visit(s);
		logs += (g.itemLogs ?? []).length;
	}
	return `items=${map.size} steps=${steps} subSteps=${substeps} logs=${logs} maxSubs=${maxSubs} maxLogs=${maxLogs}`;
}

export default function LogApp() {
	const [items, setItems] = useState<ProcessingItemGroup[]>([]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [levelFilter, setLevelFilter] = useState<Set<string>>(new Set(['info', 'warn', 'error', 'debug']));
	const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
	const [search, setSearch] = useState('');
	const [errorsOnly, setErrorsOnly] = useState(false);

	// Вкладки: «Текущие» — горячий буфер сессии (RAM); «Архив» — лог-файлы по дням с диска.
	const [tab, setTab] = useState<TabKey>('live');
	const [archiveDays, setArchiveDays] = useState<ArchiveDay[]>([]);
	const [archiveDate, setArchiveDate] = useState<string | null>(null);
	const [archiveItems, setArchiveItems] = useState<ProcessingItemGroup[]>([]);
	const [archiveLoading, setArchiveLoading] = useState(false);
	const [archiveExpanded, setArchiveExpanded] = useState<Set<string>>(new Set());

	const itemsMap = useRef<Map<string, ProcessingItemGroup>>(new Map());

	// Дебаунс через requestAnimationFrame: при шторме log-событий пересобираем массив
	// и ре-рендерим дерево максимум раз в кадр (~16мс), а не на каждую строку лога.
	const syncRaf = useRef<number | null>(null);
	// Счётчики событий для диагностического 1-секундного flush'а (см. ниже).
	const eventCounts = useRef({ start: 0, log: 0, node: 0, sub: 0, end: 0, sync: 0, syncMs: 0 });
	const syncState = useCallback(() => {
		if (syncRaf.current != null) return;
		syncRaf.current = requestAnimationFrame(() => {
			syncRaf.current = null;
			const t0 = performance.now();
			setItems(Array.from(itemsMap.current.values()));
			const dt = performance.now() - t0;
			eventCounts.current.sync++;
			eventCounts.current.syncMs += dt;
			// Долгий батч раз — пишем сразу, не ждём секундного flush'а.
			if (dt > 50) diag(`slow sync: ${dt.toFixed(1)}ms ${snapshotState(itemsMap.current)}`);
		});
	}, []);
	useEffect(
		() => () => {
			if (syncRaf.current != null) cancelAnimationFrame(syncRaf.current);
		},
		[],
	);

	// Раз в секунду пишем сводку: сколько событий обработали + текущий снапшот RAM.
	// Если фронт замрёт — последняя запись покажет, на чём именно: и тогда счётчики
	// (особенно sub/log) подскажут, что приходило перед остановкой.
	useEffect(() => {
		diag(`mount ${snapshotState(itemsMap.current)}`);
		const id = setInterval(() => {
			const c = eventCounts.current;
			if (c.start || c.log || c.node || c.sub || c.end || c.sync) {
				diag(
					`tick: start=${c.start} log=${c.log} node=${c.node} sub=${c.sub} end=${c.end} ` +
						`syncs=${c.sync} syncTotalMs=${c.syncMs.toFixed(0)} | ${snapshotState(itemsMap.current)}`,
				);
				eventCounts.current = { start: 0, log: 0, node: 0, sub: 0, end: 0, sync: 0, syncMs: 0 };
			}
		}, 1000);
		return () => {
			clearInterval(id);
			diag(`unmount ${snapshotState(itemsMap.current)}`);
		};
	}, []);

	// ── IPC ──────────────────────────────────────────────────────────────────

	useEffect(() => {
		const api = (window as any).electronAPI;

		const tHistory0 = performance.now();
		diag('get-history start');
		api.invoke('log-window:get-history').then((data: any) => {
			const tIpc = performance.now() - tHistory0;
			if (!data) {
				diag(`get-history empty (ipc=${tIpc.toFixed(0)}ms)`);
				return;
			}
			const tBuild0 = performance.now();
			itemsMap.current.clear();
			for (const g of data.items ?? []) {
				if (!g.itemLogs) g.itemLogs = [];
				itemsMap.current.set(g.itemId, g);
			}
			const tBuild = performance.now() - tBuild0;
			diag(`get-history loaded: ipc=${tIpc.toFixed(0)}ms build=${tBuild.toFixed(0)}ms ${snapshotState(itemsMap.current)}`);
			syncState();
		});

		const onItemStart = (_: any, group: ProcessingItemGroup) => {
			eventCounts.current.start++;
			if (!group.itemLogs) group.itemLogs = [];
			itemsMap.current.set(group.itemId, { ...group });
			// Queued-элементы не раскрываем автоматически — только при реальном старте.
			if (group.status === 'running') {
				setExpanded((prev) => new Set([...prev, group.itemId]));
			}
			syncState();
		};

		const onItemLog = (_: any, entry: LogEntry) => {
			eventCounts.current.log++;
			if (!entry.itemId) return;
			const group = itemsMap.current.get(entry.itemId);
			if (!group) return;

			// Дедупликация по id — на случай если лог пришёл и в history, и live
			const step = entry.stepId ? findStepDeep(group.steps, entry.stepId) : undefined;
			const alreadyInStep = step ? step.logs.some((l) => l.id === entry.id) : false;
			const alreadyInItem = (group.itemLogs ?? []).some((l) => l.id === entry.id);
			if (alreadyInStep || alreadyInItem) return;

			if (entry.level === 'error') group.errorCount++;
			if (entry.level === 'warn') group.warnCount++;

			if (step) {
				step.logs = [...step.logs, entry];
				if (entry.level === 'error') step.errorCount++;
			} else {
				// stepId не указан или не найден (в т.ч. в subSteps) — item-уровень
				group.itemLogs = [...(group.itemLogs ?? []), entry];
			}
			syncState();
		};

		const onNodeUpdate = (
			_: any,
			payload: { itemId: string; nodeId: string; status: StepInfo['status']; startTime?: string; endTime?: string; finalCost?: number },
		) => {
			eventCounts.current.node++;
			const group = itemsMap.current.get(payload.itemId);
			if (!group) return;
			const step = findStepDeep(group.steps, payload.nodeId);
			if (step) {
				step.status = payload.status;
				if (payload.startTime) step.startTime = payload.startTime;
				if (payload.endTime) step.endTime = payload.endTime;
				if (payload.finalCost !== undefined) step.finalCost = payload.finalCost;
			}
			syncState();
		};

		// Новая итерация loop'а: батч саб-шагов добавляется в parent.subSteps.
		// Дедуп по stepId — защита от двойной доставки (если Tauri-подписка задвоилась
		// или Rust по какой-то причине эмитнул дважды).
		const onSubstepBatch = (_: any, payload: { itemId: string; parentStepId: string; subSteps: StepInfo[] }) => {
			eventCounts.current.sub++;
			const group = itemsMap.current.get(payload.itemId);
			if (!group) return;
			const parent = findStepDeep(group.steps, payload.parentStepId);
			if (!parent) return;
			const existingIds = new Set((parent.subSteps ?? []).map((s) => s.stepId));
			const incoming = (payload.subSteps ?? [])
				.filter((s) => !existingIds.has(s.stepId))
				.map((s) => ({ ...s, logs: s.logs ?? [], errorCount: s.errorCount ?? 0 }));
			if (incoming.length === 0) return;
			parent.subSteps = [...(parent.subSteps ?? []), ...incoming];
			// Если subSteps растут неуправляемо — заметим в diag.
			if (parent.subSteps.length % 50 === 0) {
				diag(`subSteps milestone: parent=${payload.parentStepId} len=${parent.subSteps.length}`);
			}
			syncState();
		};

		const onItemEnd = async (_: any, payload: { itemId: string; status: ProcessingItemGroup['status']; endTime: string; totalCost?: number }) => {
			eventCounts.current.end++;
			const group = itemsMap.current.get(payload.itemId);
			if (group) {
				group.status = payload.status;
				group.endTime = payload.endTime;
				if (payload.totalCost !== undefined) group.totalCost = payload.totalCost;
				if (payload.status === 'done' && group.errorCount === 0) {
					setExpanded((prev) => {
						const n = new Set(prev);
						n.delete(payload.itemId);
						return n;
					});
				}

				// Добавляем ошибки шаблонов в конец логов
				try {
					const allErrors = await window.templates.getErrors();
					if (allErrors.length > 0) {
						allErrors.forEach((err) => {
							group.itemLogs.push({
								id: Math.random().toString(36).slice(2, 9),
								timestamp: err.timestamp,
								level: 'warn',
								message: `[${err.templateLabel}] ${err.error.message}`,
								source: 'main',
								itemId: payload.itemId,
							});
						});
					}
				} catch {
					// Игнорируем ошибки при получении списка ошибок
				}
			}

			// Обрезаем горячий буфер: оставляем активные + последние N завершённых.
			// Старые завершённые уже на диске (вкладка «Архив») — так live-вкладка не растёт без предела.
			const map = itemsMap.current;
			const finishedIds: string[] = [];
			for (const [id, g] of map) {
				if (g.status !== 'running' && g.status !== 'queued') finishedIds.push(id);
			}
			const excess = finishedIds.length - LIVE_FINISHED_LIMIT;
			for (let i = 0; i < excess; i++) map.delete(finishedIds[i]);

			syncState();
		};

		const onCleared = () => {
			itemsMap.current.clear();
			setExpanded(new Set());
			syncState();
		};

		api.on('log-window:item-start', onItemStart);
		api.on('log-window:item-log', onItemLog);
		api.on('log-window:node-update', onNodeUpdate);
		api.on('log-window:item-end', onItemEnd);
		api.on('log-window:substep-batch', onSubstepBatch);
		api.on('log-window:cleared', onCleared);

		return () => {
			api.off('log-window:item-start', onItemStart);
			api.off('log-window:item-log', onItemLog);
			api.off('log-window:node-update', onNodeUpdate);
			api.off('log-window:item-end', onItemEnd);
			api.off('log-window:substep-batch', onSubstepBatch);
			api.off('log-window:cleared', onCleared);
		};
	}, [syncState]);

	// ── Derived ──────────────────────────────────────────────────────────────

	const visibleItems = items.filter((g) => {
		if (errorsOnly && effectiveCounts(g).errors === 0) return false;
		return true;
	});

	const activeItems = visibleItems.filter((g) => g.status === 'running' || g.status === 'queued');
	// Завершённые в текущей сессии (горячий буфер RAM, до HOT_BUFFER_FINISHED_LIMIT штук).
	// Полная история — во вкладке «Архив» (читается с диска по дням).
	const sessionDoneItems = visibleItems.filter((g) => g.status !== 'running' && g.status !== 'queued');

	const activeHierarchy = groupByHierarchy(activeItems);
	const sessionDoneHierarchy = groupByHierarchy(sessionDoneItems);

	const stats = {
		total: items.length,
		running: items.filter((g) => g.status === 'running').length,
		errorItems: items.filter((g) => effectiveCounts(g).errors > 0).length,
	};

	const archiveVisibleItems = archiveItems.filter((g) => !errorsOnly || effectiveCounts(g).errors > 0);
	const archiveFileHierarchy = groupByHierarchy(archiveVisibleItems);

	// ── Handlers ─────────────────────────────────────────────────────────────

	const handleToggleExpand = useCallback((id: string) => {
		setExpanded((prev) => {
			const n = new Set(prev);
			n.has(id) ? n.delete(id) : n.add(id);
			return n;
		});
	}, []);

	const handleToggleArchiveExpand = useCallback((id: string) => {
		setArchiveExpanded((prev) => {
			const n = new Set(prev);
			n.has(id) ? n.delete(id) : n.add(id);
			return n;
		});
	}, []);

	const loadArchiveDays = useCallback(async () => {
		const api = (window as any).electronAPI;
		try {
			const days = await api.invoke('logs:list-days');
			setArchiveDays(Array.isArray(days) ? days : []);
		} catch {
			setArchiveDays([]);
		}
	}, []);

	const openArchiveDay = useCallback(async (date: string) => {
		const api = (window as any).electronAPI;
		setArchiveLoading(true);
		setArchiveDate(date);
		setArchiveExpanded(new Set());
		try {
			const groups = await api.invoke('logs:get-day', date);
			setArchiveItems((Array.isArray(groups) ? groups : []).map((g: any) => ({ ...g, itemLogs: g.itemLogs ?? [] })));
		} catch {
			setArchiveItems([]);
		} finally {
			setArchiveLoading(false);
		}
	}, []);

	const handleSelectTab = useCallback(
		(next: TabKey) => {
			setTab(next);
			if (next === 'archive') loadArchiveDays();
		},
		[loadArchiveDays],
	);

	const handleClearArchive = useCallback(async () => {
		const api = (window as any).electronAPI;
		await api.invoke('logs:clear-archive').catch(() => {});
		setArchiveItems([]);
		setArchiveDate(null);
		loadArchiveDays();
	}, [loadArchiveDays]);

	const handleToggleLevel = useCallback((level: string) => {
		setLevelFilter((prev) => {
			const n = new Set(prev);
			n.has(level) ? n.delete(level) : n.add(level);
			return n;
		});
	}, []);

	// ── Render ───────────────────────────────────────────────────────────────

	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
				<Toolbar
					stats={stats}
					sourceFilter={sourceFilter}
					setSourceFilter={setSourceFilter}
					levelFilter={levelFilter}
					onToggleLevel={handleToggleLevel}
					search={search}
					setSearch={setSearch}
					errorsOnly={errorsOnly}
					setErrorsOnly={setErrorsOnly}
					tab={tab}
					onLoadArchiveDays={loadArchiveDays}
					onClearArchive={handleClearArchive}
				/>

				<Tabs
					value={tab}
					onChange={(_, v) => handleSelectTab(v)}
					sx={{
						minHeight: 34,
						flexShrink: 0,
						borderBottom: '1px solid',
						borderColor: 'divider',
						bgcolor: 'background.paper',
						'& .MuiTab-root': { minHeight: 34, py: 0, fontSize: 12, textTransform: 'none' },
					}}
				>
					<Tab value='live' icon={<Zap size={13} />} iconPosition='start' label='Текущие' />
					<Tab value='archive' icon={<Archive size={13} />} iconPosition='start' label='Архив' />
				</Tabs>

				<Box sx={{ flex: 1, overflowY: 'auto', bgcolor: 'background.default' }}>
					{tab === 'live' ? (
						<LiveView
							items={items}
							activeItems={activeItems}
							sessionDoneItems={sessionDoneItems}
							activeHierarchy={activeHierarchy}
							sessionDoneHierarchy={sessionDoneHierarchy}
							expanded={expanded}
							onToggleExpand={handleToggleExpand}
							levelFilter={levelFilter}
							sourceFilter={sourceFilter}
							search={search}
						/>
					) : (
						<ArchiveView
							archiveDays={archiveDays}
							archiveDate={archiveDate}
							archiveLoading={archiveLoading}
							archiveVisibleItems={archiveVisibleItems}
							archiveFileHierarchy={archiveFileHierarchy}
							archiveExpanded={archiveExpanded}
							onOpenDay={openArchiveDay}
							onToggleExpand={handleToggleArchiveExpand}
							levelFilter={levelFilter}
							sourceFilter={sourceFilter}
							search={search}
						/>
					)}
				</Box>
			</Box>

			<style>{`
				@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
				@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
			`}</style>
		</ThemeProvider>
	);
}
