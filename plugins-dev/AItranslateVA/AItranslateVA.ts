import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';
import fs from 'fs';

export { onLoad } from '../_template/pluginSender';

const BASE_URL = 'https://ai-video-parse-xiprk.ondigitalocean.app';
const SUBMIT_URL = `${BASE_URL}/api/dubbing/submit`;
const STATUS_URL_BASE = `${BASE_URL}/api/dubbing/status/`;
const DOWNLOAD_VIDEO_URL_BASE = `${BASE_URL}/api/dubbing/download/`;
const DOWNLOAD_AUDIO_URL_BASE = `${BASE_URL}/api/dubbing/download-audio/`;
const LANGUAGES_URL = `${BASE_URL}/api/dubbing/languages`;
const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5000;
const AUDIO_EXT_RE = /\.(mp3|wav|m4a|ogg|aac|flac)$/i;

type LangMap = Record<string, string>;
let languagesCache: LangMap | null = null;

export async function AItranslateVAFunc(_item: any, _description: any) {
	const finalFile: string[] = [];

	// ── Входные файлы ─────────────────────────────────────────────────
	const inputFiles: string[] = _item.import?.inputFile ?? [];
	if (inputFiles.length === 0) {
		throw new Error('inputFile is empty — подключи видео/аудио файл');
	}

	// ── Языки перевода (имена) ───────────────────────────────────────
	const targetLangNames: string[] = Array.isArray(_item.translateLang) ? _item.translateLang : [];
	if (targetLangNames.length === 0) {
		throw new Error('translateLang is empty — выбери хотя бы один язык');
	}

	const sourceLangRaw: string = typeof _item.sourceLang === 'string' ? _item.sourceLang : 'auto';
	const numSpeakers: number = Number.isFinite(_item.numSpeakers) ? Number(_item.numSpeakers) : 0;
	const dropBg: boolean = _item.dropBackgroundAudio === true;

	// ── Маппинг имени языка → ISO ────────────────────────────────────
	const langMap = await getLanguagesMap();
	const targetLangs = targetLangNames.map((name) => {
		const code = langMap[name];
		if (!code) throw new Error(`Неизвестный язык: ${name}`);
		return { name, code };
	});

	const sourceLangCode = sourceLangRaw === 'auto' || !sourceLangRaw ? 'auto' : langMap[sourceLangRaw] || 'auto';

	// ── Базовый путь сохранения ──────────────────────────────────────
	const localTargetPath: string[] = Array.isArray(_item.targetPath) ? _item.targetPath : [];
	let curPath = localTargetPath.length === 0 ? ['$fileName ($random(3))'] : [...localTargetPath];

	if (_item.import?.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	// проверяем — есть ли в маске $ISO / $language; если нет, будем добавлять _<code>
	const maskHasLangToken = curPath.some((p) => /\$ISO|\$language/.test(p));

	// ── Обрабатываем все пары (file × language) ──────────────────────
	for (const videoFile of inputFiles) {
		const isAudioInput = AUDIO_EXT_RE.test(videoFile);
		const expectedExt = isAudioInput ? '.mp3' : '.mp4';

		for (const lang of targetLangs) {
			sendToMW('statusbar', {
				text: `${_description.infoText}: [AItranslateVA → ${lang.name}]\n ${path.basename(videoFile)}`,
			});

			// Базовый путь (с любым "родным" расширением)
			const builtPath = createPathForFileByPattern(curPath, _description, videoFile);

			// Подставляем $ISO / $language локально (formatNameByPattern их не трогает)
			let resolvedPath = builtPath.replace(/\$ISO/g, lang.code).replace(/\$language/g, lang.name);

			// Чиним расширение под фактический результат API
			const parsed = path.parse(resolvedPath);
			let baseName = parsed.name;
			// если в маске не было токенов языка — добавляем _<code> к имени
			if (!maskHasLangToken) baseName = `${baseName}_${lang.code}`;
			const targetFilePath = path.join(parsed.dir, baseName + expectedExt);
			const targetDir = parsed.dir;

			testAndCreateFolder(targetDir);

			const ok = await dubWithRetry({
				videoFile,
				targetLangCode: lang.code,
				sourceLangCode,
				numSpeakers,
				dropBg,
				isAudioInput,
				targetFilePath,
			});

			if (!ok) {
				throw new Error(`${_description.curItem} — не удалось перевести ${path.basename(videoFile)} → ${lang.name}`);
			}

			finalFile.push(targetFilePath);
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}

// ── Submit + poll + download с retry ─────────────────────────────────

async function dubWithRetry(opts: {
	videoFile: string;
	targetLangCode: string;
	sourceLangCode: string;
	numSpeakers: number;
	dropBg: boolean;
	isAudioInput: boolean;
	targetFilePath: string;
}): Promise<boolean> {
	let attempt = 0;

	while (attempt < MAX_ATTEMPTS) {
		attempt++;

		try {
			sendToMW('log', {
				text: `🚀 Dubbing attempt ${attempt}/${MAX_ATTEMPTS}: ${path.basename(opts.videoFile)} → ${opts.targetLangCode}`,
			});

			// ── Submit ───────────────────────────────────────────────
			const videoBuffer = fs.readFileSync(opts.videoFile);
			const mime = opts.isAudioInput ? 'audio/mpeg' : 'video/mp4';
			const videoBlob = new Blob([videoBuffer], { type: mime });

			const formData = new FormData();
			formData.append('video', videoBlob, path.basename(opts.videoFile));
			formData.append('target_language', opts.targetLangCode);
			formData.append('source_language', opts.sourceLangCode);
			formData.append('num_speakers', String(opts.numSpeakers));
			formData.append('drop_background_audio', String(opts.dropBg));

			sendToMW('log', { text: `🌐 POST ${SUBMIT_URL}` });

			const submitResponse = await fetch(SUBMIT_URL, { method: 'POST', body: formData });

			if (!submitResponse.ok) {
				const errText = await submitResponse.text();
				throw new Error(`Submit error ${submitResponse.status}: ${errText}`);
			}

			const jobData = await submitResponse.json();
			if (!jobData.job_id) {
				throw new Error(`No job_id in response: ${JSON.stringify(jobData)}`);
			}

			const jobId: number = jobData.job_id;
			sendToMW('log', { text: `📦 Job accepted: ${jobId} (rq=${jobData.rq_job_id})` });

			// ── Poll ─────────────────────────────────────────────────
			const finalStatus = await pollDubbingStatus(jobId);

			// ── Download (audio vs video) ────────────────────────────
			const isAudioOnly = finalStatus.is_audio_only === true || opts.isAudioInput;
			const downloadUrl = (isAudioOnly ? DOWNLOAD_AUDIO_URL_BASE : DOWNLOAD_VIDEO_URL_BASE) + jobId;

			sendToMW('log', { text: `⬇️ GET ${downloadUrl}` });

			const downloadResponse = await fetch(downloadUrl);
			if (!downloadResponse.ok) {
				const errText = await downloadResponse.text();
				throw new Error(`Download error ${downloadResponse.status}: ${errText}`);
			}

			const arrayBuffer = await downloadResponse.arrayBuffer();
			fs.writeFileSync(opts.targetFilePath, Buffer.from(arrayBuffer));

			sendToMW('log', { text: `✅ Saved: ${opts.targetFilePath}` });
			return true;
		} catch (err: any) {
			sendToMW('log', { text: `❌ Attempt ${attempt} failed: ${err.message}` });

			if (attempt >= MAX_ATTEMPTS) {
				sendToMW('log', { text: `⏭ Skipped after ${MAX_ATTEMPTS} attempts` });
				return false;
			}

			sendToMW('log', { text: '🔁 Retrying...' });
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}
	}

	return false;
}

// ── Polling статуса ──────────────────────────────────────────────────

async function pollDubbingStatus(jobId: number): Promise<{ is_audio_only?: boolean; status?: string }> {
	const statusUrl = `${STATUS_URL_BASE}${jobId}`;

	let lastStatus = '';
	while (true) {
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

		const statusResponse = await fetch(statusUrl, { headers: { accept: 'application/json' } });

		let statusData: any;
		try {
			statusData = await statusResponse.json();
		} catch {
			sendToMW('log', { text: `⚠️ Failed to parse status response, retrying...` });
			continue;
		}

		const status: string = (statusData.status || '').toLowerCase();
		if (status !== lastStatus) {
			sendToMW('log', { text: `🔄 Job [${jobId}] status: ${status || 'unknown'}` });
			lastStatus = status;
		}

		if (status === 'success' || status === 'completed' || status === 'done' || status === 'finished') {
			return statusData;
		}

		if (status === 'failure' || status === 'failed' || status === 'error') {
			throw new Error(`Job failed: ${statusData.error_message || statusData.error || 'Unknown error'}`);
		}
	}
}

// ── Languages map (с кешем) ──────────────────────────────────────────

async function getLanguagesMap(): Promise<LangMap> {
	if (languagesCache) return languagesCache;

	const response = await fetch(LANGUAGES_URL, { headers: { accept: 'application/json' } });
	if (!response.ok) {
		throw new Error(`Languages fetch error ${response.status}`);
	}

	const data = await response.json();
	const map: LangMap = {};
	for (const item of data.languages ?? []) {
		if (item?.name && item?.code) map[item.name] = item.code;
	}

	if (Object.keys(map).length === 0) {
		throw new Error('Languages list is empty');
	}

	languagesCache = map;
	return map;
}
