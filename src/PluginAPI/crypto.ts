// Полифил node:crypto для renderer'а.
// createHash — через SubtleCrypto. Возвращает похожий на Node Hash объект (chainable),
// но методы (digest) — async. Плагин должен `await hash.digest(...)`.

const subtle = (typeof globalThis !== 'undefined' ? globalThis.crypto?.subtle : undefined);

type HashAlgo = 'sha1' | 'sha256' | 'sha384' | 'sha512' | 'md5';

const ALGO_MAP: Record<string, string> = {
	sha1: 'SHA-1',
	sha256: 'SHA-256',
	sha384: 'SHA-384',
	sha512: 'SHA-512',
};

function toHex(buf: ArrayBuffer): string {
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function toBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return btoa(s);
}

export class Hash {
	private algo: HashAlgo;
	private chunks: Uint8Array[] = [];

	constructor(algo: HashAlgo) {
		this.algo = algo;
	}

	update(data: string | ArrayBuffer | Uint8Array): this {
		let bytes: Uint8Array;
		if (typeof data === 'string') {
			bytes = new TextEncoder().encode(data);
		} else if (data instanceof Uint8Array) {
			bytes = data;
		} else {
			bytes = new Uint8Array(data);
		}
		this.chunks.push(bytes);
		return this;
	}

	async digest(encoding: 'hex' | 'base64' = 'hex'): Promise<string> {
		if (!subtle) throw new Error('crypto.subtle not available in this environment');
		const algoName = ALGO_MAP[this.algo];
		if (!algoName) throw new Error(`Unsupported hash algorithm: ${this.algo}`);

		// Объединяем chunks
		const total = this.chunks.reduce((s, c) => s + c.length, 0);
		const merged = new Uint8Array(total);
		let offset = 0;
		for (const c of this.chunks) {
			merged.set(c, offset);
			offset += c.length;
		}

		const buf = await subtle.digest(algoName, merged);
		return encoding === 'base64' ? toBase64(buf) : toHex(buf);
	}
}

export function createHash(algorithm: string): Hash {
	const algo = algorithm.toLowerCase() as HashAlgo;
	return new Hash(algo);
}

// node:crypto.randomBytes — через WebCrypto
export function randomBytes(size: number): Uint8Array {
	const arr = new Uint8Array(size);
	globalThis.crypto.getRandomValues(arr);
	return arr;
}

export function randomUUID(): string {
	if (typeof globalThis.crypto?.randomUUID === 'function') {
		return globalThis.crypto.randomUUID();
	}
	// Fallback
	return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c: any) =>
		(c ^ (randomBytes(1)[0] & (15 >> (c / 4)))).toString(16),
	);
}

// webcrypto — re-export браузерного crypto
export const webcrypto = globalThis.crypto;

export default { createHash, randomBytes, randomUUID, webcrypto, Hash };
