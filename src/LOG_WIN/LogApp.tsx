import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
	Accordion,
	AccordionDetails,
	AccordionSummary,
	Box,
	Chip,
	CssBaseline,
	IconButton,
	InputAdornment,
	Stack,
	Tab,
	Tabs,
	TextField,
	ThemeProvider,
	Tooltip,
	Typography,
	createTheme,
	LinearProgress,
} from '@mui/material';
import {
	AlertCircle,
	AlertTriangle,
	Archive,
	CalendarDays,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	Clock,
	Download,
	Folder,
	Inbox,
	Loader,
	RefreshCw,
	Search,
	Trash2,
	X,
	Zap,
} from 'lucide-react';
import { themeOptions } from '../theme/themeOptions';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LogEntry {
	id: string;
	timestamp: string;
	level: 'info' | 'warn' | 'error' | 'debug';
	message: string;
	meta?: any;
	source: 'main' | 'renderer';
	itemId?: string;
	stepId?: string;
}

interface StepInfo {
	stepId: string;
	label: string;
	pluginId?: string;
	nodeType: string;
	status: 'queued' | 'running' | 'done' | 'error';
	startTime?: string;
	endTime?: string;
	logs: LogEntry[];
	errorCount: number;
	cost?: string;
	costUnit?: 'HH' | 'MM' | 'ss' | 'run' | 'fromSite';
	finalCost?: number;
}

interface ProcessingItemGroup {
	itemId: string;
	itemName: string;
	mainFolderName: string;
	projectName: string;
	status: 'queued' | 'running' | 'done' | 'error' | 'aborted';
	startTime: string;
	endTime?: string;
	steps: StepInfo[];
	errorCount: number;
	warnCount: number;
	// логи без stepId (orphan внутри item)
	itemLogs: LogEntry[];
	totalCost?: number;
}

function fmtCost(n: number): string {
	if (!Number.isFinite(n)) return '';
	if (n <= 0) return '$0';
	return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface ArchiveDay {
	date: string;
	items: number;
	bytes: number;
}

// Сколько завершённых item'ов держим во вкладке «Текущие» (RAM). Должно совпадать с
// HOT_BUFFER_FINISHED_LIMIT на Rust-стороне. Старые завершённые остаются в «Архиве» (на диске).
const LIVE_FINISHED_LIMIT = 40;

// ── Theme ─────────────────────────────────────────────────────────────────────

const theme = createTheme(themeOptions);

// ── Colours ───────────────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<string, string> = {
	info: '#58a6ff',
	warn: '#d29922',
	error: '#f85149',
	debug: '#8b949e',
};

const STEP_COLOR: Record<StepInfo['status'], string> = {
	queued:  '#555',
	running: '#d29922',
	done:    '#3fb950',
	error:   '#f85149',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
	return new Date(iso).toLocaleTimeString('ru-RU', { hour12: false });
}

function elapsed(startIso: string, endIso?: string): string {
	const ms = (endIso ? new Date(endIso) : new Date()).getTime() - new Date(startIso).getTime();
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
	return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function progress(steps: StepInfo[]): number {
	if (steps.length === 0) return 0;
	return Math.round((steps.filter((s) => s.status === 'done' || s.status === 'error').length / steps.length) * 100);
}

// ── StepSquare ────────────────────────────────────────────────────────────────

function StepSquare({ status }: { status: StepInfo['status'] }) {
	const color = STEP_COLOR[status];
	const isRunning = status === 'running';
	return (
		<Box
			component="span"
			sx={{
				display: 'inline-block',
				width: 10,
				height: 10,
				borderRadius: '2px',
				bgcolor: color,
				flexShrink: 0,
				animation: isRunning ? 'pulse 1s ease-in-out infinite' : undefined,
			}}
		/>
	);
}

// ── LogLine ───────────────────────────────────────────────────────────────────

const LogLine = React.memo(function LogLine({ entry }: { entry: LogEntry }) {
	const color = LEVEL_COLOR[entry.level] ?? '#c9d1d9';
	return (
		<Box
			sx={{
				display: 'flex',
				gap: 0.75,
				alignItems: 'baseline',
				px: 1,
				py: '2px',
				borderRadius: 0.5,
				bgcolor: entry.level === 'error' ? 'rgba(248,81,73,0.08)' : 'transparent',
				fontFamily: 'Consolas, monospace',
				fontSize: 11,
				lineHeight: 1.5,
				'&:hover': { bgcolor: 'action.hover' },
			}}
		>
			<Box component="span" sx={{ color: 'text.disabled', flexShrink: 0, minWidth: 60 }}>
				{fmtTime(entry.timestamp)}
			</Box>
			<Box component="span" sx={{ color, fontWeight: 700, fontSize: 10, flexShrink: 0, minWidth: 38, textTransform: 'uppercase' }}>
				{entry.level}
			</Box>
			{entry.source === 'renderer' && (
				<Box component="span" sx={{ color: 'text.disabled', fontSize: 10, flexShrink: 0 }}>[rend]</Box>
			)}
			<Box component="span" sx={{ color: 'text.primary', wordBreak: 'break-all', whiteSpace: 'pre-wrap', flex: 1 }}>
				{entry.message}
				{entry.meta && (
					<Box component="span" sx={{ color: 'text.secondary', ml: 1, fontSize: 10 }}>
						{typeof entry.meta === 'object' ? JSON.stringify(entry.meta) : String(entry.meta)}
					</Box>
				)}
			</Box>
		</Box>
	);
});

// ── StepRow — плагин (уровень 4) ──────────────────────────────────────────────

function StepRow({
	step,
	levelFilter,
	sourceFilter,
	search,
}: {
	step: StepInfo;
	levelFilter: Set<string>;
	sourceFilter: 'all' | 'main' | 'renderer';
	search: string;
}) {
	const [open, setOpen] = useState(false);
	const color = STEP_COLOR[step.status];

	const filteredLogs = step.logs.filter(
		(e) =>
			levelFilter.has(e.level) &&
			(sourceFilter === 'all' || e.source === sourceFilter) &&
			(!search || e.message.toLowerCase().includes(search.toLowerCase())),
	);

	const stepElapsed = step.startTime ? elapsed(step.startTime, step.endTime) : null;

	return (
		<Box sx={{ borderLeft: `2px solid ${color}33`, ml: 1.5, mb: '1px' }}>
			<Box
				onClick={() => filteredLogs.length > 0 && setOpen((v) => !v)}
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: 0.75,
					px: 1,
					py: '4px',
					cursor: filteredLogs.length > 0 ? 'pointer' : 'default',
					'&:hover': filteredLogs.length > 0 ? { bgcolor: 'action.hover' } : {},
					borderRadius: 0.5,
				}}
			>
				{filteredLogs.length > 0 ? (
					open
						? <ChevronDown size={12} style={{ color: '#666', flexShrink: 0 }} />
						: <ChevronRight size={12} style={{ color: '#666', flexShrink: 0 }} />
				) : (
					<Box sx={{ width: 12, flexShrink: 0 }} />
				)}

				<StepSquare status={step.status} />

				<Typography sx={{ fontFamily: 'Consolas, monospace', fontSize: 12, flex: 1, color: 'text.primary' }}>
					{step.label}
					{step.pluginId && step.pluginId !== step.label && (
						<Box component="span" sx={{ color: 'text.disabled', ml: 0.5, fontSize: 10 }}>
							({step.pluginId})
						</Box>
					)}
				</Typography>

				{step.errorCount > 0 && (
					<Box component="span" sx={{ color: '#f85149', fontSize: 10, mr: 0.5 }}>
						{step.errorCount} err
					</Box>
				)}

				{stepElapsed && (
					<Box component="span" sx={{ color: 'text.disabled', fontSize: 10, fontFamily: 'Consolas, monospace' }}>
						{stepElapsed}
						{step.finalCost !== undefined && (
							<Box component="span" sx={{ ml: 0.5, color: '#3fb950' }}>
								/ {fmtCost(step.finalCost)}
							</Box>
						)}
					</Box>
				)}

				<Box component="span" sx={{ fontSize: 10, color, ml: 0.5, minWidth: 48, textAlign: 'right', textTransform: 'uppercase', fontWeight: 600 }}>
					{step.status}
				</Box>
			</Box>

			{open && filteredLogs.length > 0 && (
				<Box sx={{ pl: 2.5, pb: 0.5 }}>
					{filteredLogs.map((e) => <LogLine key={e.id} entry={e} />)}
				</Box>
			)}
		</Box>
	);
}

// ── Elapsed timer hook ────────────────────────────────────────────────────────

function useElapsed(startIso: string, endIso?: string, active = true): string {
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!active || endIso) return;
		const id = setInterval(() => setTick((v) => v + 1), 1000);
		return () => clearInterval(id);
	}, [active, endIso]);
	return elapsed(startIso, endIso);
}

// Суммирует реальное время выполнения шагов (pool wait не учитывается,
// т.к. node:start отправляется только ПОСЛЕ acquirePool).
function sumStepMs(steps: StepInfo[]): number {
	const now = Date.now();
	let total = 0;
	for (const step of steps) {
		if (!step.startTime) continue;
		const start = new Date(step.startTime).getTime();
		const end = step.endTime ? new Date(step.endTime).getTime() : now;
		if (end > start) total += end - start;
	}
	return total;
}

function msToElapsed(ms: number): string {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
	return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function useStepElapsed(steps: StepInfo[], active = true): string {
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!active) return;
		const id = setInterval(() => setTick((v) => v + 1), 1000);
		return () => clearInterval(id);
	}, [active]);
	return msToElapsed(sumStepMs(steps));
}

// ── ItemAccordion — item (уровень 3) ──────────────────────────────────────────

interface ItemAccordionProps {
	group: ProcessingItemGroup;
	expanded: boolean;
	onToggle: () => void;
	levelFilter: Set<string>;
	sourceFilter: 'all' | 'main' | 'renderer';
	search: string;
}

const ItemAccordion = React.memo(function ItemAccordion({
	group,
	expanded,
	onToggle,
	levelFilter,
	sourceFilter,
	search,
}: ItemAccordionProps) {
	const isRunning = group.status === 'running';
	const isQueued = group.status === 'queued';
	const pct = progress(group.steps);
	const time = useStepElapsed(group.steps, isRunning);

	const hasError = group.errorCount > 0;
	const borderColor = hasError
		? 'rgba(248,81,73,0.4)'
		: isRunning
		? 'rgba(88,166,255,0.25)'
		: isQueued
		? 'rgba(139,148,158,0.25)'
		: 'divider';

	const stepSquares = group.steps.map((s) => (
		<Tooltip key={s.stepId} title={`${s.label}: ${s.status}`}>
			<Box sx={{ cursor: 'default' }}>
				<StepSquare status={s.status} />
			</Box>
		</Tooltip>
	));

	// логи item-уровня без stepId
	const itemLevelLogs = (group.itemLogs ?? []).filter(
		(e) =>
			levelFilter.has(e.level) &&
			(sourceFilter === 'all' || e.source === sourceFilter) &&
			(!search || e.message.toLowerCase().includes(search.toLowerCase())),
	);

	return (
		<Accordion
			disableGutters
			elevation={0}
			expanded={expanded}
			onChange={onToggle}
			// unmountOnExit: пока item свёрнут, его логи НЕ висят в DOM. Это главное лекарство
			// от зависания — рендерятся только строки логов раскрытых элементов.
			slotProps={{ transition: { unmountOnExit: true } }}
			sx={{
				border: '1px solid',
				borderColor,
				'&:not(:last-child)': { borderBottom: 0 },
				'&::before': { display: 'none' },
				ml: 0,
			}}
		>
			<AccordionSummary
				expandIcon={<ChevronDown size={14} />}
				sx={{
					flexDirection: 'row-reverse',
					minHeight: 34,
					bgcolor: hasError
						? 'rgba(248,81,73,0.06)'
						: isRunning
						? 'rgba(88,166,255,0.04)'
						: isQueued
						? 'rgba(139,148,158,0.04)'
						: 'background.paper',
					'& .MuiAccordionSummary-content': { alignItems: 'center', gap: 1, ml: 0.75, overflow: 'hidden' },
				}}
			>
				{isRunning ? (
					<Loader size={13} style={{ color: '#58a6ff', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
				) : isQueued ? (
					<Clock size={13} style={{ color: '#8b949e', flexShrink: 0 }} />
				) : hasError ? (
					<AlertCircle size={13} style={{ color: '#f85149', flexShrink: 0 }} />
				) : group.status === 'aborted' ? (
					<X size={13} style={{ color: '#8b949e', flexShrink: 0 }} />
				) : (
					<CheckCircle size={13} style={{ color: '#3fb950', flexShrink: 0 }} />
				)}

				<Typography noWrap sx={{ fontFamily: 'Consolas, monospace', fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0 }}>
					{group.itemName}
				</Typography>

				<Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
					{stepSquares}
				</Stack>

				{group.steps.length > 0 && (
					<Box sx={{ width: 60, flexShrink: 0 }}>
						<LinearProgress
							variant="determinate"
							value={pct}
							sx={{
								height: 4,
								borderRadius: 2,
								bgcolor: 'rgba(255,255,255,0.08)',
								'& .MuiLinearProgress-bar': {
									bgcolor: hasError ? '#f85149' : isRunning ? '#58a6ff' : '#3fb950',
								},
							}}
						/>
					</Box>
				)}

				{group.steps.length > 0 && (
					<Typography sx={{ fontSize: 10, color: 'text.disabled', minWidth: 28, textAlign: 'right' }}>
						{pct}%
					</Typography>
				)}

				<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, color: 'text.disabled', flexShrink: 0 }}>
					<Clock size={10} />
					<Typography sx={{ fontSize: 10, fontFamily: 'Consolas, monospace' }}>{time}</Typography>
				</Box>

				{group.totalCost !== undefined && (
					<Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
						<Typography sx={{ fontSize: 10, fontFamily: 'Consolas, monospace', fontWeight: 600, color: '#3fb950' }}>
							{fmtCost(group.totalCost)}
						</Typography>
					</Box>
				)}

				{hasError && (
					<Chip label={group.errorCount} size="small" sx={{ height: 16, fontSize: 10, bgcolor: 'rgba(248,81,73,0.2)', color: '#f85149', flexShrink: 0 }} />
				)}
				{group.warnCount > 0 && (
					<Chip label={group.warnCount} size="small" sx={{ height: 16, fontSize: 10, bgcolor: 'rgba(210,153,34,0.2)', color: '#d29922', flexShrink: 0 }} />
				)}
			</AccordionSummary>

			<AccordionDetails
				sx={{
					p: '6px 8px',
					borderTop: '1px solid',
					borderColor: 'divider',
					bgcolor: 'background.default',
				}}
			>
				{/* Логи item-уровня (без stepId) */}
				{itemLevelLogs.length > 0 && (
					<Box sx={{ mb: 0.5 }}>
						{itemLevelLogs.map((e) => <LogLine key={e.id} entry={e} />)}
					</Box>
				)}

				{group.steps.length === 0 ? (
					<Typography variant="caption" sx={{ color: 'text.disabled' }}>Шаги не определены</Typography>
				) : (
					group.steps.map((step) => (
						<StepRow
							key={step.stepId}
							step={step}
							levelFilter={levelFilter}
							sourceFilter={sourceFilter}
							search={search}
						/>
					))
				)}
			</AccordionDetails>
		</Accordion>
	);
});

// ── ProjectGroup — проект (уровень 2) ─────────────────────────────────────────

interface ProjectGroupProps {
	projectName: string;
	items: ProcessingItemGroup[];
	expandedItems: Set<string>;
	onToggleItem: (id: string) => void;
	levelFilter: Set<string>;
	sourceFilter: 'all' | 'main' | 'renderer';
	search: string;
}

function ProjectGroup({ projectName, items, expandedItems, onToggleItem, levelFilter, sourceFilter, search }: ProjectGroupProps) {
	const [open, setOpen] = useState(true);
	const hasError = items.some((g) => g.errorCount > 0);
	const isRunning = items.some((g) => g.status === 'running');

	return (
		<Box sx={{ mb: '1px' }}>
			{/* Заголовок проекта */}
			<Box
				onClick={() => setOpen((v) => !v)}
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: 0.75,
					px: 1.5,
					py: '5px',
					cursor: 'pointer',
					bgcolor: 'rgba(255,255,255,0.03)',
					borderBottom: '1px solid',
					borderColor: 'divider',
					'&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
				}}
			>
				{open ? <ChevronDown size={12} style={{ color: '#666' }} /> : <ChevronRight size={12} style={{ color: '#666' }} />}
				<Folder size={12} style={{ color: isRunning ? '#58a6ff' : hasError ? '#f85149' : '#8b949e', flexShrink: 0 }} />
				<Typography sx={{ fontFamily: 'Consolas, monospace', fontSize: 12, fontWeight: 600, color: 'text.secondary', flex: 1 }}>
					{projectName}
				</Typography>
				<Chip label={items.length} size="small" sx={{ height: 16, fontSize: 10 }} />
				{hasError && <Chip label={`${items.filter(g => g.errorCount > 0).length} err`} size="small" sx={{ height: 16, fontSize: 10, bgcolor: 'rgba(248,81,73,0.2)', color: '#f85149' }} />}
			</Box>

			{open && (
				<Box sx={{ pl: 1.5 }}>
					{items.map((g) => (
						<ItemAccordion
							key={g.itemId}
							group={g}
							expanded={expandedItems.has(g.itemId)}
							onToggle={() => onToggleItem(g.itemId)}
							levelFilter={levelFilter}
							sourceFilter={sourceFilter}
							search={search}
						/>
					))}
				</Box>
			)}
		</Box>
	);
}

// ── MainFolderGroup — главная папка (уровень 1) ───────────────────────────────

interface MainFolderGroupProps {
	mainFolderName: string;
	projects: Map<string, ProcessingItemGroup[]>;
	expandedItems: Set<string>;
	onToggleItem: (id: string) => void;
	levelFilter: Set<string>;
	sourceFilter: 'all' | 'main' | 'renderer';
	search: string;
}

function MainFolderGroup({ mainFolderName, projects, expandedItems, onToggleItem, levelFilter, sourceFilter, search }: MainFolderGroupProps) {
	const [open, setOpen] = useState(true);
	const allItems = Array.from(projects.values()).flat();
	const hasError = allItems.some((g) => g.errorCount > 0);
	const isRunning = allItems.some((g) => g.status === 'running');
	const total = allItems.length;

	return (
		<Box sx={{ mb: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 0.5, overflow: 'hidden' }}>
			{/* Заголовок главной папки */}
			<Box
				onClick={() => setOpen((v) => !v)}
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: 0.75,
					px: 1.5,
					py: '6px',
					cursor: 'pointer',
					bgcolor: 'background.paper',
					'&:hover': { bgcolor: 'action.hover' },
				}}
			>
				{open ? <ChevronDown size={13} style={{ color: '#888' }} /> : <ChevronRight size={13} style={{ color: '#888' }} />}
				<Folder size={13} style={{ color: isRunning ? '#58a6ff' : hasError ? '#f85149' : '#d29922', flexShrink: 0 }} />
				<Typography sx={{ fontFamily: 'Consolas, monospace', fontSize: 13, fontWeight: 700, color: 'text.primary', flex: 1 }}>
					{mainFolderName || '—'}
				</Typography>
				<Chip label={`${total} файл${total === 1 ? '' : 'а'}`} size="small" sx={{ height: 16, fontSize: 10 }} />
				{isRunning && (
					<Loader size={12} style={{ color: '#58a6ff', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
				)}
			</Box>

			{open && (
				<Box>
					{Array.from(projects.entries()).map(([proj, items]) => (
						<ProjectGroup
							key={proj}
							projectName={proj}
							items={items}
							expandedItems={expandedItems}
							onToggleItem={onToggleItem}
							levelFilter={levelFilter}
							sourceFilter={sourceFilter}
							search={search}
						/>
					))}
				</Box>
			)}
		</Box>
	);
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
	return (
		<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.75, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
			{icon}
			<Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
				{title}
			</Typography>
			<Chip label={count} size="small" sx={{ height: 16, fontSize: 10 }} />
		</Box>
	);
}

function EmptyState({ text }: { text: string }) {
	return (
		<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5, color: 'text.disabled' }}>
			<Inbox size={14} />
			<Typography variant="caption">{text}</Typography>
		</Box>
	);
}

// ── groupByHierarchy ─────────────────────────────────────────────────────────

function groupByHierarchy(list: ProcessingItemGroup[]): Map<string, Map<string, ProcessingItemGroup[]>> {
	const result = new Map<string, Map<string, ProcessingItemGroup[]>>();
	for (const g of list) {
		const mf = g.mainFolderName || '—';
		const proj = g.projectName || '—';
		if (!result.has(mf)) result.set(mf, new Map());
		const projects = result.get(mf)!;
		if (!projects.has(proj)) projects.set(proj, []);
		projects.get(proj)!.push(g);
	}
	return result;
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function LogApp() {
	const [items, setItems] = useState<ProcessingItemGroup[]>([]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [levelFilter, setLevelFilter] = useState<Set<string>>(new Set(['info', 'warn', 'error', 'debug']));
	const [sourceFilter, setSourceFilter] = useState<'all' | 'main' | 'renderer'>('all');
	const [search, setSearch] = useState('');
	const [errorsOnly, setErrorsOnly] = useState(false);

	// Вкладки: «Текущие» — горячий буфер сессии (RAM); «Архив» — лог-файлы по дням с диска.
	const [tab, setTab] = useState<'live' | 'archive'>('live');
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
	useEffect(() => () => { if (syncRaf.current != null) cancelAnimationFrame(syncRaf.current); }, []);

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
			const alreadyInStep = entry.stepId
				? group.steps.some((s) => s.logs.some((l) => l.id === entry.id))
				: false;
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

		const onNodeUpdate = (_: any, payload: { itemId: string; nodeId: string; status: StepInfo['status']; startTime?: string; endTime?: string; finalCost?: number }) => {
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
					setExpanded((prev) => { const n = new Set(prev); n.delete(payload.itemId); return n; });
				}

				// Добавляем ошибки шаблонов в конец логов
				try {
					const allErrors = await window.templates.getErrors();
					if (allErrors.length > 0) {
						const now = new Date().toISOString();
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
		if (errorsOnly && g.errorCount === 0) return false;
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
		errorItems: items.filter((g) => g.errorCount > 0).length,
		warnings: items.reduce((s, g) => s + g.warnCount, 0),
	};

	// ── Handlers ─────────────────────────────────────────────────────────────

	const handleToggleExpand = useCallback((id: string) => {
		setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
	}, []);

	const handleToggleArchiveExpand = useCallback((id: string) => {
		setArchiveExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
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
			setArchiveItems(
				(Array.isArray(groups) ? groups : []).map((g: any) => ({ ...g, itemLogs: g.itemLogs ?? [] })),
			);
		} catch {
			setArchiveItems([]);
		} finally {
			setArchiveLoading(false);
		}
	}, []);

	const handleSelectTab = useCallback((next: 'live' | 'archive') => {
		setTab(next);
		if (next === 'archive') loadArchiveDays();
	}, [loadArchiveDays]);

	const handleClearArchive = useCallback(async () => {
		const api = (window as any).electronAPI;
		await api.invoke('logs:clear-archive').catch(() => {});
		setArchiveItems([]);
		setArchiveDate(null);
		loadArchiveDays();
	}, [loadArchiveDays]);

	const handleToggleLevel = (level: string) => {
		setLevelFilter((prev) => { const n = new Set(prev); n.has(level) ? n.delete(level) : n.add(level); return n; });
	};

	const renderHierarchy = (
		hierarchy: Map<string, Map<string, ProcessingItemGroup[]>>,
		expandedSet: Set<string>,
		onToggle: (id: string) => void,
	) =>
		Array.from(hierarchy.entries()).map(([mf, projects]) => (
			<MainFolderGroup
				key={mf}
				mainFolderName={mf}
				projects={projects}
				expandedItems={expandedSet}
				onToggleItem={onToggle}
				levelFilter={levelFilter}
				sourceFilter={sourceFilter}
				search={search}
			/>
		));

	const archiveVisibleItems = archiveItems.filter((g) => !errorsOnly || g.errorCount > 0);
	const archiveFileHierarchy = groupByHierarchy(archiveVisibleItems);

	// ── Render ───────────────────────────────────────────────────────────────

	const LEVELS = [
		{ key: 'info',  label: 'Info',  color: '#58a6ff' },
		{ key: 'warn',  label: 'Warn',  color: '#d29922' },
		{ key: 'error', label: 'Error', color: '#f85149' },
		{ key: 'debug', label: 'Debug', color: '#8b949e' },
	] as const;

	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

				{/* ── Toolbar ── */}
				<Box sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
					<Stack direction="row" alignItems="center" spacing={0.75} flexWrap="nowrap">

						<Chip label={`Всего: ${stats.total}`} size="small" variant="outlined" sx={{ fontSize: 11, height: 22, flexShrink: 0 }} />
						{stats.running > 0 && (
							<Chip label={`▶ ${stats.running}`} size="small" sx={{ fontSize: 11, height: 22, flexShrink: 0, bgcolor: 'rgba(88,166,255,0.15)', color: '#58a6ff' }} />
						)}
						{stats.errorItems > 0 && (
							<Chip label={`✕ ${stats.errorItems}`} size="small" sx={{ fontSize: 11, height: 22, flexShrink: 0, bgcolor: 'rgba(248,81,73,0.15)', color: '#f85149' }} />
						)}

						<Box sx={{ borderLeft: '1px solid', borderColor: 'divider', height: 16, mx: 0.25, flexShrink: 0 }} />

						{(['all', 'main', 'renderer'] as const).map((s) => (
							<Chip
								key={s}
								label={s === 'all' ? 'Все' : s}
								size="small"
								onClick={() => setSourceFilter(s)}
								variant={sourceFilter === s ? 'filled' : 'outlined'}
								sx={{ height: 22, fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
							/>
						))}

						<Box sx={{ borderLeft: '1px solid', borderColor: 'divider', height: 16, mx: 0.25, flexShrink: 0 }} />

						{LEVELS.map(({ key, label, color }) => (
							<Chip
								key={key}
								label={label}
								size="small"
								onClick={() => handleToggleLevel(key)}
								sx={{
									height: 22, fontSize: 11, cursor: 'pointer', flexShrink: 0,
									opacity: levelFilter.has(key) ? 1 : 0.3,
									bgcolor: levelFilter.has(key) ? `${color}22` : 'transparent',
									color, border: `1px solid ${color}44`,
								}}
							/>
						))}

						<TextField
							size="small"
							placeholder="Поиск..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							sx={{ flex: 1, minWidth: 100 }}
							slotProps={{
								input: {
									startAdornment: <InputAdornment position="start"><Search size={13} /></InputAdornment>,
									endAdornment: search ? (
										<InputAdornment position="end">
											<IconButton size="small" onClick={() => setSearch('')}><X size={11} /></IconButton>
										</InputAdornment>
									) : null,
									sx: { fontSize: 12, height: 28 },
								},
							}}
						/>

						<Box sx={{ borderLeft: '1px solid', borderColor: 'divider', height: 16, mx: 0.25, flexShrink: 0 }} />

						<Tooltip title="Только с ошибками">
							<IconButton size="small" onClick={() => setErrorsOnly((v) => !v)} sx={{ color: errorsOnly ? '#f85149' : 'text.secondary', flexShrink: 0 }}>
								<AlertTriangle size={15} />
							</IconButton>
						</Tooltip>
						<Tooltip title="Экспорт TXT">
							<IconButton size="small" onClick={() => (window as any).electronAPI.invoke('log-window:export', 'txt')} sx={{ color: 'text.secondary', flexShrink: 0 }}>
								<Download size={15} />
							</IconButton>
						</Tooltip>
						<Tooltip title="Экспорт JSON">
							<IconButton size="small" onClick={() => (window as any).electronAPI.invoke('log-window:export', 'json')} sx={{ color: 'text.secondary', flexShrink: 0 }}>
								<Download size={15} />
							</IconButton>
						</Tooltip>
						{tab === 'live' ? (
							<Tooltip title="Очистить текущие">
								<IconButton size="small" onClick={() => (window as any).electronAPI.invoke('log-window:clear')} sx={{ color: 'text.secondary', flexShrink: 0 }}>
									<Trash2 size={15} />
								</IconButton>
							</Tooltip>
						) : (
							<>
								<Tooltip title="Обновить список дней">
									<IconButton size="small" onClick={loadArchiveDays} sx={{ color: 'text.secondary', flexShrink: 0 }}>
										<RefreshCw size={15} />
									</IconButton>
								</Tooltip>
								<Tooltip title="Очистить весь архив">
									<IconButton size="small" onClick={handleClearArchive} sx={{ color: 'text.secondary', flexShrink: 0 }}>
										<Trash2 size={15} />
									</IconButton>
								</Tooltip>
							</>
						)}
					</Stack>
				</Box>

				{/* ── Tabs ── */}
				<Tabs
					value={tab}
					onChange={(_, v) => handleSelectTab(v)}
					sx={{ minHeight: 34, flexShrink: 0, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', '& .MuiTab-root': { minHeight: 34, py: 0, fontSize: 12, textTransform: 'none' } }}
				>
					<Tab value="live" icon={<Zap size={13} />} iconPosition="start" label="Текущие" />
					<Tab value="archive" icon={<Archive size={13} />} iconPosition="start" label="Архив" />
				</Tabs>

				{/* ── Content ── */}
				<Box sx={{ flex: 1, overflowY: 'auto', bgcolor: 'background.default' }}>
					{tab === 'live' ? (
						items.length === 0 ? (
							<Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1, color: 'text.disabled' }}>
								<Zap size={36} style={{ opacity: 0.2 }} />
								<Typography variant="body2">Запустите обработку — логи появятся здесь</Typography>
							</Box>
						) : (
							<Box sx={{ p: 1 }}>
								{/* В обработке */}
								<SectionHeader
									icon={<Loader size={13} style={{ color: '#58a6ff', animation: activeItems.length > 0 ? 'spin 1s linear infinite' : undefined }} />}
									title="В обработке"
									count={activeItems.length}
								/>
								{activeItems.length === 0
									? <EmptyState text="Нет активных задач" />
									: <Box sx={{ mt: 0.5, mb: 1 }}>{renderHierarchy(activeHierarchy, expanded, handleToggleExpand)}</Box>}

								{/* Завершено в этой сессии (RAM) */}
								<SectionHeader
									icon={<Inbox size={13} style={{ color: '#8b949e' }} />}
									title="Завершено (сессия)"
									count={sessionDoneItems.length}
								/>
								{sessionDoneItems.length === 0
									? <EmptyState text="Завершённые задачи появятся здесь, полная история — во вкладке «Архив»" />
									: <Box sx={{ mt: 0.5 }}>{renderHierarchy(sessionDoneHierarchy, expanded, handleToggleExpand)}</Box>}
							</Box>
						)
					) : (
						/* ── Archive tab ── */
						<Box sx={{ p: 1 }}>
							{archiveDays.length === 0 ? (
								<Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, color: 'text.disabled', py: 6 }}>
									<Archive size={36} style={{ opacity: 0.2 }} />
									<Typography variant="body2">Архив пуст — завершённые обработки сохраняются сюда по дням</Typography>
								</Box>
							) : (
								<>
									{/* Список дней */}
									<Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
										{archiveDays.map((d) => (
											<Chip
												key={d.date}
												icon={<CalendarDays size={13} />}
												label={`${d.date} · ${d.items} · ${fmtBytes(d.bytes)}`}
												size="small"
												onClick={() => openArchiveDay(d.date)}
												variant={archiveDate === d.date ? 'filled' : 'outlined'}
												sx={{ fontSize: 11, height: 24, cursor: 'pointer' }}
											/>
										))}
									</Stack>

									{archiveLoading ? (
										<Box sx={{ px: 1 }}><LinearProgress sx={{ height: 3 }} /></Box>
									) : archiveDate == null ? (
										<EmptyState text="Выберите день, чтобы открыть логи" />
									) : archiveVisibleItems.length === 0 ? (
										<EmptyState text="За этот день записей нет" />
									) : (
										<Box sx={{ mt: 0.5 }}>{renderHierarchy(archiveFileHierarchy, archiveExpanded, handleToggleArchiveExpand)}</Box>
									)}
								</>
							)}
						</Box>
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
