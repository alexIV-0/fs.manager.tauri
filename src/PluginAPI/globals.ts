// Глобальные полифилы для Node-объектов, которые плагины используют как globals
// (а не через import): `process`, `Buffer`.
// Вызывается из initTauriAPI() при старте приложения, до загрузки любого плагина.

export function installGlobalPolyfills(): void {
	const g = globalThis as any;

	// ─── process ────────────────────────────────────────────────────────────
	if (!g.process) {
		const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') ?? '';
		let platform: 'darwin' | 'win32' | 'linux' = 'linux';
		if (ua.includes('Windows')) platform = 'win32';
		else if (ua.includes('Mac')) platform = 'darwin';

		g.process = {
			platform,
			arch: ua.includes('arm64') || ua.includes('aarch64') ? 'arm64' : 'x64',
			env: {},
			cwd: () => '/',
			version: 'v20.0.0', // Не реальный Node — но кому надо для проверок типа `>= v18`
			versions: { node: '20.0.0' },
			nextTick: (fn: (...args: any[]) => void, ...args: any[]) =>
				Promise.resolve().then(() => fn(...args)),
			argv: [],
			stdout: { write: (s: string) => console.log(s) },
			stderr: { write: (s: string) => console.error(s) },
		};
	}

	// ─── Buffer ─────────────────────────────────────────────────────────────
	// Полностью эмулировать Node.Buffer тяжело; нам нужен минимум:
	// - allocUnsafe(n) → Uint8Array длины n (используется в nanoid)
	// - from(input) → Uint8Array (string → UTF-8 bytes; array → Uint8Array)
	// - isBuffer(v) → v instanceof Uint8Array
	if (!g.Buffer) {
		const BufferImpl: any = function (input: any, encoding?: string) {
			return BufferImpl.from(input, encoding);
		};
		BufferImpl.allocUnsafe = (n: number) => new Uint8Array(n);
		BufferImpl.alloc = (n: number) => new Uint8Array(n);
		BufferImpl.from = (input: any, encoding?: string) => {
			if (typeof input === 'string') {
				if (encoding === 'hex') {
					const bytes = new Uint8Array(input.length / 2);
					for (let i = 0; i < bytes.length; i++) {
						bytes[i] = parseInt(input.substr(i * 2, 2), 16);
					}
					return bytes;
				}
				if (encoding === 'base64') {
					const bin = atob(input);
					const arr = new Uint8Array(bin.length);
					for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
					return arr;
				}
				return new TextEncoder().encode(input);
			}
			if (input instanceof Uint8Array) return input;
			if (Array.isArray(input)) return new Uint8Array(input);
			if (input instanceof ArrayBuffer) return new Uint8Array(input);
			throw new TypeError(`Buffer.from: unsupported input type`);
		};
		BufferImpl.concat = (arr: Uint8Array[], total?: number) => {
			const len = total ?? arr.reduce((s, a) => s + a.length, 0);
			const out = new Uint8Array(len);
			let off = 0;
			for (const a of arr) {
				out.set(a, off);
				off += a.length;
			}
			return out;
		};
		BufferImpl.isBuffer = (v: any) => v instanceof Uint8Array;
		BufferImpl.byteLength = (s: string, enc?: string) => {
			if (enc === 'hex') return s.length / 2;
			if (enc === 'base64') return Math.floor((s.length * 3) / 4);
			return new TextEncoder().encode(s).length;
		};

		g.Buffer = BufferImpl;
	}

	// ─── global ─────────────────────────────────────────────────────────────
	if (!g.global) {
		g.global = g;
	}
}
