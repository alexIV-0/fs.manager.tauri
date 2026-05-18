import fs from 'fs/promises';
import path from 'path';

export interface DocFile {
	name: string;
	fileName: string;
}

export interface DocSection {
	name: string;
	files: DocFile[];
}

function getDocsRoot(): string {
	const appRoot = process.env.APP_ROOT!;
	const isDev = !!process.env.VITE_DEV_SERVER_URL;
	return isDev ? path.join(appRoot, 'Public', 'docs') : path.join(appRoot, 'dist', 'docs');
}

function isSafeSegment(segment: string): boolean {
	return !!segment && !segment.includes('/') && !segment.includes('\\') && !segment.includes('..');
}

export async function listDocs(): Promise<DocSection[]> {
	const root = getDocsRoot();
	let entries: string[];
	try {
		entries = await fs.readdir(root);
	} catch {
		return [];
	}

	const sections: DocSection[] = [];
	for (const entry of entries) {
		const sectionPath = path.join(root, entry);
		const stat = await fs.stat(sectionPath).catch(() => null);
		if (!stat?.isDirectory()) continue;

		const fileEntries = await fs.readdir(sectionPath).catch(() => [] as string[]);
		const files: DocFile[] = [];
		for (const fe of fileEntries) {
			if (!fe.toLowerCase().endsWith('.md')) continue;
			const fileStat = await fs.stat(path.join(sectionPath, fe)).catch(() => null);
			if (!fileStat?.isFile()) continue;
			files.push({ name: fe.replace(/\.md$/i, ''), fileName: fe });
		}
		files.sort((a, b) => a.fileName.localeCompare(b.fileName));
		sections.push({ name: entry, files });
	}

	sections.sort((a, b) => a.name.localeCompare(b.name));
	return sections;
}

export async function readDoc(sectionName: string, fileName: string): Promise<string> {
	if (!isSafeSegment(sectionName) || !isSafeSegment(fileName)) {
		throw new Error('Invalid path');
	}
	if (!fileName.toLowerCase().endsWith('.md')) {
		throw new Error('Only .md files allowed');
	}
	const filePath = path.join(getDocsRoot(), sectionName, fileName);
	return fs.readFile(filePath, 'utf-8');
}
