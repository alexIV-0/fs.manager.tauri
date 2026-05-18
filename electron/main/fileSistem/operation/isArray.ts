export function isArray(value: any) {
	return typeof value === 'object' && value !== null && Array.isArray(value);
}
