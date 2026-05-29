// Spy (reroute) node — passthrough junction. Тип на выходе = тип на входе.
// Не вызывает плагин, не появляется в очереди исполнения (createProcessQueue
// «сплющивает» цепочки spy при сборке importObj у downstream-нод).
export const spy = {
	id: 'spy',
	type: 'spy',
	position: { x: 0, y: 0 },
	width: 80,
	height: 28,
	data: {
		colorType: 'main',
		label: 'Spy',
		comment: '',
		properties: [],
		isValid: false,
	},
};
