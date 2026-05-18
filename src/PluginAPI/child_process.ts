// Полифил node:child_process для renderer'а.
// exec/spawn возвращают Promise — плагины должны использовать `await`.

const api = () => (window as any).electronAPI;

export interface ExecResult {
	stdout: string;
	stderr: string;
}

interface ExecOptions {
	cwd?: string;
	env?: Record<string, string>;
	maxBuffer?: number;
	timeout?: number;
}

/**
 * Аналог node:child_process.exec — выполняет команду в шелле.
 * В Node возвращал ChildProcess + callback; здесь — Promise<{stdout, stderr}>.
 */
export async function exec(
	command: string,
	options?: ExecOptions | ((err: any, stdout: string, stderr: string) => void),
	callback?: (err: any, stdout: string, stderr: string) => void,
): Promise<ExecResult> {
	const opts = typeof options === 'function' ? undefined : options;
	const cb = typeof options === 'function' ? options : callback;

	try {
		// execCommand принимает { cmd, args, cwd, env }. Парсим command-строку наивно.
		// В Node exec('foo bar "baz qux"') запускает через shell; у нас Tauri запускает напрямую.
		// Для простоты — передаём всё как одну строку через `sh -c` (Unix) или `cmd /c` (Windows).
		const isWin = (typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')) ?? false;
		const shellCmd = isWin ? 'cmd' : 'sh';
		const shellArgs = isWin ? ['/c', command] : ['-c', command];

		const result = (await api().execCommand({
			cmd: shellCmd,
			args: shellArgs,
			cwd: opts?.cwd,
			env: opts?.env ? Object.entries(opts.env) : undefined,
		})) as any;

		const stdout = (result?.stdout ?? '') as string;
		const stderr = (result?.stderr ?? '') as string;

		if (cb) cb(null, stdout, stderr);
		return { stdout, stderr };
	} catch (err: any) {
		const e = err instanceof Error ? err : new Error(String(err));
		if (cb) cb(e, '', e.message);
		throw e;
	}
}

interface SpawnOptions extends ExecOptions {
	stdio?: any;
	shell?: boolean | string;
}

/**
 * Аналог node:child_process.spawn — запускает команду без шелла.
 * Возвращает Promise (упрощённо — без потокового stdout).
 */
export async function spawn(command: string, args?: string[], options?: SpawnOptions): Promise<ExecResult> {
	try {
		const result = (await api().execCommand({
			cmd: command,
			args: args ?? [],
			cwd: options?.cwd,
			env: options?.env ? Object.entries(options.env) : undefined,
		})) as any;
		return {
			stdout: (result?.stdout ?? '') as string,
			stderr: (result?.stderr ?? '') as string,
		};
	} catch (err) {
		throw err;
	}
}

export const execSync = exec;
export const spawnSync = spawn;
export const execFile = exec;
export const execFileSync = exec;

export default { exec, execSync, spawn, spawnSync, execFile, execFileSync };
