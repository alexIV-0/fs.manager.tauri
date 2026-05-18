import { spawn } from 'child_process';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';
import fs from 'fs';

export { onLoad } from '../_template/pluginSender';

// Извлекает расширение из строк вроде "MOV (ProRes alpha-ALAC)" → "mov"
function extractExtension(format: string): string {
	const match = format.match(/^([A-Za-z0-9]+)/);
	return match ? match[1].toLowerCase() : format.toLowerCase();
}

// Конвертирует расширение в формат для Moho (mov → QT)
function getMohoFormat(ext: string): string {
	const formatMap: Record<string, string> = {
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
	return formatMap[ext.toLowerCase()] || ext.toUpperCase();
}

// Запускает процесс с обработкой прогресса
function executeCommand(command: string[], statusText: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const [executable, ...args] = command;
		const child = spawn(executable, args, {
			shell: true,
		});

		let lastProgress = 0;

		const handleOutput = (data: any, source: 'stdout' | 'stderr') => {
			const output = data.toString();
			const lines = output.split('\n');

			lines.forEach((line: string) => {
				const trimmed = line.trim();
				if (!trimmed) return;

				console.log(`[Moho ${source}] ${trimmed}`);
				sendToMW('log', { text: `[Moho ${source}] ${trimmed}` });

				const frameMatch = trimmed.match(/Frame\s+\d+\s+\((\d+)\/(\d+)\)/);
				if (frameMatch) {
					const currentFrame = parseInt(frameMatch[1]);
					const totalFrames = parseInt(frameMatch[2]);
					const progress = Math.round((currentFrame / totalFrames) * 100);

					if (progress !== lastProgress) {
						lastProgress = progress;
						sendToMW('statusbar', {
							text: `${statusText}: ${progress}%`,
						});
					}
				} else {
					// Прогресс не распарсился — показываем последнюю строку вывода,
					// чтобы видеть что Moho реально пишет (помогает уточнить regex)
					sendToMW('statusbar', { text: `${statusText}: ${trimmed}` });
				}
			});
		};

		child.stdout?.on('data', (data: any) => handleOutput(data, 'stdout'));
		child.stderr?.on('data', (data: any) => handleOutput(data, 'stderr'));

		child.on('close', (code: number) => {
			console.log(`[Moho] process exited with code ${code}`);
			code === 0 ? resolve() : reject(new Error(`Process exited with code ${code}`));
		});

		child.on('error', reject);
	});
}

export async function mohoRenderFunc(_item: any, _description: any) {
	let finalFile: any[] = [];

	let curPath = _item.targetPath.length == 0 ? ['$clearName ($random(3))'] : _item.targetPath;

	if (_item.import?.targetPath) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const format = _item.otputFormat || 'MP4 (MPEG4-AAC)';
	const ext = extractExtension(format);
	const isImageFormat = ['jpeg', 'png', 'tga', 'bmp'].includes(ext);

	// Обработка каждого входящего файла
	for (let mohoProj of _item.import?.inputFile || []) {
		const pathForDelete = mohoProj || '';
		const fileTo = createPathForFileByPattern(curPath, _description, pathForDelete);
		const fileToBase = fileTo.slice(0, fileTo.length - path.extname(fileTo).length);

		testAndCreateFolder(path.dirname(fileToBase));

		// Для картинок добавляем нумерацию
		const outputPath = isImageFormat ? `${fileToBase}_%04d.${ext}` : `${fileToBase}.${ext}`;

		const statusText = `${_description.infoText}: [Moho Render] ${path.basename(mohoProj)}`;

		sendToMW('statusbar', {
			text: statusText,
		});

		try {
			const renderCommand = [
				`"${path.join('C:', 'Program Files', 'Moho 14', 'Moho.exe')}"`,
				'-render',
				`"${mohoProj}"`,
				'-output',
				`"${outputPath}"`,
				'-format',
				`"${getMohoFormat(ext)}"`,
				'-options',
				`"${format}"`,
				'-multithread',
				'yes',
				'-verbose',
			];

			console.log('Render command:', renderCommand.join(' '));
			sendToMW('log', { text: `🎬 Starting Moho render: ${format}\n[render command]: ${renderCommand.join(' ')}` });

			await executeCommand(renderCommand, statusText);

			// Диагностика: показываем что появилось в папке после рендера
			const outDir = path.dirname(fileToBase);
			const outBase = path.basename(fileToBase);
			try {
				const dirFiles = fs.readdirSync(outDir).filter((f) => f.startsWith(outBase));
				console.log(`[Moho] Files in output dir matching "${outBase}":`, dirFiles);
				sendToMW('log', { text: `[Moho] Output dir files: ${dirFiles.join(', ') || '(none)'}` });
			} catch {}

			if (isImageFormat) {
				// Для картинок найти все файлы с нумерацией
				const dir = path.dirname(outputPath);
				const baseName = path.basename(outputPath);
				const searchPattern = baseName.replace('%04d', '');
				const files = fs.readdirSync(dir).filter((f) => f.includes(searchPattern));
				finalFile.push(...files.map((f) => path.join(dir, f)));
				sendToMW('log', { text: `✅ Rendered ${files.length} images` });
			} else {
				// Для видео проверить один файл
				if (!fs.existsSync(outputPath)) {
					throw new Error(`Output file not found: ${outputPath}`);
				}
				finalFile.push(outputPath);
				sendToMW('log', { text: `✅ Rendered video: ${path.basename(outputPath)}` });
			}
		} catch (error: any) {
			sendToMW('statusbar', {
				text: `[ERROR] Render failed: ${error.message}`,
			});
			sendToMW('log', { text: `❌ Error: ${error.message}`, level: 'error' });
			throw error;
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
