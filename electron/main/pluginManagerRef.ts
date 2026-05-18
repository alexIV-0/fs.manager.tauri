import type { PluginManager } from './PluginManager';

// Единственная ссылка на PluginManager для всего main-процесса.
// index.ts устанавливает её после инициализации,
// остальные модули (processItem и т.д.) читают через getPluginManager().
let instance: PluginManager | null = null;

export function setPluginManager(pm: PluginManager) {
	instance = pm;
}

export function getPluginManager(): PluginManager {
	if (!instance) throw new Error('PluginManager is not initialized yet');
	return instance;
}
