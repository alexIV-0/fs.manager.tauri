// ─────────────────────────────────────────────────────────────────────────────
// PLAYGROUND-КОНФИГ — локальная отладка JSX в After Effects. Файл локальный (.gitignore).
//
//   1. Запусти `yarn jsx:watch` (или разово `yarn jsx:play`).
//   2. В `script` укажи имя dev-скрипта (файл jsx/dev/<script>.ts, без расширения).
//   3. В `inObj` вставь объект параметров. Готовый объект печатается в logwin
//      приложения при реальном запуске плагина: строка "[aeProcess] inObj → ..." —
//      просто скопируй его сюда.
//   4. Открой сгенерированный jsx/_playground/__run.jsx и нажми F5
//      (конфиг «AE: playground» из .vscode/launch.json). `debugger;` и брейкпоинты
//      ловятся прямо в After Effects.
//   5. Правишь dev-скрипт или этот конфиг → watch пересобирает __run.jsx → F5 снова.
// ─────────────────────────────────────────────────────────────────────────────

// Имя dev-скрипта (файл jsx/dev/<script>.ts), который хочешь гонять.
export const script = 'scaleAvatarByAudio';

// Параметры — подставятся вместо `var inObj = {}` внутри скрипта (как в продакшене).
export const inObj = {
	aeInput: { video: ['/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/testAE/06.06-11.25/original/easy Jinu.mov'] },
	clearName: 'easy Jinu',
	curItem: 'easy Jinu.mov',
	findTime: '06.06-11.25',
	localFolder: '/Users/aleksey.ivanov/Desktop/work-local',
	mainFolderName: 'newMainFolder',
	mainFolderPath: '/Users/aleksey.ivanov/Desktop/newMainFolder',
	mainWorkFolder: '/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/testAE',
	pathForDelete: '/Users/aleksey.ivanov/Desktop/newMainFolder/testAE/IN/easy Jinu.mov',
	projectPathGD: '/Users/aleksey.ivanov/Desktop/newMainFolder/testAE',
	targetPath: '/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/testAE/06.06-11.25/aeScript easy Jinu.mov',
	typeOfFile: {
		aep: ['aep'],
		audio: ['mp3', 'wav'],
		image: ['jpg', 'jpeg', 'png', 'tiff', 'tga', 'pdf', 'gif', 'pgf'],
		moho: ['moho'],
		scripts: ['js', 'jsx', 'lua'],
		text: ['txt', 'json'],
		title: ['lrc', 'srt'],
		video: ['avi', 'mov', 'mp4', 'mpeg', 'mpg', 'm2v', 'm4v', 'ts', 'mxf'],
		xlsx: ['tsv', 'csv'],
	},
	year: '2026',
};
