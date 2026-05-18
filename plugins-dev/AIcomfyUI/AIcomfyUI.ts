import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export { onLoad } from '../_template/pluginSender';

const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 10000;

// ── Заглушка: проверка флага отмены ─────────────────────────────────
let _userCancelled = false;

function checkUserCancelled(): boolean {
	return _userCancelled;
}

function resetCancelFlag() {
	_userCancelled = false;
}

// ── MIME-тип по расширению файла ─────────────────────────────────────
function getMimeType(filename: string): string {
	const ext = path.extname(filename).toLowerCase();
	const map: Record<string, string> = {
		'.mp3': 'audio/mpeg',
		'.wav': 'audio/wav',
		'.ogg': 'audio/ogg',
		'.flac': 'audio/flac',
		'.m4a': 'audio/mp4',
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.webp': 'image/webp',
		'.gif': 'image/gif',
		'.mp4': 'video/mp4',
		'.webm': 'video/webm',
		'.mov': 'video/quicktime',
	};
	return map[ext] ?? 'application/octet-stream';
}

// ── WebSocket URL из HTTP URL ─────────────────────────────────────────
function toWsUrl(httpUrl: string): string {
	return httpUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
}

const FILE_TYPE_SUFFIXES = new Set(['video', 'image', 'audio', 'latent']);

export async function AIcomfyUIFunc(_item: any, _description: any) {
	let finalFile: any[] = [];
	resetCancelFlag();

	// ── Путь для сохранения результата ──────────────────────────────
	const localTargetPath: string[] = Array.isArray(_item.targetPath) ? _item.targetPath : [];
	let curPath = localTargetPath.length === 0 ? ['$clearName ($random(3))'] : [...localTargetPath];

	if (_item.import?.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const pathForDelete = typeof _item.description?.pathForDelete === 'string' ? _item.description?.pathForDelete : 'workflow.json';
	const targetFilePath = createPathForFileByPattern(curPath, _description, pathForDelete);
	const targetDir = path.dirname(targetFilePath);
	const targetBaseName = path.basename(targetFilePath, path.extname(targetFilePath));

	sendToMW('statusbar', {
		text: `${_description.infoText}: [ComfyUI Request]\n ${_description.curItem}`,
	});

	// ── Читаем оригинальный workflow JSON (без изменений) ────────────
	const jsonPath: string = typeof _item.jsonPath === 'string' ? _item.jsonPath.trim() : '';
	if (!jsonPath) throw new Error('jsonPath is empty — укажи путь до workflow.json');

	const workflowFilePath = path.isAbsolute(jsonPath) ? jsonPath : path.join(_description.projectPathGD, ...jsonPath.split('/').filter(Boolean));

	if (!fs.existsSync(workflowFilePath)) throw new Error(`Workflow JSON не найден: ${workflowFilePath}`);

	const workflowJson = JSON.parse(fs.readFileSync(workflowFilePath, 'utf-8'));

	// ── Строим overrides и собираем файлы ────────────────────────────
	// Файлы: отправляются через multipart input_files, в override пишется имя файла
	// Скаляры: пишутся в override напрямую
	// JSON на диске не меняем
	const inputFiles: { path: string; filename: string; nodeId: string; fieldName: string }[] = [];
	const overrides: Record<string, Record<string, any>> = {};
	const importData: Record<string, any[]> = _item.import ?? {};

	for (const [key, values] of Object.entries(importData)) {
		const navValue: string = typeof _item[key] === 'string' ? _item[key] : '';
		if (!navValue) continue;

		const colonIdx = navValue.lastIndexOf(':');
		const keysStr = colonIdx !== -1 ? navValue.slice(0, colonIdx) : navValue;
		const typeSuffix = colonIdx !== -1 ? navValue.slice(colonIdx + 1).toLowerCase() : '';
		const jsonKeys = keysStr.split('.').filter(Boolean);

		// Ожидаем API format: nodeId.inputs.fieldName
		if (jsonKeys.length < 3 || jsonKeys[1] !== 'inputs') {
			sendToMW('log', { text: `⚠️ Пропущен "${key}": путь не в API-формате (nodeId.inputs.field)` });
			continue;
		}
		const nodeId = jsonKeys[0];
		const fieldName = jsonKeys[jsonKeys.length - 1];

		const valueArray = Array.isArray(values) ? values : [values];
		if (!valueArray.length) continue;
		const rawValue = valueArray[0];
		if (rawValue == null) continue;

		// Пробуем разрезолвить как файл
		let resolvedFilePath: string | null = null;
		if (typeof rawValue === 'string') {
			if (fs.existsSync(rawValue)) {
				resolvedFilePath = rawValue;
			} else if (!path.isAbsolute(rawValue)) {
				const abs = path.join(_description.projectPathGD, rawValue);
				if (fs.existsSync(abs)) resolvedFilePath = abs;
			}
			if (!resolvedFilePath && FILE_TYPE_SUFFIXES.has(typeSuffix)) {
				sendToMW('log', { text: `⚠️ Файл не найден: ${rawValue}` });
			}
		}

		if (resolvedFilePath) {
			const filename = path.basename(resolvedFilePath);
			inputFiles.push({ path: resolvedFilePath, filename, nodeId, fieldName });
			// Override — имя файла, сервер сам сматчит с загруженным multipart-файлом
			if (!overrides[nodeId]) overrides[nodeId] = {};
			overrides[nodeId][fieldName] = filename;
			sendToMW('log', { text: `📁 File [${nodeId}.${fieldName}] = ${filename}` });
		} else {
			// Скаляр — конвертируем по типу
			let value: any = rawValue;
			if (typeSuffix === 'number' || typeSuffix === 'float' || typeSuffix === 'int') {
				const num = Number(rawValue);
				value = isNaN(num) ? rawValue : num;
			} else if (typeSuffix === 'boolean') {
				value = rawValue === 'true' || rawValue === true;
			} else {
				value = String(rawValue);
			}
			if (!overrides[nodeId]) overrides[nodeId] = {};
			overrides[nodeId][fieldName] = value;
			sendToMW('log', { text: `📝 Override [${nodeId}.${fieldName}] = ${JSON.stringify(value)}` });
		}
	}

	sendToMW('log', {
		text: `📎 Input files: [${inputFiles.map((f) => f.filename).join(', ') || 'none'}]`,
	});

	// ── Отправляем на сервер с retry ─────────────────────────────────
	const serverUrl = 'https://x.kraslance.ru/v2/run';
	const serverToken = 'Bearer test-token';
	const baseUrl = new URL(serverUrl).origin;

	const result = await sendToComfyAsync({
		baseUrl,
		serverToken,
		workflowJson,
		inputFiles,
		overrides,
		targetDir,
		targetBaseName,
		description: _description,
	});

	if (result) finalFile.push(...result);
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}

// ── POST /v2/run multipart → 202 + job_id сразу ─────────────────────

async function sendToComfyAsync(opts: {
	baseUrl: string;
	serverToken: string;
	workflowJson: any;
	inputFiles: { path: string; filename: string; nodeId: string; fieldName: string }[];
	overrides: Record<string, Record<string, any>>;
	targetDir: string;
	targetBaseName: string;
	description: any;
}): Promise<string[] | null> {
	let attempt = 0;

	while (attempt < MAX_ATTEMPTS) {
		attempt++;
		try {
			sendToMW('log', { text: `🚀 ComfyUI attempt ${attempt}/${MAX_ATTEMPTS}` });

			// Собираем multipart через FormData
			const formData = new FormData();
			formData.append('workflow_json', JSON.stringify(opts.workflowJson));

			if (Object.keys(opts.overrides).length > 0) {
				formData.append('overrides_json', JSON.stringify(opts.overrides));
			}
			formData.append('timeout_sec', '0');

			for (const file of opts.inputFiles) {
				const content = fs.readFileSync(file.path);
				const mimeType = getMimeType(file.filename);
				const blob = new Blob([content], { type: mimeType });
				formData.append('input_files', blob, file.filename);
				sendToMW('log', { text: `  ↑ Attaching: ${file.filename} (${mimeType})` });
			}

			const headers: Record<string, string> = {};
			if (opts.serverToken) headers['Authorization'] = opts.serverToken;

			sendToMW('log', { text: `📨 POST ${opts.baseUrl}/v2/run` });

			// Ожидаем 202 — job принят, job_id возвращается сразу
			const res = await fetch(`${opts.baseUrl}/v2/run`, {
				method: 'POST',
				headers,
				body: formData,
			});

			if (res.status !== 202) {
				const text = await res.text();
				throw new Error(`POST /v2/run failed (${res.status}): ${text}`);
			}

			const enqueue: any = await res.json();
			const jobId: string = enqueue.job_id;
			const statusUrl: string | null = enqueue.status_url || null;

			sendToMW('log', {
				text: `📦 Job accepted: ${jobId} (status: ${enqueue.status}, status_url: ${statusUrl || 'n/a'})`,
			});

			// Отслеживаем прогресс и скачиваем результат
			return await pollAndDownload({
				jobId,
				statusUrl,
				baseUrl: opts.baseUrl,
				serverToken: opts.serverToken,
				targetDir: opts.targetDir,
				targetBaseName: opts.targetBaseName,
				infoText: opts.description?.infoText,
				curItem: opts.description?.curItem,
			});
		} catch (err: any) {
			sendToMW('log', { text: `❌ Attempt ${attempt} failed: ${err.message}` });
			if (attempt >= MAX_ATTEMPTS) {
				sendToMW('log', { text: `⏭ Skipped after ${MAX_ATTEMPTS} attempts` });
				return null;
			}
			sendToMW('log', { text: '🔁 Retrying in 5s…' });
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}
	}

	return null;
}

// ── Polling статуса ──────────────────────────────────────────────────

async function pollAndDownload(opts: {
	jobId: string;
	statusUrl: string | null;
	baseUrl: string;
	serverToken: string;
	targetDir: string;
	targetBaseName: string;
	infoText?: string;
	curItem?: string;
}): Promise<string[]> {
	// Используем status_url из ответа 202 если есть, иначе стандартный путь
	const statusPath = opts.statusUrl && opts.statusUrl.startsWith('/') ? opts.statusUrl : `/v2/jobs/${opts.jobId}`;
	const statusFullUrl = `${opts.baseUrl}${statusPath}`;
	const wsUrl = toWsUrl(`${opts.baseUrl}/v2/jobs/${opts.jobId}/ws`);

	const headers: Record<string, string> = opts.serverToken ? { Authorization: opts.serverToken } : {};
	const statusLabel = opts.infoText ? `${opts.infoText}: [ComfyUI]` : 'ComfyUI';
	const itemLabel = opts.curItem || '';

	sendToMW('log', { text: `🔍 Polling: ${statusFullUrl}` });
	sendToMW('log', { text: `   (WebSocket доступен: ${wsUrl})` });

	let lastStatus = '';
	while (true) {
		if (checkUserCancelled()) {
			sendToMW('log', { text: `🛑 User cancelled job [${opts.jobId}]` });
			throw new Error(`Job ${opts.jobId} cancelled by user`);
		}

		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

		const statusRes = await fetch(statusFullUrl, { headers });
		if (!statusRes.ok) throw new Error(`GET ${statusPath} failed: ${statusRes.status}`);
		const statusData: any = await statusRes.json();

		const status: string = (statusData.status || '').toLowerCase();
		const progress: number = statusData.progress ?? 0;

		sendToMW('statusbar', { text: `${statusLabel}\n${itemLabel} — ${progress}%` });
		if (status !== lastStatus) {
			sendToMW('log', { text: `🔄 Job [${opts.jobId}] status: ${status} (${progress}%)` });
			lastStatus = status;
		}

		if (status === 'done') {
			sendToMW('log', { text: `📋 Full status response:\n${JSON.stringify(statusData, null, 2)}` });
			sendToMW('log', { text: `📋 Outputs array: ${JSON.stringify(statusData.outputs)}` });
			return await downloadOutputs(statusData.outputs, opts.targetDir, opts.targetBaseName, opts.baseUrl);
		}
		if (status === 'failed' || status === 'error' || status === 'cancelled') {
			throw new Error(`Job ${opts.jobId} failed: ${statusData.error || 'Unknown error'}`);
		}
	}
}

// ── Универсальная загрузка файла (Windows + macOS) ──────────────────
// Стримит body ответа прямо на диск (без буферизации в RAM), ставит таймаут
// через AbortSignal, удаляет частично записанный файл при ошибке.
// Возвращает размер скачанного файла в байтах.

async function downloadFileToDisk(
	fileUrl: string,
	targetPath: string,
	opts?: { timeoutMs?: number; headers?: Record<string, string> },
): Promise<number> {
	const timeoutMs = opts?.timeoutMs ?? 120_000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		sendToMW('log', { text: `🌐 Fetching URL: ${fileUrl}` });
		sendToMW('log', { text: `   Headers sent: ${JSON.stringify(opts?.headers ?? {})}` });

		const res = await fetch(fileUrl, { signal: controller.signal, headers: opts?.headers });

		sendToMW('log', { text: `📡 Response: HTTP ${res.status} ${res.statusText}` });
		sendToMW('log', { text: `   content-type: ${res.headers.get('content-type')}` });
		sendToMW('log', { text: `   content-length: ${res.headers.get('content-length')}` });
		sendToMW('log', { text: `   server: ${res.headers.get('server')}` });
		sendToMW('log', { text: `   x-forwarded-for: ${res.headers.get('x-forwarded-for')}` });
		sendToMW('log', { text: `   cf-ipcountry: ${res.headers.get('cf-ipcountry')}` });
		sendToMW('log', { text: `   final URL (after redirects): ${res.url}` });

		if (!res.ok) {
			const errBody = await res.text().catch(() => '(unreadable)');
			sendToMW('log', { text: `❌ Error body: ${errBody.slice(0, 500)}` });
			throw new Error(`HTTP ${res.status} ${res.statusText || ''} for ${fileUrl}`);
		}
		if (!res.body) {
			throw new Error(`Empty response body for ${fileUrl}`);
		}

		const contentLength = Number(res.headers.get('content-length')) || 0;
		sendToMW('log', { text: `   Expected size: ${contentLength > 0 ? (contentLength / 1024 / 1024).toFixed(2) + ' MB' : 'unknown'}` });

		const nodeStream = Readable.fromWeb(res.body as any);
		const fileStream = fs.createWriteStream(targetPath);

		let bytesReceived = 0;
		nodeStream.on('data', (chunk: Buffer) => {
			bytesReceived += chunk.length;
		});

		await pipeline(nodeStream, fileStream);

		sendToMW('log', { text: `   Bytes received via stream: ${bytesReceived}` });

		const stats = fs.statSync(targetPath);
		if (contentLength > 0 && stats.size !== contentLength) {
			throw new Error(`Size mismatch for ${fileUrl}: got ${stats.size}, expected ${contentLength}`);
		}
		return stats.size;
	} catch (err: any) {
		sendToMW('log', { text: `❌ Download error: ${err?.message}` });
		sendToMW('log', { text: `   err.name: ${err?.name}` });
		sendToMW('log', { text: `   err.code: ${err?.code}` });
		sendToMW('log', { text: `   err.cause: ${err?.cause ? String(err.cause) : 'none'}` });
		try {
			if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
		} catch {
			/* ignore cleanup errors */
		}
		if (err?.name === 'AbortError') {
			throw new Error(`Download timeout after ${timeoutMs}ms: ${fileUrl}`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

// ── Скачивание результатов ───────────────────────────────────────────

async function downloadOutputs(
	outputs: Array<{ url: string; filename: string; output_type: string }>,
	targetDir: string,
	targetBaseName: string,
	baseUrl: string,
): Promise<string[]> {
	const results: string[] = [];
	testAndCreateFolder(targetDir);

	for (let i = 0; i < outputs.length; i++) {
		const output = outputs[i];
		const fileUrl = output.url.startsWith('http') ? output.url : `${baseUrl}${output.url}`;
		const serverExt = path.extname(output.filename);
		const fileName = outputs.length === 1 ? `${targetBaseName}${serverExt}` : `${targetBaseName}_${i}${serverExt}`;
		const targetPath = path.join(targetDir, fileName);

		sendToMW('log', { text: `⬇️ Downloading: ${output.filename} → ${fileName}` });
		sendToMW('log', { text: `   URL: ${fileUrl}` });

		const startTime = Date.now();
		const size = await downloadFileToDisk(fileUrl, targetPath);
		const durationMs = Date.now() - startTime;

		sendToMW('log', {
			text: `✅ Saved (${(size / 1024 / 1024).toFixed(2)} MB in ${(durationMs / 1000).toFixed(1)}s): ${targetPath}`,
		});
		results.push(targetPath);
	}

	return results;
}
