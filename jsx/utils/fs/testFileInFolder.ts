// функция проверки имени файла в папке.
// Возвращает имя, которого ещё нет в _folder. При коллизии добавляет _1, _2, …
// Расширение сохраняется; имя без расширения остаётся без расширения.
import { basename, extname, join } from './path';

export function testFileInFolder(_folder: string, _name: string): string {
	var ext = extname(_name); // ".aep" или "" (если расширения нет)
	var base = basename(_name, ext); // имя без расширения
	var candidate = _name;
	var numm = 0;

	// Точная проверка существования через File(...).exists — без масок getFiles
	// (никаких ложных срабатываний по другому расширению, null или 2+ совпадениям).
	//@ts-ignore
	while (new File(join(_folder, candidate)).exists) {
		numm++;
		candidate = base + '_' + numm + ext;
	}

	return candidate;
}
