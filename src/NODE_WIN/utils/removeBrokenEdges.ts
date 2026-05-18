/**
 * Функция для удаления "сломанных" рёбер (edges), которые ссылаются на несуществующие ноды
 * или несуществующие хендлы в этих нодах.
 * @param {Array} nodes - Массив нод (nodes) из вашего flow объекта.
 * @param {Array} edges - Массив рёбер (edges) из вашего flow объекта.
 * @returns {Array} - Новый массив рёбер без "сломанных".
 */
export function removeBrokenEdges(nodes: any[], edges: any[]) {
	// 1. Создаём Map из ID нод для быстрого поиска и доступа к данным нод

	const nodeMap = new Map();
	nodes.forEach((node) => {
		nodeMap.set(node.id, node);
	});

	// 2. Фильтруем рёбра
	const validEdges = edges.filter((edge) => {
		const sourceNode = nodeMap.get(edge.source);
		const targetNode = nodeMap.get(edge.target);

		let isValid = true;
		let issues = [];

		// Проверяем существование source ноды
		if (!sourceNode) {
			isValid = false;
			issues.push(`source node '${edge.source}' missing`);
		}
		// Проверяем существование sourceHandle в output source ноды
		else if (edge.sourceHandle && sourceNode.data?.output) {
			// Проверяем, есть ли такой ключ в output или значение с таким именем
			const outputKeys = Object.keys(sourceNode.data.output);
			if (!outputKeys.includes(edge.sourceHandle)) {
				// Дополнительная проверка: может быть значение с таким именем?
				const outputValues = Object.values(sourceNode.data.output);
				if (!outputValues.includes(edge.sourceHandle)) {
					isValid = false;
					issues.push(`source handle '${edge.sourceHandle}' not found in source node '${edge.source}' output`);
				}
			}
		}

		// Проверяем существование target ноды
		if (!targetNode) {
			isValid = false;
			issues.push(`target node '${edge.target}' missing`);
		}
		// Для targetHandle обычно проверяется существование элемента интерфейса,
		// но мы можем проверить, что targetNode существует

		// Логируем проблемные рёбра
		if (!isValid) {
			console.warn(`Broken edge found (${issues.join(', ')}):`, edge);
		}

		return isValid;
	});

	return validEdges;
}

// --- Пример использования ---
// const cleanedEdges = removeBrokenEdges(flow.nodes, flow.edges);
