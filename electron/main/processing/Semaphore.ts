export class Semaphore {
	private slots: number;
	private queue: Array<() => void> = [];

	constructor(maxConcurrent: number) {
		this.slots = maxConcurrent;
	}

	acquire(): Promise<void> {
		if (this.slots > 0) {
			this.slots--;
			return Promise.resolve();
		}
		return new Promise((resolve) => this.queue.push(resolve));
	}

	release(): void {
		if (this.queue.length > 0) {
			this.queue.shift()!();
		} else {
			this.slots++;
		}
	}
}
