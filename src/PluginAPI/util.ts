// Полифил node:util — минимальный набор.

export function promisify<T extends (...args: any[]) => any>(fn: T): (...args: any[]) => Promise<any> {
	return function (this: any, ...args: any[]) {
		return new Promise((resolve, reject) => {
			fn.call(this, ...args, (err: any, result: any) => {
				if (err) reject(err);
				else resolve(result);
			});
		});
	};
}

export function callbackify<T extends (...args: any[]) => Promise<any>>(fn: T): (...args: any[]) => void {
	return function (this: any, ...args: any[]) {
		const callback = args.pop();
		fn.call(this, ...args).then(
			(result) => callback(null, result),
			(err) => callback(err),
		);
	};
}

export function inherits(ctor: any, superCtor: any): void {
	Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

export function format(fmt: string, ...args: any[]): string {
	let i = 0;
	return fmt.replace(/%[sdjifoO%]/g, (m) => {
		if (m === '%%') return '%';
		const v = args[i++];
		if (m === '%s') return String(v);
		if (m === '%d' || m === '%i') return String(Math.trunc(Number(v)));
		if (m === '%f') return String(Number(v));
		if (m === '%j' || m === '%o' || m === '%O') return JSON.stringify(v);
		return m;
	});
}

export function inspect(obj: any): string {
	try {
		return JSON.stringify(obj, null, 2);
	} catch {
		return String(obj);
	}
}

export const types = {
	isPromise: (v: any) => v && typeof v.then === 'function',
	isMap: (v: any) => v instanceof Map,
	isSet: (v: any) => v instanceof Set,
	isDate: (v: any) => v instanceof Date,
	isRegExp: (v: any) => v instanceof RegExp,
};

export default { promisify, callbackify, inherits, format, inspect, types };
