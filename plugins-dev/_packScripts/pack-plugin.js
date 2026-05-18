// plugins-dev/_packScripts/pack-plugin.js
import path from 'path';
import fs from 'fs/promises';
import AdmZip from 'adm-zip';

const pluginDir = process.argv[2];
if (!pluginDir) {
	console.error('❌ Plugin directory required (e.g. mainSearch@0.0.1)');
	process.exit(1);
}

const root = process.cwd();
const src = path.join(root, 'distr-plugins', pluginDir);
const dest = path.join(root, 'release', 'plugins');

await fs.mkdir(dest, { recursive: true });

const outFile = path.join(dest, `${pluginDir}.fsmplug`);

const zip = new AdmZip();
zip.addLocalFolder(src, pluginDir); // сохраняем с папкой внутри архива
zip.writeZip(outFile);

console.log(`📦 Packed → ${outFile}`);
