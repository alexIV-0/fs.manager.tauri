export enum PatternKeys {
	clearName = 'clearName', // чистое имя найденного элемента в папке IN на GD без эмоджиков и кавычек () []
	findTime = 'findTime', // время когда был найден элемент в папке IN
	curItemName = 'curItemName', // текущий элемент в папке IN (с эмоджиками и кавычками). это может быть папка. но без расширения
	id = 'id', // уникальный id для каждого элемента если он есть в имени найденного элемента в папке IN
	projectName = 'projectName', // название проекта (имя папки в которой находится папка IN)
	projectPathGD = 'projectPathGD', // полный путь до папки проекта на GD
	mainFolderName = 'mainFolderName', // название папки, в которой находится проект на GD
	mainFolderPath = 'mainFolderPath', // название папки, в которой находится проект на GD

	// Дополнительные ключи из formatNameByPattern
	index = 'index', // индекс элемента если файл не единственный
	fileName = 'fileName', // имя текущего файла без расширения как есть
	clearFileName = 'clearFileName', // чистое имя текущего файла без расширения без кавычек, эмождиков и текста в круглых и квадратных скобках

	curMonthStr = 'curMonthStr', // текущий месяц в виде строки (January, February, ...)
	localFolder = 'localFolder', // рабочая папка на локальном дике (указывается в настройках)

	YYYY = 'YYYY', // год (4 цифры)
	MM = 'MM', // месяц (2 цифры)
	DD = 'DD', // день (2 цифры)
	HH = 'HH', // часы (2 цифры)
	mm = 'mm', // минуты (2 цифры)
	ss = 'ss', // секунды (2 цифры)
}
