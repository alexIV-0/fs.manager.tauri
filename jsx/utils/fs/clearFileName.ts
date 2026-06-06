// =========================================================================================
// функция убираем эмоджи из имени файла и возвращаем имя без лишних символов и без расширения
// =========================================================================================
export function clearFileName(_name: string) {
	var nameFile = '';
	if (_name.lastIndexOf('.') != -1) {
		nameFile = _name.substr(0, _name.lastIndexOf('.'));
	} else {
		nameFile = _name;
	}
	// nameF = nameF.replace(/[^a-zA-Z0-9\s\[\]()._-]/g, '');
	// var nameF = nameFile.replace(/[^a-zA-Z0-9\s\[\]()._-]/g, '');
	// alert(nameF);
	//@ts-ignore
	var nameF = nameFile.replace(/[^\p{L}\p{N}\s\[\]()._\-]/gu, '');
	// var nameF = nameFile.replace(/[\u{1F600}-\u{1F64F}]/gu, '');
	nameF = nameF
		.replace(/\s+/g, ' ')
		.replace(/^\s\s*/, '')
		.replace(/\s\s*$/, '');
	return nameF;
}
