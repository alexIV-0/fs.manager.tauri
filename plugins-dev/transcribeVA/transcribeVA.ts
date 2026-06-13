import { fs, ffmpeg, exec, paths, system, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
import path from 'path';

export { onLoad } from '../_template/tauri';

// ── Форматы вывода ─────────────────────────────────────────────────────────────
// Расширение финального файла по выбранному формату. Сам whisper всегда гоним в
// пословный JSON (только там тайминги DTW-точные), а srt/vtt/txt собираем сами.

const FORMAT_EXT: Record<string, string> = {
	jsonfull: '.json',
	json:     '.json',
	srt:      '.srt',
	vtt:      '.vtt',
	txt:      '.txt',
};

// Модели от наименьшей к наибольшей для детекта языка
const DETECT_MODELS = ['ggml-tiny.bin', 'ggml-base.bin', 'ggml-small.bin', 'ggml-medium.bin'];

// Длительности аудио для попыток детекта языка (ms)
const DETECT_DURATIONS = [20000, 30000, 40000, 50000, 60000];

// ── Пресеты DTW (token-level тайминги) ──────────────────────────────────────────
// Ключ — нормализованное имя модели, значение — пресет alignment-heads, который
// понимает whisper-cli (флаг -dtw). Пресет ОБЯЗАН соответствовать архитектуре
// модели: при несовпадении whisper-cli падает на aheads_masks_init().
const MODEL_DTW: Record<string, string> = {
	'tiny':           'tiny',
	'tiny.en':        'tiny.en',
	'base':           'base',
	'base.en':        'base.en',
	'small':          'small',
	'small.en':       'small.en',
	'medium':         'medium',
	'medium.en':      'medium.en',
	'large-v1':       'large.v1',
	'large-v2':       'large.v2',
	'large-v3':       'large.v3',
	'large-v3-turbo': 'large.v3.turbo',
};

// Имя файла модели → пресет DTW (или null, если модель неизвестна).
function modelToDtwPreset(modelFile: string): string | null {
	const norm = path.basename(modelFile)
		.replace(/^ggml-/i, '')           // ggml-large-v3-turbo.bin → large-v3-turbo.bin
		.replace(/\.bin$/i, '')           // → large-v3-turbo
		.replace(/-q[0-9]+(_[0-9]+)?$/i, ''); // квантизация: -q5_0, -q8_0 → отбрасываем
	return MODEL_DTW[norm] ?? null;
}


// ── Корень плагина (где лежит whisper/) ──────────────────────────────────────────
// В проде плагин установлен в app_data/plugins/<id>@<ver>, в dev — distr-plugins/<id>@<ver>.
// Берём установочный путь самого плагина (pluginInstallPath по id/version из pluginCtx);
// fallback на plugins-dev/transcribeVA — только для старого dev-сценария.
async function resolvePluginRoot(ctx: any): Promise<string | null> {
	// Кандидаты id: из ctx (если прокинут 3-м аргументом) + хардкод собственного id
	// (плагин знает, что он transcribeVA — на случай старой сборки app без pluginCtx).
	const tries: Array<[string, string | undefined]> = [];
	if (ctx?.pluginId) tries.push([ctx.pluginId, ctx.pluginVersion]);
	tries.push(['transcribeVA', undefined]);

	for (const [id, ver] of tries) {
		try {
			const p = await paths.pluginInstallPath(id, ver);
			if (p) {
				sendToMW('log', { text: `[whisper] plugin root: ${p}` });
				return p;
			}
		} catch (e: any) {
			sendToMW('log', { level: 'warn', text: `[whisper] pluginInstallPath(${id}) failed: ${e?.message ?? String(e)}` });
		}
	}
	// Старый dev-сценарий: plugins-dev/transcribeVA.
	try {
		const dev = path.join(await paths.pluginsDev(), 'transcribeVA');
		sendToMW('log', { text: `[whisper] plugin root (dev fallback): ${dev}` });
		return dev;
	} catch {
		return null;
	}
}

// ── Путь к бинарнику ───────────────────────────────────────────────────────────

async function getWhisperBin(pluginRoot: string, platformTarget: string): Promise<string> {
	const isWin = platformTarget.startsWith('win-');
	const fileName = isWin ? 'whisper-cli.exe' : 'whisper-cli';
	return path.join(pluginRoot, 'whisper', platformTarget, fileName);
}

// ── VAD-модель (Silero) ──────────────────────────────────────────────────────────
// Одна кросс-платформенная модель на всё (не зависит от модели транскрипции и от ОС).
// Лежит в плагине рядом с бинарниками; список — от новой версии к старой.
const VAD_MODELS = ['ggml-silero-v6.2.0.bin', 'ggml-silero-v5.1.2.bin'];

async function getVadModel(pluginRoot: string): Promise<string | null> {
	const vadDir = path.join(pluginRoot, 'whisper', 'vad');
	for (const name of VAD_MODELS) {
		const modelPath = path.join(vadDir, name);
		if (await fs.exists(modelPath)) return modelPath;
	}
	return null;
}

// ── Наименьшая доступная модель ────────────────────────────────────────────────

async function findLightestModel(modelsFolder: string): Promise<string> {
	for (const modelName of DETECT_MODELS) {
		const modelPath = path.join(modelsFolder, modelName);
		if (await fs.exists(modelPath)) return modelPath;
	}
	throw new Error(`[whisper] no detect model found in: ${modelsFolder}`);
}

// ── Детект языка с нарастающей длительностью ──────────────────────────────────

async function detectLanguage(bin: string, modelPath: string, audioFile: string, threads: number, nodeId?: string): Promise<string> {
	for (const duration of DETECT_DURATIONS) {
		const args = [
			'-m', modelPath,
			'-f', audioFile,
			'--language', 'auto',
			'--duration', String(duration),
			'--threads', String(threads),
			// `--print-special` намеренно выключен: whisper-cli и без него печатает
			// "auto-detected language: xx", а с ним льёт тысячи [_TT_*] токенов в stderr —
			// это затапливало webview-listener и вешало UI (см. exec_commands.rs throttle).
		];
		try {
			const result = await exec(bin, args, { nodeId });
			const output = (result?.stdout ?? '') + (result?.stderr ?? '');
			const langMatch = output.match(/auto-detected language:\s*(\w+)/i);
			if (langMatch?.[1]) {
				sendToMW('log', { text: `[whisper] language "${langMatch[1]}" detected at ${duration / 1000}s` });
				return langMatch[1];
			}
		} catch (e: any) {
			sendToMW('log', { level: 'error', text: `[whisper] detect error at ${duration / 1000}s: ${e?.message ?? String(e)}` });
		}
	}
	sendToMW('log', { text: '[whisper] language not detected, falling back to "en"' });
	return 'en';
}

// ── Аргументы для транскрипции ─────────────────────────────────────────────────

function buildTranscribeArgs(
	modelPath: string,
	audioFile: string,
	language: string,
	outputFile: string,
	threads: number,
	dtwPreset: string | null,
	vadModel: string | null,
	vadThreshold: number,
): string[] {
	const args = [
		'-m', modelPath,
		'-f', audioFile,
		'--language', language,
		'--threads', String(threads),
		'--beam-size', '5',
		'--temperature', '0',
		'--suppress-nst',
		'--no-speech-thold', '0.6',
		'--logprob-thold', '-1.0',
		// Всегда пословный JSON-full: только из него тайминги DTW-точные. Любой
		// финальный формат (srt/vtt/json/txt) собираем сами из слов. SRT-вывод
		// самого whisper'а DTW игнорирует — берёт грубые «родные» таймкоды сегментов.
		// max-len 1 + split-on-word — по одному слову на сегмент.
		// max-context 0 — окна декодятся независимо, таймкоды не «дрейфуют» на длинных файлах.
		'--output-json-full',
		'--max-len', '1',
		'--split-on-word',
		'--max-context', '0',
		'--output-file', outputFile,
	];
	// Token-level тайминги через DTW: whisper выравнивает токены по аудио через
	// cross-attention веса, а не интерполирует таймкоды сегмента. Главный рычаг
	// точности. Пресет берётся под конкретную модель.
	// ВАЖНО: бинарник собран с flash attention (-fa) по умолчанию, а DTW с ним
	// несовместим — whisper молча его отключает ("dtw_token_timestamps is not
	// supported with flash_attn - disabling"). Поэтому при DTW гасим flash attn.
	if (dtwPreset) {
		args.push('--dtw', dtwPreset, '--no-flash-attn');
	}
	// VAD (Silero): транскрибируем только участки с речью, тишина/музыка отбрасываются.
	// whisper-cli сам мапит таймкоды обратно на исходную таймлинию (orig_start/orig_end).
	// vad-speech-pad-ms чуть выше дефолта (30→100), чтобы не срезать края слов на границах.
	// vad-threshold: выше = строже (отсекает музыку/эмбиент, которые Silero иначе
	// принимает за речь и whisper лепит туда фантомные слова); ниже = ловит тихую речь.
	if (vadModel) {
		args.push('--vad', '--vad-model', vadModel, '--vad-speech-pad-ms', '100', '--vad-threshold', String(vadThreshold));
	}
	return args;
}

// ── Пересборка слов во фразы (DTW-тайминги → читаемые субтитры) ───────────────────
// whisper отдаёт пословные DTW-тайминги (--max-len 1). Группируем слова в строки
// гибридно: режем по концу предложения, по паузе и по лимитам длины/длительности.

type WhisperWord = { text: string; from: number; to: number }; // мс
type SubLine     = { text: string; from: number; to: number }; // мс

const GROUP = {
	pauseGapMs:    600,   // пауза между словами больше этого → новая строка
	maxChars:      84,    // максимум символов в строке
	maxDurationMs: 6000,  // максимум длительности строки
	maxWordTailMs: 1200,  // кап на длительность ОДНОГО слова: DTW иногда «впитывает»
	                      // паузу в последнее слово — обрезаем хвост, чтобы титр не висел
	minLineMs:     500,   // минимальная длительность строки (защита от мигания)
};

// Конец предложения: . ! ? … (возможно с закрывающей кавычкой/скобкой).
const SENTENCE_END = /[.!?…](["»”'’)\]]+)?$/;

function parseWhisperWords(jsonText: string): WhisperWord[] {
	const data = JSON.parse(jsonText);
	const words: WhisperWord[] = [];
	for (const seg of data?.transcription ?? []) {
		const text = (seg?.text ?? '').trim();
		const from = seg?.offsets?.from;
		const to   = seg?.offsets?.to;
		if (!text || typeof from !== 'number' || typeof to !== 'number') continue;
		words.push({ text, from, to });
	}
	return words;
}

function groupWords(words: WhisperWord[]): SubLine[] {
	const lines: SubLine[] = [];
	let cur: WhisperWord[] = [];

	const flush = () => {
		if (!cur.length) return;
		const from = cur[0].from;
		const last = cur[cur.length - 1];
		// Хвост последнего слова кап'аем — DTW мог растянуть его на паузу.
		let to = Math.min(last.to, last.from + GROUP.maxWordTailMs);
		if (to - from < GROUP.minLineMs) to = from + GROUP.minLineMs;
		const text = cur.map(w => w.text).join(' ').replace(/\s+([,.!?…:;])/g, '$1');
		lines.push({ text, from, to });
		cur = [];
	};

	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		cur.push(w);
		const next = words[i + 1];
		const chars = cur.reduce((n, x) => n + x.text.length + 1, 0);
		const dur = w.to - cur[0].from;
		const gapToNext = next ? next.from - w.to : Infinity;
		if (
			!next ||                          // конец
			SENTENCE_END.test(w.text) ||      // конец предложения
			gapToNext > GROUP.pauseGapMs ||   // пауза между словами
			chars >= GROUP.maxChars ||        // строка длинная
			dur >= GROUP.maxDurationMs        // строка долгая
		) {
			flush();
		}
	}

	// Не даём строкам перекрываться по времени.
	for (let i = 0; i < lines.length - 1; i++) {
		if (lines[i].to > lines[i + 1].from) lines[i].to = lines[i + 1].from;
	}
	return lines;
}

// ── Сериализация ─────────────────────────────────────────────────────────────────

function pad(n: number, len = 2): string { return String(n).padStart(len, '0'); }

function msToStamp(ms: number, sep: string): string {
	const h = Math.floor(ms / 3600000);
	const m = Math.floor((ms % 3600000) / 60000);
	const s = Math.floor((ms % 60000) / 1000);
	return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(Math.floor(ms % 1000), 3)}`;
}

function buildSrt(lines: SubLine[]): string {
	return lines
		.map((l, i) => `${i + 1}\n${msToStamp(l.from, ',')} --> ${msToStamp(l.to, ',')}\n${l.text}\n`)
		.join('\n');
}

function buildVtt(lines: SubLine[]): string {
	const body = lines
		.map(l => `${msToStamp(l.from, '.')} --> ${msToStamp(l.to, '.')}\n${l.text}`)
		.join('\n\n');
	return `WEBVTT\n\n${body}\n`;
}

// Чистый по-фразовый JSON с точными таймингами (формат "json", в отличие от
// сырого пословного "JSONfull").
function buildJson(lines: SubLine[]): string {
	return JSON.stringify(lines.map(l => ({ from: l.from, to: l.to, text: l.text })), null, 2);
}

// ── Основная функция плагина ───────────────────────────────────────────────────

export async function transcribeAudioFunc(_item: any, _description: any, _ctx?: any): Promise<string[]> {
	const finalFiles: string[] = [];
	const startTime = Date.now();
	const nodeId: string | undefined = _item?.id;

	const [pluginRoot, platformTarget, cpuCount] = await Promise.all([
		resolvePluginRoot(_ctx),
		paths.platformTarget(),
		system.cpuCount(),
	]);
	if (!pluginRoot) {
		sendToMW('log', { level: 'error', text: '[whisper] cannot locate plugin folder (install path & plugins-dev both unavailable)' });
		return [];
	}
	const bin = await getWhisperBin(pluginRoot, platformTarget);
	// Отдаём whisper-cli все логические ядра минус 2 (оставляем системе/UI).
	// hardwareConcurrency из WebView не подходит — Safari clamp'ит до 8.
	const threads = Math.max(4, cpuCount - 2);
	sendToMW('log', { text: `[whisper] using ${threads} threads (CPU: ${cpuCount} cores)` });

	// VAD (слайдер vadThreshold): 0 — выключен, >0 — порог чувствительности (clamp в
	// [0, 0.9], дефолт 0.5 как у Silero). Модель — одна на все транскрипции.
	const vadThreshold = (() => {
		const v = Number(_item.vadThreshold);
		return Number.isFinite(v) ? Math.min(0.9, Math.max(0, v)) : 0.5;
	})();
	const useVad = vadThreshold > 0;
	const vadModel = useVad ? await getVadModel(pluginRoot) : null;
	if (useVad && !vadModel) {
		sendToMW('log', { level: 'warn', text: `[whisper] VAD on, but no Silero model found in whisper/vad/ — running without VAD` });
	}

	const modelsFolder = _description?.folderPath?.whisper?.[0];
	if (!modelsFolder) {
		sendToMW('log', { level: 'error', text: '[whisper] whisper models folder not configured (Settings → Paths)' });
		return [];
	}

	if (!await fs.exists(bin)) {
		sendToMW('log', { level: 'error', text: `[whisper] binary not found: ${bin}` });
		return [];
	}

	let curPath: string[] = (_item.targetPath?.length > 0) ? [..._item.targetPath] : ['$clearName ($random(3))'];
	if (_item.import?.targetPath) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const fileForName: string = _description?.pathForDelete ?? '';

	sendToMW('log', { text: '[whisper] 🎤 Initializing Whisper...' });
	sendToMW('statusbar', { text: `${_description?.infoText ?? ''}: [whisper] transcribe\n${_description?.curItem ?? ''}` });

	const inputFiles: string[] = _item.import?.inputFile ?? [];
	let iteration = 1;

	for (const fileFrom of inputFiles) {
		let fileTo: string;
		try {
			fileTo = createPathForFileByPattern(curPath, _description, fileForName);
		} catch {
			fileTo = path.join(path.dirname(fileFrom), 'transcription_result');
		}

		if (inputFiles.length > 1) {
			const ext = path.extname(fileTo);
			const base = path.basename(fileTo, ext);
			const dir = path.dirname(fileTo);
			fileTo = path.join(dir, `${base}_${iteration}${ext}`);
			iteration++;
		}

		// Проверяем наличие аудио потока
		let fileInfo: any;
		try {
			fileInfo = await ffmpeg.getInfo(fileFrom);
		} catch (e: any) {
			sendToMW('log', { level: 'warn', text: `[whisper] cannot probe file ${fileFrom}: ${e?.message}` });
			continue;
		}
		if (!fileInfo.hasAudio) {
			sendToMW('log', { level: 'warn', text: `[whisper] no audio stream in: ${fileFrom}` });
			continue;
		}
		sendToMW('log', { text: `[whisper] file: ${fileInfo.durationInTimcode} (${fileInfo.durationInSeconds}s)` });

		const fileDir = path.dirname(fileTo);
		await fs.mkdir(fileDir);
		const fileBaseName = path.basename(fileTo, path.extname(fileTo));

		// 1. Конвертируем в WAV 16kHz mono
		const pcmFile = path.join(fileDir, `${fileBaseName}_temp.wav`);
		await ffmpeg.run({
			command: ['-y', '-i', fileFrom, '-vn', '-ac', '1', '-ar', '16000', pcmFile],
			text: `${_description?.infoText ?? ''}: [whisper] preparing audio`,
		});

		// 2. Определяем язык
		const lightModel = await findLightestModel(modelsFolder);
		const detectedLang = await detectLanguage(bin, lightModel, pcmFile, threads, nodeId);

		// ── Режим "только детект языка" ───────────────────────────────────────
		const outputFormatRaw = (_item.outputFormat ?? 'jsonfull');
		if (outputFormatRaw === 'Detect Language') {
			const langFile = path.join(fileDir, `${fileBaseName} [${detectedLang}].txt`);
			await fs.write(langFile, '');
			sendToMW('log', { text: `[whisper] detected language: "${detectedLang}" → ${langFile}` });
			finalFiles.push(langFile);
			await tryRemove(pcmFile);
			continue;
		}

		// 3. Основная транскрипция → всегда пословный JSON, затем сборка нужного формата
		const outputFormat = outputFormatRaw.toLowerCase();
		const ext = FORMAT_EXT[outputFormat] ?? '.json';
		const modelFile = _item.whisperModel ?? 'ggml-large-v3-turbo.bin';
		const modelPath = path.join(modelsFolder, modelFile);

		if (!await fs.exists(modelPath)) {
			sendToMW('log', { level: 'error', text: `[whisper] model not found: ${modelPath}` });
			await tryRemove(pcmFile);
			continue;
		}

		const dtwPreset = modelToDtwPreset(modelFile);
		if (dtwPreset) {
			sendToMW('log', { text: `[whisper] DTW timestamps preset: ${dtwPreset}` });
		} else {
			sendToMW('log', { level: 'warn', text: `[whisper] no DTW preset for "${modelFile}" — word timings will be approximate` });
		}

		const outputBase = path.join(fileDir, `${fileBaseName} (whisper)`);
		const transcribeArgs = buildTranscribeArgs(modelPath, pcmFile, detectedLang, outputBase, threads, dtwPreset, vadModel, vadThreshold);
		sendToMW('log', { text: `[whisper] transcribing, model: ${modelFile}, lang: ${detectedLang}, VAD: ${vadModel ? `on (thold ${vadThreshold})` : 'off'}` });

		const transcribeResult = await exec(bin, transcribeArgs, { nodeId });
		if (transcribeResult.exit_code !== 0) {
			sendToMW('log', { level: 'error', text: `[whisper] transcription failed:\n${transcribeResult.stderr.slice(-500)}` });
			await tryRemove(pcmFile);
			continue;
		}

		// whisper с --output-json-full пишет <outputBase>.json
		const rawJsonPath = `${outputBase}.json`;

		if (outputFormat === 'jsonfull') {
			// Сырой пословный JSON — это и есть запрошенный результат.
			finalFiles.push(rawJsonPath);
		} else {
			// srt / vtt / json / txt — пересобираем слова во фразы с DTW-таймингами.
			try {
				const words = parseWhisperWords(await fs.read(rawJsonPath));
				const lines = groupWords(words);
				const finalPath = `${outputBase}${ext}`;
				const content =
					outputFormat === 'vtt'  ? buildVtt(lines) :
					outputFormat === 'json' ? buildJson(lines) :
					outputFormat === 'txt'  ? lines.map(l => l.text).join('\n') + '\n' :
					buildSrt(lines);
				await fs.write(finalPath, content);
				sendToMW('log', { text: `[whisper] built ${outputFormat}: ${lines.length} lines from ${words.length} words` });
				finalFiles.push(finalPath);
			} catch (e: any) {
				sendToMW('log', { level: 'error', text: `[whisper] failed to build ${outputFormat} from words: ${e?.message ?? String(e)}` });
			} finally {
				// Сырой JSON — промежуточный, финальный формат уже записан.
				await tryRemove(rawJsonPath);
			}
		}

		// 4. Удаляем temp WAV
		await tryRemove(pcmFile);
	}

	const elapsed = msToTime(Date.now() - startTime);
	sendToMW('log', { level: 'info', text: `[whisper] ⏱ done in ${elapsed}\nResult:\n${finalFiles.join('\n')}` });
	return finalFiles;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function tryRemove(p: string) {
	try { await fs.remove(p); } catch {}
}

function msToTime(ms: number): string {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
	if (m > 0) return `${m}m ${s % 60}s`;
	return `${s}s`;
}
