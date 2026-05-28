import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, CssBaseline, Tab, Tabs, ThemeProvider, createTheme } from '@mui/material';
import { Archive, Zap } from 'lucide-react';
import { themeOptions } from '../theme/themeOptions';
import type { ArchiveDay, LogEntry, ProcessingItemGroup, SourceFilter, StepInfo, TabKey } from './types';
import { LIVE_FINISHED_LIMIT, effectiveCounts, groupByHierarchy } from './utils';
import { ArchiveView } from './components/ArchiveView';
import { LiveView } from './components/LiveView';
import { Toolbar } from './components/Toolbar';

const theme = createTheme(themeOptions);

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
	const syncState = useCallback(() => {
		if (syncRaf.current != null) return;
		syncRaf.current = requestAnimationFrame(() => {
			syncRaf.current = null;
			setItems(Array.from(itemsMap.current.values()));
		});
	}, []);
	useEffect(
		() => () => {
			if (syncRaf.current != null) cancelAnimationFrame(syncRaf.current);
		},
		[],
	);

	// ── IPC ──────────────────────────────────────────────────────────────────

	useEffect(() => {
		const api = (window as any).electronAPI;

		api.invoke('log-window:get-history').then((data: any) => {
			if (!data) return;
			itemsMap.current.clear();
			for (const g of data.items ?? []) {
				if (!g.itemLogs) g.itemLogs = [];
				itemsMap.current.set(g.itemId, g);
			}
			syncState();
		});

		const onItemStart = (_: any, group: ProcessingItemGroup) => {
			if (!group.itemLogs) group.itemLogs = [];
			itemsMap.current.set(group.itemId, { ...group });
			// Queued-элементы не раскрываем автоматически — только при реальном старте.
			if (group.status === 'running') {
				setExpanded((prev) => new Set([...prev, group.itemId]));
			}
			syncState();
		};

		const onItemLog = (_: any, entry: LogEntry) => {
			if (!entry.itemId) return;
			const group = itemsMap.current.get(entry.itemId);
			if (!group) return;

			// Дедупликация по id — на случай если лог пришёл и в history, и live
			const alreadyInStep = entry.stepId ? group.steps.some((s) => s.logs.some((l) => l.id === entry.id)) : false;
			const alreadyInItem = (group.itemLogs ?? []).some((l) => l.id === entry.id);
			if (alreadyInStep || alreadyInItem) return;

			if (entry.level === 'error') group.errorCount++;
			if (entry.level === 'warn') group.warnCount++;

			if (entry.stepId) {
				const step = group.steps.find((s) => s.stepId === entry.stepId);
				if (step) {
					step.logs = [...step.logs, entry];
					if (entry.level === 'error') step.errorCount++;
				} else {
					// stepId не совпал — кладём в itemLogs
					group.itemLogs = [...(group.itemLogs ?? []), entry];
				}
			} else {
				// нет stepId — item-уровень
				group.itemLogs = [...(group.itemLogs ?? []), entry];
			}
			syncState();
		};

		const onNodeUpdate = (
			_: any,
			payload: { itemId: string; nodeId: string; status: StepInfo['status']; startTime?: string; endTime?: string; finalCost?: number },
		) => {
			const group = itemsMap.current.get(payload.itemId);
			if (!group) return;
			const step = group.steps.find((s) => s.stepId === payload.nodeId);
			if (step) {
				step.status = payload.status;
				if (payload.startTime) step.startTime = payload.startTime;
				if (payload.endTime) step.endTime = payload.endTime;
				if (payload.finalCost !== undefined) step.finalCost = payload.finalCost;
			}
			syncState();
		};

		const onItemEnd = async (_: any, payload: { itemId: string; status: ProcessingItemGroup['status']; endTime: string; totalCost?: number }) => {
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
		api.on('log-window:cleared', onCleared);

		return () => {
			api.off('log-window:item-start', onItemStart);
			api.off('log-window:item-log', onItemLog);
			api.off('log-window:node-update', onNodeUpdate);
			api.off('log-window:item-end', onItemEnd);
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
