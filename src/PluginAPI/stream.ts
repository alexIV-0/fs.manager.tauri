// Полифил node:stream — заглушки.
// В наших плагинах активно не используются; Readable импортируется в одном месте.
// Если плагин действительно работает с потоками — стоит пересобрать его без stream-API.

import { EventEmitter } from './events';

export class Readable extends EventEmitter {
	readable = true;
	private buffered: any[] = [];

	push(chunk: any): boolean {
		if (chunk === null) {
			this.emit('end');
			return false;
		}
		this.buffered.push(chunk);
		this.emit('data', chunk);
		return true;
	}

	read(): any {
		return this.buffered.shift();
	}

	pipe<T extends Writable>(dest: T): T {
		this.on('data', (chunk) => dest.write(chunk));
		this.on('end', () => dest.end());
		return dest;
	}

	on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener) as this;
	}
}

export class Writable extends EventEmitter {
	writable = true;

	write(chunk: any): boolean {
		this.emit('drain', chunk);
		return true;
	}

	end(chunk?: any): void {
		if (chunk !== undefined) this.write(chunk);
		this.emit('finish');
	}
}

export class Transform extends Readable {}

export class PassThrough extends Transform {}

export const pipeline = async (...streams: any[]): Promise<void> => {
	// Простая последовательная склейка
	for (let i = 0; i < streams.length - 1; i++) {
		if (streams[i]?.pipe) streams[i].pipe(streams[i + 1]);
	}
};

export default { Readable, Writable, Transform, PassThrough, pipeline };
