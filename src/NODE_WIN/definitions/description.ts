// import { automatizationTypes } from '../../utils/searchTypes';

export const description = {
	id: 'description',
	type: 'description',
	position: { x: 0, y: 500 },
	width: 350,
	height: 480,
	data: {
		label: 'Description',
		colorType: 'main',
		properties: [
			{
				id: `contact`,
				controlType: 'autocomplete',
				controlProps: {
					label: 'Contact',
					tooltip: 'Контактное лицо, к кому можно обратиться по поводу этой песочницы',
					options: ['#historyValue(contactNames)'],
					multiSelect: true,
					value: ['Aleksey Ivanov'],
				},
				required: true,
				outputType: 'array',
			},
		],
		comment: 'Описание процесса автоматизации в общих чертах',
		isValid: false,
		isUnique: true,
		required: true,
	},
	deletable: false,
};
