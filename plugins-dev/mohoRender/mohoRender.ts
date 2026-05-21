// mohoRender — рендерит Moho-проект через CLI Moho.exe -render -output ...
// Tauri-port: spawn → exec helper (без потокового прогресса; финальный
// прогресс от ffmpeg-style парсера sub-Rust здесь не подключён, но statusbar
// показывает старт/финиш).

import path from 'path';
import { fs, exec, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

function extractExtension(format: string): string {
	const match = format.match(/^([A-Za-z0-9]+)/);
	return match ? match[1].toLowerCase() : format.toLowerCase();
}

function getMohoFormat(ext: string): string {
	const map: Record<string, string> = {
		mov: 'QT',
		mp4: 'MP4',
		m4v: 'MP4',
		avi: 'AVI',
		jpeg: 'JPEG',
		jpg: 'JPEG',
		png: 'PNG',
		tga: 'TGA',
		bmp: 'BMP',
	};
	return map[ext.toLowerCase()] || ext.toUpperCase();
}

export async function mohoRenderFunc(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	let curPath: string[] = _item.targetPath.length === 0 ? ['$clearName ($random(3))'] : [..._item.targetPath];
	if (_item.import?.targetPath?.length) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const format = _item.otputFormat || 'MP4 (MPEG4-AAC)';
	const ext = extractExtension(format);
	const isImageFormat = ['jpeg', 'png', 'tga', 'bmp'].includes(ext);

	// Путь Moho — Windows-специфичный; в идеале брать из _description.programmPath.moho,
	// но оригинал хардкодил Moho 14.
	const mohoExe =
		(Array.isArray(_description.programmPath?.moho) ? _description.programmPath.moho[0] : null) || 'C:\\Program Files\\Moho 14\\Moho.exe';

	for (const mohoProj of (_item.import?.inputFile || []) as string[]) {
		const fileTo = createPathForFileByPattern(curPath, _description, mohoProj || '');
		const fileToBase = fileTo.slice(0, fileTo.length - path.extname(fileTo).length);
		await fs.mkdir(path.dirname(fileToBase));

		const outputPath = isImageFormat ? `${fileToBase}_%04d.${ext}` : `${fileToBase}.${ext}`;
		const statusText = `${_description.infoText}: [Moho Render] ${path.basename(mohoProj)}`;
		sendToMW('statusbar', { text: statusText });

		try {
			const args = [
				'-render',
				mohoProj,
				'-output',
				outputPath,
				'-format',
				getMohoFormat(ext),
				'-options',
				format,
				'-multithread',
				'yes',
				'-verbose',
			];

			sendToMW('log', { text: `🎬 Starting Moho render: ${format}\n[cmd]: ${mohoExe} ${args.join(' ')}` });

			const result = await exec(mohoExe, args);
			if (result.exit_code !== 0) {
				throw new Error(`Moho exited with code ${result.exit_code}: ${result.stderr.slice(-400)}`);
			}

			// Парсим stdout для прогресс-лога (не для UI, а для history)
			const frameLines = result.stdout
				.split('\n')
				.map((l) => l.trim())
				.filter((l) => /Frame\s+\d+\s+\(\d+\/\d+\)/.test(l));
			if (frameLines.length > 0) {
				sendToMW('log', { text: `[Moho] ${frameLines[frameLines.length - 1]}` });
			}

			if (isImageFormat) {
				const dir = path.dirname(outputPath);
				const baseName = path.basename(outputPath);
				const searchPattern = baseName.replace('%04d', '');
				const allFiles = await fs.filesByExt(dir, [ext]);
				const matched = allFiles.filter((f) => f.includes(searchPattern));
				finalFile.push(...matched.map((f) => path.join(dir, f)));
				sendToMW('log', { text: `✅ Rendered ${matched.length} images` });
			} else {
				if (!(await fs.existsFile(outputPath))) {
					throw new Error(`Output file not found: ${outputPath}`);
				}
				finalFile.push(outputPath);
				sendToMW('log', { text: `✅ Rendered video: ${path.basename(outputPath)}` });
			}
		} catch (error: any) {
			sendToMW('statusbar', { text: `[ERROR] Render failed: ${error.message}` });
			sendToMW('log', { level: 'error', text: `❌ Error: ${error.message}` });
			throw error;
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
