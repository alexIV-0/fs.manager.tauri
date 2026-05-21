import * as path from 'path';

/**
 * Merges all arrays from importObj in insertion order (= top-to-bottom node order),
 * then keeps only files whose extension matches one of the allowedTypes.
 * If allowedTypes is empty — returns the merged array unfiltered.
 */
export function mergeAndFilterByType(
	importObj: Record<string, any[]>,
	allowedTypes: string[],
	typeOfFile: Record<string, string[]>,
): string[] {
	const merged: string[] = Object.values(importObj).flatMap((arr) =>
		Array.isArray(arr) ? arr.map(String) : [],
	);

	if (allowedTypes.length === 0) return merged;

	const allowedExts = new Set<string>(
		allowedTypes.flatMap((typeName) =>
			Array.isArray(typeOfFile[typeName]) ? typeOfFile[typeName] : [],
		),
	);

	return merged.filter((f) => allowedExts.has(path.extname(f).slice(1).toLowerCase()));
}
