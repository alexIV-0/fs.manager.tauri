import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';

const root = process.cwd();
const pluginsDir = path.join(root, 'plugins-dev');

const entries = await fs.readdir(pluginsDir, { withFileTypes: true });

for (const entry of entries) {
	if (!entry.isDirectory()) continue;
	if (entry.name.startsWith('_')) continue;

	console.log(`🔄 Building ${entry.name}`);

	await new Promise((resolve, reject) => {
		exec(`node plugins-dev/_packScripts/build-plugin.js ${entry.name}`, (err) => (err ? reject(err) : resolve()));
	});
}

console.log('🔥 All plugins rebuilt');
