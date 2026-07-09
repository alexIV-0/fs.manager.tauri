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
export const script = 'robloxSplitScreen';

// Параметры — подставятся вместо `var inObj = {}` внутри скрипта (как в продакшене).
export const inObj = {
	clearName: 'Алина - 1 воровство Алины',
	curItem: 'Алина - 1 воровство Алины.mkv',
	findTime: '19.06-15.16',
	localFolder: '/Users/aleksey.ivanov/Desktop/work-local',
	mainFolderName: 'newMainFolder',
	mainFolderPath: '/Users/aleksey.ivanov/Desktop/newMainFolder',
	mainWorkFolder: '/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/ROBLOX test',
	pathForDelete: '/Users/aleksey.ivanov/Desktop/newMainFolder/ROBLOX test/IN/Алина - 1 воровство Алины.mkv',
	projectPathGD: '/Users/aleksey.ivanov/Desktop/newMainFolder/ROBLOX test',
	typeOfFile: {
		video: ['avi', 'mov', 'mp4', 'mpeg', 'mpg', 'm2v', 'm4v', 'ts', 'mxf', 'mkv'],
		audio: ['mp3', 'wav'],
		image: ['jpg', 'jpeg', 'png', 'tiff', 'tga', 'pdf', 'gif', 'pgf'],
		text: ['txt', 'json'],
		title: ['lrc', 'srt'],
		xlsx: ['tsv', 'csv'],
		aep: ['aep'],
		moho: ['moho'],
		scripts: ['js', 'jsx', 'lua'],
	},
	year: '2026',
	aeInput: {
		video: ['/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/ROBLOX test/19.06-15.16/Алина - 1 воровство Алины.mp4'],
		mems: ['/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/ROBLOX test/mems/Hitube_cEfmLbEmse_2026_06_17_15_39_45.mov'],
		statBG: [
			'/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/ROBLOX test/statBG/bg1.mp4',
			'/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/ROBLOX test/statBG/bg2.mp4',
			'/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/ROBLOX test/statBG/bg3.mp4',
			'/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/ROBLOX test/statBG/bg4.mp4',
			'/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/ROBLOX test/statBG/bg5.mp4',
			'/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/ROBLOX test/statBG/bg6.mp4',
			'/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/ROBLOX test/statBG/bg7.mp4',
			'/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/ROBLOX test/statBG/bg8.mp4',
		],
		compDuration: [35, 60],
		randScenes: [3, 5],
	},
	targetPath: '/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/ROBLOX test/19.06-15.16/Алина - 1 воровство Алины (3Rn).mkv',
};
