// Полифил node:events.EventEmitter — простая browser-совместимая реализация.

export class EventEmitter {
	private listeners: Map<string, Array<(...args: any[]) => void>> = new Map();
	private maxListeners = 10;

	on(event: string, listener: (...args: any[]) => void): this {
		if (!this.listeners.has(event)) this.listeners.set(event, []);
		this.listeners.get(event)!.push(listener);
		return this;
	}
	addListener = this.on;

	once(event: string, listener: (...args: any[]) => void): this {
		const wrapped = (...args: any[]) => {
			this.off(event, wrapped);
			listener(...args);
		};
		return this.on(event, wrapped);
	}

	off(event: string, listener: (...args: any[]) => void): this {
		const arr = this.listeners.get(event);
		if (!arr) return this;
		const idx = arr.indexOf(listener);
		if (idx !== -1) arr.splice(idx, 1);
		return this;
	}
	removeListener = this.off;

	removeAllListeners(event?: string): this {
		if (event) this.listeners.delete(event);
		else this.listeners.clear();
		return this;
	}

	emit(event: string, ...args: any[]): boolean {
		const arr = this.listeners.get(event);
		if (!arr || arr.length === 0) return false;
		// Копия массива на случай мутации в обработчике
		[...arr].forEach((fn) => {
			try {
				fn(...args);
			} catch (e) {
				console.error(`[EventEmitter] listener for "${event}" threw:`, e);
			}
		});
		return true;
	}

	listenerCount(event: string): number {
		return this.listeners.get(event)?.length ?? 0;
	}

	rawListeners(event: string): Array<(...args: any[]) => void> {
		return [...(this.listeners.get(event) ?? [])];
	}

	setMaxListeners(n: number): this {
		this.maxListeners = n;
		return this;
	}

	getMaxListeners(): number {
		return this.maxListeners;
	}

	eventNames(): string[] {
		return Array.from(this.listeners.keys());
	}
}

export default EventEmitter;
