// getNeededPropsFromNode.ts (ОБНОВЛЕННАЯ ВЕРСИЯ)

export function getNeededPropsFromNode(_node: any) {
	const returnProps: any = {};
	// 🔥 ОПЦИОНАЛЬНО: functionName можно оставить для обратной совместимости или логирования
	// Но он больше не используется для вызова плагина
	if (_node.data.output?.functionName) {
		returnProps.functionName = _node.data.output.functionName;
	}

	if (_node.data.label) {
		returnProps.nodeLabel = _node.data.label;
	}

	// 🔥 ДОБАВЛЕНО: Извлекаем pluginId и pluginVersion из node.data
	if (_node.data.pluginId) {
		returnProps.pluginId = _node.data.pluginId;
	}

	if (_node.data.pluginVersion) {
		returnProps.pluginVersion = _node.data.pluginVersion;
	}

	if (_node.data.colorType) {
		returnProps.colorType = _node.data.colorType;
	}

	if (_node.data.cost !== undefined) {
		returnProps.cost = _node.data.cost;
	}
	if (_node.data.costUnit !== undefined) {
		returnProps.costUnit = _node.data.costUnit;
	}

	// Извлекаем все properties (как было)
	for (const prop of _node.data.properties) {
		// jsonNavigator всегда использует id как ключ; остальные — label если editLabel
		const key = prop.controlType === 'jsonNavigator'
			? prop.id
			: (prop?.controlProps?.editLabel === true ? prop?.controlProps?.label : prop.id);

		if (key) {
			returnProps[key] = prop?.controlProps?.value;
		}
	}

	return returnProps;
}
