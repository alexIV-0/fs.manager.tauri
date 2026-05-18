import { CustomNode } from "../definitions/types";
import { getSourceNodeData } from "../utils/getSourseNode";
import { Edge } from "@xyflow/react";

export const useEdgesSourseData = (
  id: string,
  target: string,
  edges: Edge[],
  allNodeInFlow: CustomNode[]
) => {
  const incomingEdges = edges.filter((edge) => edge.target === id && edge.targetHandle === target);

  let data: string[] = [];
  let color: string = "none";
  let validNode: boolean = false;

  if (incomingEdges.length > 0) {
    const edge = incomingEdges[0];

    // Проверяем, что source node существует в allNodeInFlow
    const sourceNode = allNodeInFlow.find((node) => node.id === edge.source);
    if (!sourceNode) {
      // Если source node удалена, игнорируем это соединение
      console.warn(`Source node ${edge.source} not found for edge`, edge);
      // Можно также сбросить состояние, если нужно:
      data = [];
      color = "none";
      validNode = false;
    } else {
      const sourceData = getSourceNodeData(edge, allNodeInFlow);

      // Проверяем, что sourceData и нужные поля существуют
      if (
        edge.sourceHandle &&
        sourceData &&
        sourceData.output &&
        sourceData.output[edge.sourceHandle]
      ) {
        data = sourceData.output[edge.sourceHandle].data || [];
        color = sourceData.output[edge.sourceHandle].color || "none";
        validNode = true;
      }
    }
  }

  return { data, color, validNode };
};
