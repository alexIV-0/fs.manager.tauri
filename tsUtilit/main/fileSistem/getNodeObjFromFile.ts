import fs from 'fs';
import path from 'path';
import { testAndCreateFolder } from './testAndCreateFolder';
import { mainSearch } from '../../../src/NODE_WIN/definitions/mainSearch';
import { description } from '../../../src/NODE_WIN/definitions/description';
export async function getNodeObjFromFile(_path: string) {
	if (!_path) return;

	const folderPath = path.join(_path, 'options');
	const finalPath = path.join(folderPath, 'options.json');

	if (fs.existsSync(finalPath)) {
		const options = fs.readFileSync(decodeURI(finalPath), 'utf-8');
		const defObj = JSON.parse(options);
		return defObj;
	} else {
		testAndCreateFolder(folderPath);

		// Создаем дефолтный объект только с встроенными нодами
		// Плагинные ноды добавятся на клиенте при необходимости
		const defObj = {
			nodes: [mainSearch, description]
				.filter((node) => node.data.required)
				.map((node, index, self) => {
					const prevNode = self[index - 1];
					if (prevNode) {
						return {
							...node,
							position: {
								x: prevNode.position.x,
								y: prevNode.position.y + (prevNode.height || 100) + 20, // ✅ Используем реальную высоту
							},
						};
					}
					return { ...node, position: { x: 0, y: 0 } };
				}),
			edges: [],
			viewport: { x: 100, y: 100, zoom: 0.8 },
		};

		fs.writeFileSync(finalPath, JSON.stringify(defObj, null, 2));
		return defObj;
	}
}
