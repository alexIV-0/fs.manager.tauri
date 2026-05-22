export function extractFromParentheses(input: string): string[] {
	const regex = /\(([^()]+)\)/g;
	const results: string[] = [];
	let match;

	while ((match = regex.exec(input)) !== null) {
		results.push(match[1]);
	}

	return results;
}
