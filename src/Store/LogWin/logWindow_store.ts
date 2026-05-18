import { create } from 'zustand';

export interface LogEntry {
	level: 'info' | 'warn' | 'error' | 'debug';
	message: string;
	meta?: any;
	timestamp: number;
}

export interface LogStats {
	total: number;
	errors: number;
	warnings: number;
	infos: number;
	debugs: number;
}

interface LogWindowStore {
	logs: LogEntry[];
	stats: LogStats;
	filter: string;
	autoScroll: boolean;
	
	addLog: (log: LogEntry) => void;
	setLogs: (logs: LogEntry[]) => void;
	setStats: (stats: LogStats) => void;
	setFilter: (filter: string) => void;
	toggleAutoScroll: () => void;
	clearLogs: () => void;
}

export const logWindowStore = create<LogWindowStore>((set) => ({
	logs: [],
	stats: { total: 0, errors: 0, warnings: 0, infos: 0, debugs: 0 },
	filter: 'all',
	autoScroll: true,

	addLog: (log) => set((state) => ({
		logs: [...state.logs, log].slice(-10000), // Максимум 10000 логов
		stats: {
			...state.stats,
			total: state.stats.total + 1,
			[log.level === 'error' ? 'errors' : log.level === 'warn' ? 'warnings' : log.level === 'info' ? 'infos' : 'debugs']: 
				state.stats[log.level === 'error' ? 'errors' : log.level === 'warn' ? 'warnings' : log.level === 'info' ? 'infos' : 'debugs'] + 1,
		},
	})),

	setLogs: (logs) => set({ logs }),
	setStats: (stats) => set({ stats }),
	setFilter: (filter) => set({ filter }),
	toggleAutoScroll: () => set((state) => ({ autoScroll: !state.autoScroll })),
	clearLogs: () => set({ 
		logs: [], 
		stats: { total: 0, errors: 0, warnings: 0, infos: 0, debugs: 0 } 
	}),
}));
