import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';
import fs from 'fs';

export { onLoad } from '../_template/pluginSender';

const BASE_URL = 'https://api.video-transformer.tsp.ai';
const UPLOAD_URL = `${BASE_URL}/api/job/add`;
const STATUS_URL_BASE = `${BASE_URL}/api/job/`;
const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5000;
const TARGET_FPS = 16;

const FORMAT_RESOLUTION: Record<string, string> = {
	vertical: '480x832',
	horizontal: '832x480',
	square: '512x512',
};

function getFormatType(width: number, height: number): string {
	if (width > height) return 'horizontal';
	if (height > width) return 'vertical';
	return 'square';
}

function getLatestUrl(urls: string[]): string | null {
	if (!Array.isArray(urls) || urls.length === 0) return null;

	let latestUrl: string | null = null;
	let latestTime = 0;

	for (const url of urls) {
		const match = url.match(/(\d{4}-\d{2}-\d{2}-\d{2}h\d{2}m\d{2}s)/);
		if (!match) continue;

		const iso = match[1].replace(/(\d{4})-(\d{2})-(\d{2})-(\d{2})h(\d{2})m(\d{2})s/, '$1-$2-$3T$4:$5:$6');
		const time = new Date(iso).getTime();

		if (time > latestTime) {
			latestTime = time;
			latestUrl = url;
		}
	}

	return latestUrl;
}

export async function AIstyledVidFunc(_item: any, _description: any) {
	const finalFile: string[] = [];

	// ── Входные файлы ─────────────────────────────────────────────────
	const inputFiles: string[] = _item.import?.inputFile ?? [];
	if (inputFiles.length === 0) {
		throw new Error('inputFile is empty — подключи видео файл');
	}

	// ── Название конфига (модели) ─────────────────────────────────────
	const configName: string = (typeof _item.modelName === 'string' && _item.modelName.trim()) || 'default_video_generation_config';

	// ── Путь для сохранения ───────────────────────────────────────────
	const localTargetPath: string[] = Array.isArray(_item.targetPath) ? _item.targetPath : [];
	let curPath = localTargetPath.length === 0 ? ['$clearName ($random(3))'] : [...localTargetPath];

	if (_item.import?.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	// ── Обработка каждого входного файла ─────────────────────────────
	for (const videoFile of inputFiles) {
		sendToMW('statusbar', {
			text: `${_description.infoText}: [AIstyledVid]\n ${path.basename(videoFile)}`,
		});

		// Получаем инфо о файле
		const info = await getFullInfoFromVideoFile(videoFile, _description);

		// Определяем формат и разрешение
		const formatType = getFormatType(info.width, info.height);
		const resolution = FORMAT_RESOLUTION[formatType];

		// Вычисляем кол-во кадров (16fps)
		const durationSec = typeof _item.finalDuration === 'number' && _item.finalDuration > 0 ? _item.finalDuration : info.durationInSeconds;

		const videoLength = Math.round(durationSec * TARGET_FPS) + 1;

		sendToMW('log', {
			text: `📐 Format: ${formatType} → ${resolution}, duration: ${durationSec.toFixed(2)}s → ${videoLength} frames`,
		});

		// Путь для сохранения
		const targetFilePath = createPathForFileByPattern(curPath, _description, videoFile);
		const targetDir = path.dirname(targetFilePath);

		testAndCreateFolder(targetDir);

		const resultPath = await styleVideoWithRetry({
			videoFile,
			configName,
			resolution,
			videoLength,
			targetDir,
		});

		if (!resultPath) {
			throw new Error(`${_description.curItem} — не удалось обработать: ${path.basename(videoFile)}`);
		}

		finalFile.push(resultPath);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}

// ── Отправка с retry ─────────────────────────────────────────────────

async function styleVideoWithRetry(opts: {
	videoFile: string;
	configName: string;
	resolution: string;
	videoLength: number;
	targetDir: string;
}): Promise<string | null> {
	let attempt = 0;

	while (attempt < MAX_ATTEMPTS) {
		attempt++;

		try {
			sendToMW('log', {
				text: `🚀 AIstyledVid attempt ${attempt}/${MAX_ATTEMPTS}: ${path.basename(opts.videoFile)}`,
			});

			// ── Отправка задачи ──────────────────────────────────────
			const videoBuffer = fs.readFileSync(opts.videoFile);
			const videoBlob = new Blob([videoBuffer], { type: 'video/mp4' });

			const formData = new FormData();
			formData.append('video_file', videoBlob, path.basename(opts.videoFile));
			formData.append('config_name', opts.configName);
			formData.append('config_overrides', JSON.stringify({ resolution: opts.resolution, video_length: opts.videoLength }));

			sendToMW('log', { text: `🌐 POST ${UPLOAD_URL}` });

			const uploadResponse = await fetch(UPLOAD_URL, {
				method: 'POST',
				body: formData,
			});

			if (!uploadResponse.ok) {
				const errText = await uploadResponse.text();
				throw new Error(`Upload error ${uploadResponse.status}: ${errText}`);
			}

			const jobData = await uploadResponse.json();

			if (!jobData.job_id) {
				throw new Error(`No job_id in response: ${JSON.stringify(jobData)}`);
			}

			const jobId: string = jobData.job_id;
			sendToMW('log', { text: `📦 Job accepted: ${jobId}` });

			// ── Polling статуса ──────────────────────────────────────
			const resultUrls = await pollJobStatus(jobId);

			// ── Выбираем последний файл по метке времени ─────────────
			const latestUrl = getLatestUrl(resultUrls);
			if (!latestUrl) {
				throw new Error('Result file URL not found in job result');
			}

			sendToMW('log', { text: `⬇️ Downloading: ${latestUrl}` });

			// ── Скачиваем файл ────────────────────────────────────────
			const downloadResponse = await fetch(latestUrl);
			if (!downloadResponse.ok) {
				throw new Error(`Download error ${downloadResponse.status}`);
			}

			const arrayBuffer = await downloadResponse.arrayBuffer();
			const ext = path.extname(new URL(latestUrl).pathname) || path.extname(opts.videoFile) || '.mp4';
			const finalName = `AI_${path.basename(opts.videoFile, path.extname(opts.videoFile))}${ext}`;
			const finalPath = path.join(opts.targetDir, finalName);

			fs.writeFileSync(finalPath, Buffer.from(arrayBuffer));
			sendToMW('log', { text: `✅ Saved: ${finalPath}` });

			return finalPath;
		} catch (err: any) {
			sendToMW('log', { text: `❌ Attempt ${attempt} failed: ${err.message}` });

			if (attempt >= MAX_ATTEMPTS) {
				sendToMW('log', { text: `⏭ Skipped after ${MAX_ATTEMPTS} attempts` });
				return null;
			}

			sendToMW('log', { text: '🔁 Retrying...' });
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}
	}

	return null;
}

// ── Polling статуса ──────────────────────────────────────────────────

async function pollJobStatus(jobId: string): Promise<string[]> {
	const statusUrl = `${STATUS_URL_BASE}${jobId}/status`;

	let lastStatus = '';
	while (true) {
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

		const statusResponse = await fetch(statusUrl, {
			headers: { accept: 'application/json' },
		});

		let statusData: { status: string; result?: any; error?: string };
		try {
			statusData = await statusResponse.json();
		} catch {
			sendToMW('log', { text: `⚠️ Failed to parse status response, retrying...` });
			continue;
		}

		const status = statusData.status?.toLowerCase();
		if (status !== lastStatus) {
			sendToMW('log', { text: `🔄 Job [${jobId}] status: ${status}` });
			lastStatus = status;
		}

		if (status === 'completed' || status === 'done' || status === 'success' || status === 'finished') {
			if (!statusData.result) {
				throw new Error('Result is empty after job completion');
			}
			const urls = Array.isArray(statusData.result) ? statusData.result : [statusData.result];
			return urls;
		}

		if (status === 'failed' || status === 'error') {
			throw new Error(`Job failed: ${statusData.error || 'Unknown error'}`);
		}
	}
}
