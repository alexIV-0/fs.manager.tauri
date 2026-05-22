export const mainSearch = {
	id: 'mainSearch',
	type: 'mainSearch',
	position: { x: 0, y: 0 },
	width: 350,
	height: 480,
	data: {
		colorType: 'main',
		label: 'Search IN',
		comment: 'Описание процесса автоматизации в общих чертах',
		properties: [
			{
				id: `recursiveSearch`,
				controlType: 'checkbox',
				controlProps: {
					label: 'Recursive Search',
					tooltip: 'Recursive Search',
					value: false,
				},
				outputType: 'boolean',
			},
			{
				id: `searchType`,
				controlType: 'autocomplete',
				controlProps: {
					label: 'Search Type',
					tooltip: 'Тип файлов для поиска. Может быть только один тип',
					options: ['#typeOfFile', 'folders'],
					value: [],
					optionsOnly: true,
				},
				isOutput: true,
				outputType: 'array',
				required: true,
			},
			{
				id: `deleteAfter`,
				controlType: 'checkbox',
				controlProps: {
					label: 'Delete after process',
					tooltip: 'Delete original file(s) after process',
					value: false,
				},
				outputType: 'boolean',
			},
		],
		output: {
			functionName: 'collectFilesFromFolderFunc',
			sourceProperty: 'searchType',
		},

		isUnique: true,
		required: true,
		isValid: false,
	},
	deletable: false,
};
