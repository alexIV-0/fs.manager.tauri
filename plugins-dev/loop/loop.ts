// Loop нода не выполняет функцию напрямую.
// Вся логика цикла обрабатывается в processItem.ts на стороне electron
// через nodeType: 'loop' в execution объекте.

export default async function loop() {
	return [];
}
