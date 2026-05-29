import type { Edge } from '@xyflow/react';

// Edge "active" — реальный коннектор, участвует в валидации и исполнении.
// Inactive — «спящий» коннектор от выключенной ноды, остаётся в графе визуально
// (полупрозрачным), но не блокирует слот downstream и не передаёт данные.
// Старые edges без поля = active (для обратной совместимости со старыми флоу).
export function isEdgeActive(edge: Edge): boolean {
	return (edge.data as any)?.active !== false;
}
