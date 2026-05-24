import path from 'path';
import { Description, formatNameByPattern } from './formatNameByPattern';

/*
	Функция для создания пути к файлу по шаблону
	возвращает уже готовый путь с нужным расширением.
	на входе: массив из масок для путей и возможной частью пути
	на вызоде: полный путь до нового файла, включая расширение
*/
export function createPathForFileByPattern(_pathArr: string[], _description: Description, _pathFrom: string) {
	const filePathArr = path.join(..._pathArr);
	const newFileName = formatNameByPattern({
		string: filePathArr,
		description: _description,
		file: _pathFrom,
	});
	const fileExt = path.extname(_pathFrom);
	// Подстановка токенов могла вмешать в путь native-сепараторы (например, $mainFolderPath
	// из Rust приходит с '\\', а path.join выше уже выбрал стиль). path.normalize приводит
	// всё к одному сепаратору и заодно схлопывает дубли.
	const fileTo = path.normalize(newFileName + fileExt);
	return fileTo;
}
