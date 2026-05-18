// Определяем части как отдельные константы с помощью 'as const'
// Это делает их кортежами (tuples) с известными типами и значениями
export const mediaTypes = ['video', 'audio', 'img', 'text', 'aep', 'moho'] as const;
export const containerTypes = ['files', 'folders'] as const;
export const specialTypes = ['all'] as const;

// Собираем всё обратно в исходный массив
// Используем spread operator и typeof для получения типа
export const searchTypes = [...mediaTypes, ...containerTypes, ...specialTypes];

export const filePathNamePattern = [
	'$projectName',
	'$mainFolderName',
	'$mainFolderPath',
	'$curItem',
	'$fileName',
	'$clearItemName',
	'$clearFileName',
	'$localFolder',
	'$id',
	'$findTime',
	'$YYYY',
	'$MM',
	'$DD',
	'$HH',
	'$mm',
	'$ss',
	'$curMonthStr',
	'$random()',
	'$random(10)',
];

// export const automatizationTypes = [
// 	'autoreaction',
// 	'podcast',
// 	'simpleEdit',
// 	'whisper',
// 	'addMusic',
// 	'addTitle',
// 	'reverseVA',
// 	'repeatVA',
// 	'split',
// 	'merge',
// ];

export const months = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];
