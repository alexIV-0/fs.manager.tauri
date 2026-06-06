// ===============================================================================
// чистим очередь просчета от всех композиций, которые там есть
// ===============================================================================
export function clearRenderQueue() {
	var renderQueue = app.project.renderQueue;
	// Проверяем, есть ли элементы в очереди
	if (renderQueue.items.length > 0) {
		// Удаляем все элементы из очереди
		while (renderQueue.items.length > 0) {
			renderQueue.items[1].remove();
		}
	}
}
