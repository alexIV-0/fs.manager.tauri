// renderer-logger.ts
import { ipcRenderer } from 'electron';

const getCallerInfo = () => {
	try {
		const error = new Error();
		const stack = error.stack?.split('\n') || [];

		// Ищем вызывающий код (пропускаем строки с renderer-logger.ts)
		for (let i = 3; i < stack.length; i++) {
			const callerLine = stack[i].trim();

			// Пропускаем строки из самого логгера
			if (
				callerLine.includes('renderer-logger.ts') ||
				callerLine.includes('sendLog') ||
				callerLine.includes('getCallerInfo')
			) {
				continue;
			}

			// Парсим информацию о файле и строке
			// Формат примерно: at functionName (file:///path/to/file.js:10:20)
			const match = callerLine.match(/\(?(.+):(\d+):(\d+)\)?$/);
			if (match) {
				const filePath = match[1];
				const fileName = filePath.split('/').pop() || filePath;
				return {
					file: fileName,
					line: parseInt(match[2]),
					column: parseInt(match[3]),
					fullPath: filePath,
				};
			}
		}
	} catch (e) {
		// Игнорируем ошибки при получении стека
	}
	return null;
};

// Вспомогательные функции
// function sendLog(level: string, message: string, meta?: any) {
// 	try {
// 		const callerInfo = getCallerInfo();
// 		ipcRenderer.send('renderer-log', {
// 			level,
// 			message,
// 			meta,
// 			callerInfo,
// 			timestamp: new Date().toISOString(),
// 		});
// 	} catch (error) {
// 		console.error('Failed to send log to main process:', error);
// 	}
// }
function sendLog(level: string, message: string, meta?: any) {
	try {
		const callerInfo = getCallerInfo();
		const payload = {
			level,
			message,
			meta,
			callerInfo,
			timestamp: new Date().toISOString(),
		};

		// 🔴 Временный лог: проверим, что отправляется
		console.warn('📤 Отправляю в main:', payload);

		ipcRenderer.send('renderer-log', payload);
	} catch (error) {
		// 🔴 Временный лог: поймаем ошибку
		console.error('💥 Ошибка отправки лога:', error, 'при сообщении:', message);
	}
}

function sendGroupStart(label: string, collapsed: boolean) {
	try {
		const callerInfo = getCallerInfo();
		ipcRenderer.send('renderer-group-start', {
			label,
			collapsed,
			callerInfo,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error('Failed to send group start:', error);
	}
}

function sendGroupEnd() {
	try {
		ipcRenderer.send('renderer-group-end', {
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error('Failed to send group end:', error);
	}
}

// Простая обертка для отправки логов в main процесс
// export const rendererLogger = {
// 	info: (message: string, meta?: any) => {
// 		console.warn('✅ rendererLogger.info вызван:', message); // ← временный лог
// 		const callerInfo = getCallerInfo();
// 		ipcRenderer.send('renderer-log', {
// 			level: 'info',
// 			message,
// 			meta,
// 			callerInfo,
// 			timestamp: new Date().toISOString(),
// 		});
// 		console.log(
// 			`%c[INFO]%c ${message}`,
// 			'background: #004b6b; color: #4fc1ff; padding: 2px 4px; border-radius: 3px;',
// 			'color: inherit',
// 			meta || ''
// 		);
// 	},

// 	warn: (message: string, meta?: any) => {
// 		const callerInfo = getCallerInfo();
// 		ipcRenderer.send('renderer-log', {
// 			level: 'warn',
// 			message,
// 			meta,
// 			callerInfo,
// 			timestamp: new Date().toISOString(),
// 		});
// 		console.warn(
// 			`%c[WARN]%c ${message}`,
// 			'background: #664400; color: #ffcc00; padding: 2px 4px; border-radius: 3px;',
// 			'color: inherit',
// 			meta || ''
// 		);
// 	},

// 	error: (message: string | Error, meta?: any) => {
// 		const callerInfo = getCallerInfo();
// 		if (message instanceof Error) {
// 			ipcRenderer.send('renderer-log', {
// 				level: 'error',
// 				message: message.message,
// 				meta: { ...meta, stack: message.stack },
// 				callerInfo,
// 				timestamp: new Date().toISOString(),
// 			});
// 			console.error(
// 				`%c[ERROR]%c ${message.message}`,
// 				'background: #5c2a2a; color: #f48771; padding: 2px 4px; border-radius: 3px;',
// 				'color: inherit',
// 				meta || '',
// 				message.stack
// 			);
// 		} else {
// 			ipcRenderer.send('renderer-log', {
// 				level: 'error',
// 				message,
// 				meta,
// 				callerInfo,
// 				timestamp: new Date().toISOString(),
// 			});
// 			console.error(
// 				`%c[ERROR]%c ${message}`,
// 				'background: #5c2a2a; color: #f48771; padding: 2px 4px; border-radius: 3px;',
// 				'color: inherit',
// 				meta || ''
// 			);
// 		}
// 	},

// 	debug: (message: string, meta?: any) => {
// 		const callerInfo = getCallerInfo();
// 		ipcRenderer.send('renderer-log', {
// 			level: 'debug',
// 			message,
// 			meta,
// 			callerInfo,
// 			timestamp: new Date().toISOString(),
// 		});
// 		console.debug(
// 			`%c[DEBUG]%c ${message}`,
// 			'background: #2a523a; color: #b5cea8; padding: 2px 4px; border-radius: 3px;',
// 			'color: inherit',
// 			meta || ''
// 		);
// 	},

// 	// Универсальный метод
// 	log: (level: 'info' | 'warn' | 'error' | 'debug' | 'verbose' | 'silly', message: string, meta?: any) => {
// 		const callerInfo = getCallerInfo();
// 		ipcRenderer.send('renderer-log', {
// 			level,
// 			message,
// 			meta,
// 			callerInfo,
// 			timestamp: new Date().toISOString(),
// 		});

// 		const styles: Record<string, string> = {
// 			info: 'background: #004b6b; color: #4fc1ff',
// 			warn: 'background: #664400; color: #ffcc00',
// 			error: 'background: #5c2a2a; color: #f48771',
// 			debug: 'background: #2a523a; color: #b5cea8',
// 			verbose: 'background: #2a2a5c; color: #ba8cff',
// 			silly: 'background: #5c2a5c; color: #ff8cff',
// 		};

// 		console.log(
// 			`%c[${level.toUpperCase()}]%c ${message}`,
// 			`${styles[level] || styles.info}; padding: 2px 4px; border-radius: 3px;`,
// 			'color: inherit',
// 			meta || ''
// 		);
// 	},

// 	group: (label: string) => {
// 		sendGroupStart(label, false);
// 		console.group(label);
// 	},

// 	groupCollapsed: (label: string) => {
// 		sendGroupStart(label, true);
// 		console.groupCollapsed(label);
// 	},

// 	groupEnd: () => {
// 		sendGroupEnd();
// 		console.groupEnd();
// 	},

// 	startTask: (label: string): number => {
// 		const timestamp = Date.now();
// 		const callerInfo = getCallerInfo();
// 		ipcRenderer.send('renderer-log', {
// 			level: 'info',
// 			message: `↻ ${label}...`,
// 			meta: null,
// 			callerInfo,
// 			timestamp: new Date().toISOString(),
// 		});
// 		console.log(`%c↻%c ${label}...`, 'color: #4fc1ff; font-weight: bold;', 'color: inherit');
// 		return timestamp;
// 	},

// 	endTask: (startTime: number, success = true) => {
// 		const duration = Date.now() - startTime;
// 		const icon = success ? '✓' : '✗';
// 		const level = success ? 'info' : 'error';
// 		const color = success ? (duration > 1000 ? '#ffcc00' : '#6a9955') : '#f48771';

// 		const callerInfo = getCallerInfo();
// 		ipcRenderer.send('renderer-log', {
// 			level,
// 			message: `${icon} ${duration}ms`,
// 			meta: { duration },
// 			callerInfo,
// 			timestamp: new Date().toISOString(),
// 		});

// 		console.log(`%c${icon}%c ${duration}ms`, `color: ${color}; font-weight: bold;`, 'color: inherit');
// 	},
// };
export const rendererLogger = {
	log: (...args: any[]) => {
		window.electronAPI.sendRendererLog({ level: 'info', message: args.join(' ') });
		console.log(...args);
	},
	info: (...args: any[]) => {
		window.electronAPI.sendRendererLog({ level: 'info', message: args.join(' ') });
		console.info(...args);
	},
	warn: (...args: any[]) => {
		window.electronAPI.sendRendererLog({ level: 'warn', message: args.join(' ') });
		console.warn(...args);
	},
	error: (...args: any[]) => {
		window.electronAPI.sendRendererLog({ level: 'error', message: args.join(' ') });
		console.error(...args);
	},
	debug: (...args: any[]) => {
		window.electronAPI.sendRendererLog({ level: 'debug', message: args.join(' ') });
		console.debug(...args);
	},
};
