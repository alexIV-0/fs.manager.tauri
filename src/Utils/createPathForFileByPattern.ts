import path from 'path';
import { Description, formatNameByPattern } from './formatNameByPattern';

/*
	Функция для создания пути к файлу по шаблону
	возвращает уже готовый путь с нужным расширением.
	на входе: массив из масок для путей и возможной частью пути
	на вызоде: полный путь до нового файла, включая расширение
*/
export function createPathForFileByPattern(_pathArr: string[], _description: Description, _pathFrom: string) {
	// ВАЖНО: соединяем сегменты простым '/', НЕ через path.join.
	// path.join схлопнул бы '..' против ещё не раскрытых токенов
	// (напр. path.join('$projectPathGD', '../renders') === 'renders'),
	// ломая относительные пути. Сначала раскрываем токены, затем нормализуем —
	// тогда '..' схлопывается уже против реального пути.
	const filePathArr = _pathArr.filter((s) => s != null && s !== '').join('/');
	// strict: здесь строка становится ПУТЁМ, и нераскрытый токен стал бы настоящей
	// папкой `$footage` — результат витка уехал бы в неё без единого сообщения.
	// Чаще всего это алиас, определённый на одной машине и не определённый на другой.
	const newFileName = formatNameByPattern({
		string: filePathArr,
		description: _description,
		file: _pathFrom,
		strict: true,
	});
	const fileExt = path.extname(_pathFrom);
	// path.normalize приводит всё к одному сепаратору, схлопывает дубли и '..'
	// (токены вроде $mainFolderPath из Rust могут прийти с '\\').
	const fileTo = path.normalize(newFileName + fileExt);
	return fileTo;
}
