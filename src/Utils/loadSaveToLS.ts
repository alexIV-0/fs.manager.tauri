export function saveToLocalStorage(lsName: string, state: any) {
	localStorage.setItem(lsName, JSON.stringify(state));
}

export function loadFromLocalStorage(lsName: string) {
	const savedState = localStorage.getItem(lsName);
	if (savedState) {
		try {
			return JSON.parse(savedState);
		} catch (error) {
			console.error('Error loading from localStorage:', error);
			return null;
		}
	}
	return null;
}
