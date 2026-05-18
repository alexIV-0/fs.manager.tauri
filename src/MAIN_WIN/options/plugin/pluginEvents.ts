// pluginEvents.ts
type EventCallback = (pluginName: string) => void;

class PluginEventEmitter {
	private listeners: { [key: string]: EventCallback[] } = {};

	on(event: string, callback: EventCallback) {
		if (!this.listeners[event]) {
			this.listeners[event] = [];
		}
		this.listeners[event].push(callback);
	}

	emit(event: string, pluginName: string) {
		if (this.listeners[event]) {
			this.listeners[event].forEach((callback) => callback(pluginName));
		}
	}

	off(event: string, callback: EventCallback) {
		if (this.listeners[event]) {
			this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
		}
	}
}

export const pluginEvents = new PluginEventEmitter();
