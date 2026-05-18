// logger.ts - универсальный логгер для main и renderer
import { ipcRenderer, ipcMain } from 'electron';
import chalk from 'chalk';

// Лениво читаем размер буфера из настроек. В renderer app недоступен — используем фолбэк.
function readBufferSize(): number {
	try {
		// Импорт внутри функции, чтобы не падать в renderer, где нет fs/path
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { readAppSettings } = require('./settings/appSettings');
		return readAppSettings().logging.bufferSize;
	} catch {
		return 5000;
	}
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'group' | 'groupCollapsed' | 'groupEnd' | 'startTask' | 'endTask';

export interface LogEvent {
	level: LogLevel;
	message?: string;
	meta?: any;
	timestamp: number;
	source: 'main' | 'renderer';
}

// ====== Логгер для main ======
class LogService {
	private history: LogEvent[] = [];

	add(event: LogEvent) {
		this.history.push(event);
		// Ограничиваем историю: читаем лимит из настроек, при переполнении режем вдвое
		const max = readBufferSize();
		if (this.history.length > max) this.history = this.history.slice(-Math.floor(max / 2));

		// Выводим в консоль с цветами
		if (event.source === 'main') {
			const msg = `[${event.level.toUpperCase()}] ${event.message || ''}`;
			switch (event.level) {
				case 'error':
					console.error(chalk.red(msg), event.meta);
					break;
				case 'warn':
					console.warn(chalk.yellow(msg), event.meta);
					break;
				case 'debug':
					console.debug(chalk.gray(msg), event.meta);
					break;
				default:
					console.log(chalk.cyan(msg), event.meta);
					break;
			}
		}

		// Можно отправлять на окно логов через IPC
		if (typeof ipcMain !== 'undefined') {
			// пример: ipcMain.emit('log-window:new-log', event)
		}
	}

	getHistory() {
		return [...this.history];
	}
}

export const logService = new LogService();

// ====== Универсальный API для main/renderer ======
class Logger {
	private source: 'main' | 'renderer';

	constructor(source: 'main' | 'renderer') {
		this.source = source;
	}

	private emit(level: LogLevel, message?: string, meta?: any) {
		const event: LogEvent = {
			level,
			message,
			meta,
			timestamp: Date.now(),
			source: this.source,
		};

		if (this.source === 'renderer' && typeof ipcRenderer !== 'undefined') {
			ipcRenderer.send('log:emit', event);
		} else {
			logService.add(event);
		}
	}

	info(msg: string, meta?: any) {
		this.emit('info', msg, meta);
	}
	warn(msg: string, meta?: any) {
		this.emit('warn', msg, meta);
	}
	error(msg: string | Error, meta?: any) {
		if (msg instanceof Error) {
			this.emit('error', msg.message, { ...meta, stack: msg.stack });
		} else {
			this.emit('error', msg, meta);
		}
	}
	debug(msg: string, meta?: any) {
		this.emit('debug', msg, meta);
	}

	group(label: string) {
		this.emit('group', label);
	}
	groupCollapsed(label: string) {
		this.emit('groupCollapsed', label);
	}
	groupEnd() {
		this.emit('groupEnd');
	}

	startTask(label: string) {
		const start = Date.now();
		this.emit('startTask', label);
		return start;
	}
	endTask(startTime: number, success = true) {
		const duration = Date.now() - startTime;
		this.emit('endTask', undefined, { duration, success });
	}
}

// ====== Экспортируем экземпляры ======
export const log = new Logger('main'); // main процесс
export function createRendererLogger() {
	return new Logger('renderer'); // renderer процесс
}
