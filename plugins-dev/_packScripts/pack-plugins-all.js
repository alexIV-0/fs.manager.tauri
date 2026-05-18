import path from 'path';
import fs from 'fs/promises';
import AdmZip from 'adm-zip';

const root = process.cwd();
const distrDir = path.join(root, 'distr-plugins');
const dest = path.join(root, 'release', 'plugins');

await fs.mkdir(dest, { recursive: true });

const entries = await fs.readdir(distrDir, { withFileTypes: true });

for (const entry of entries) {
	if (!entry.isDirectory()) continue;

	const outFile = path.join(dest, `${entry.name}.fsmplug`);
	const zip = new AdmZip();
	zip.addLocalFolder(path.join(distrDir, entry.name), entry.name);
	zip.writeZip(outFile);

	console.log(`📦 Packed → ${outFile}`);
}

console.log('✅ All plugins packed');
