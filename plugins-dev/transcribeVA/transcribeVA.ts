import type { PluginContext } from '../../src/PluginAPI/host';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
import { formatNameByPattern } from '../../src/Utils/formatNameByPattern';
import path from 'path';


// ── Форматы вывода ─────────────────────────────────────────────────────────────
// Расширение финального файла по выбранному формату. Сам whisper всегда гоним в
// пословный JSON (только там есть ПОСЛОВНЫЕ тайминги), а srt/vtt/txt собираем сами.

const FORMAT_EXT: Record<string, string> = {
	jsonfull: '.json',
	json:     '.json',
	srt:      '.srt',
	vtt:      '.vtt',
	txt:      '.txt',
};

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
async function resolvePluginRoot(ctx: PluginContext): Promise<string | null> {
	const { paths, sendToMW } = ctx;
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

async function getVadModel(pluginRoot: string, ctx: PluginContext): Promise<string | null> {
	const { fs } = ctx;
	const vadDir = path.join(pluginRoot, 'whisper', 'vad');
	for (const name of VAD_MODELS) {
		const modelPath = path.join(vadDir, name);
		if (await fs.exists(modelPath)) return modelPath;
	}
	return null;
}

// ── Разведочный прогон: язык + карта речи ────────────────────────────────────────
// `-dl` (--detect-language): whisper определяет язык и СРАЗУ выходит (без транскрипции).
// С включённым VAD и `-debug` этот дешёвый прогон отдаёт СРАЗУ две вещи:
//   • язык — определённый по речи, а не по музыкальному интро (без этого `auto` на
//     основном прогоне срывается на интро: когда-то это давало ko/zh и падение на UTF-8);
//   • карту речевых кусков (`vad_segment_info`) — где в файле реально говорят.
//
// Карта зависит только от аудио и Silero-модели, не от модели транскрипции — сверено,
// tiny и large-v3 отдают побайтово одинаковую. Поэтому гоняем самой лёгкой доступной:
// tiny укладывается в ~0.7 c там, где large-v3 тратит ~13 c.
const PROBE_MODELS = ['ggml-tiny.bin', 'ggml-base.bin', 'ggml-small.bin'];

async function findProbeModel(modelsFolder: string, fallback: string, ctx: PluginContext): Promise<string> {
	const { fs } = ctx;
	for (const name of PROBE_MODELS) {
		const p = path.join(modelsFolder, name);
		if (await fs.exists(p)) return p;
	}
	// Лёгкой модели нет — разведка пойдёт основной. Дороже, но работает.
	return fallback;
}

async function probeAudio(
	bin: string,
	probeModelPath: string,
	audioFile: string,
	threads: number,
	vadModel: string | null,
	vadThreshold: number,
	ctx: PluginContext,
	nodeId?: string,
): Promise<{ lang: string; vadMap: VadSeg[] }> {
	const { exec, sendToMW } = ctx;
	const args = [
		'-m', probeModelPath,
		'-f', audioFile,
		'--language', 'auto',
		'--detect-language',
		'--threads', String(threads),
	];
	if (vadModel) {
		args.push('--vad', '--vad-model', vadModel, '--vad-speech-pad-ms', '200',
			'--vad-threshold', String(vadThreshold), '-debug');
	}
	try {
		const result = await exec(bin, args, { nodeId });
		const output = (result?.stdout ?? '') + (result?.stderr ?? '');
		const m = output.match(/auto-detected language:\s*(\w+)/i);
		const vadMap = parseVadMap(output);
		if (!m?.[1]) sendToMW('log', { text: '[whisper] language not detected, falling back to "en"' });
		return { lang: m?.[1] ?? 'en', vadMap };
	} catch (e: any) {
		sendToMW('log', { level: 'error', text: `[whisper] probe failed: ${e?.message ?? String(e)}` });
		return { lang: 'en', vadMap: [] };
	}
}

// ── Аргументы для транскрипции ─────────────────────────────────────────────────

function buildTranscribeArgs(
	modelPath: string,
	audioFiles: string[],
	language: string,
	outputFile: string | null,
	threads: number,
	dtwPreset: string | null,
	crossContext: boolean,
	initialPrompt: string,
): string[] {
	// Несколько файлов whisper-cli принимает позиционно и кладёт результат рядом с каждым
	// (<файл>.json). Общий `--output-file` при этом задавать НЕЛЬЗЯ — все выходы уедут
	// в одно имя и затрут друг друга.
	const args = [
		'-m', modelPath,
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
		'--output-json-full',
		'--max-len', '1',
		'--split-on-word',
		// max-context: 0 — окна декодятся независимо, таймкоды не «дрейфуют» на длинных
		// файлах, НО whisper теряет связь между окнами → хуже капитализация и точки на
		// стыках предложений. crossContext=true переносит до 224 токенов прошлого текста
		// в следующее окно: пунктуация/регистр становятся связнее (реже теряются точки в
		// конце предложения) ценой риска дрейфа таймкодов и редких повторов на длинных
		// файлах. Дефолт — выкл (0), как было.
		'--max-context', crossContext ? '224' : '0',
	];
	if (outputFile) args.push('--output-file', outputFile);
	// Initial prompt — биасит whisper к нужному стилю пунктуации/орфографии и доменным
	// терминам. Язык промпта должен совпадать с языком записи (язык auto-определяется),
	// иначе может навредить → поле опциональное, заполняется под конкретную задачу.
	const prompt = (initialPrompt ?? '').trim();
	if (prompt) {
		args.push('--prompt', prompt);
	}
	// DTW: whisper выравнивает токены по аудио через cross-attention веса. ВАЖНО —
	// результат он кладёт в ОТДЕЛЬНОЕ поле `t_dtw`, а `token.offsets` не трогает
	// (замерено: с флагом и без него offsets совпадают, медиана расхождения 0 мс).
	// Тайминги мы берём из `token.offsets`, так что на точность флаг не влияет; само
	// же `t_dtw` систематически смещено и не годится. Оставлен ради побочного эффекта:
	// он гасит flash attention, а с ним прогон на CPU заметно медленнее (24 c против
	// 33 c на 75-секундном файле). Пресет обязан соответствовать архитектуре модели.
	if (dtwPreset) {
		args.push('--dtw', dtwPreset, '--no-flash-attn');
	}
	// VAD здесь НАМЕРЕННО НЕТ, хотя раньше был.
	//
	// `--vad` заставляет whisper.cpp вырезать тишину и склеить куски речи ДО модели —
	// и модель слышит склейку встык, без пауз и просодии. Замеры на реальном ролике:
	// с VAD «Sophie» превращалась в «sofi», «I'll get everything ready» — в «said get
	// everything ready», а целая реплика «I'm a very important man» пропадала совсем:
	// при пороге 0.5 Silero не считал её речью (покрытие 0%), и в модель она не попадала.
	// Тишину мы вместо этого размечаем ОТДЕЛЬНО (probeAudio) и правим ею тайминги слов
	// уже после распознавания — см. parseWhisperWords.
	//
	// Плата: считаем весь файл, а не только речь (на 75-секундном ролике 33 c против 25 c).

	args.push(...audioFiles);
	return args;
}

// ── Пересборка слов во фразы (пословные тайминги → читаемые субтитры) ────────────
// whisper отдаёт по слову на сегмент (--max-len 1). Группируем слова в строки
// гибридно: режем по концу предложения, по паузе и по лимитам длины/длительности.

type WhisperWord = { text: string; from: number; to: number }; // мс
type SubLine     = { text: string; from: number; to: number }; // мс
// Один речевой кусок VAD: где он лежит в оригинале (o*) и где — в сжатом аудио (v*).
type VadSeg      = { o0: number; o1: number; v0: number; v1: number }; // мс

// Ниже этого обрезка слова считается разрушительной (слово схлопнулось в точку).
const MIN_WORD_MS = 60;

// Насколько близко должна лежать речь, чтобы притянуть к ней слово, оказавшееся в тишине.
const NEAR_SEGMENT_MS = 1000;

// Какую долю своей длины слово должно провести в речи, чтобы считаться её частью.
const MIN_OVERLAP_RATIO = 0.5;

const GROUP = {
	pauseGapMs:     600,  // пауза между словами больше этого → новая строка,
	minCharsForGap: 25,   // ...но только если строка успела набрать текст: короткие паузы
	                      // случаются и посреди фразы, а огрызок в два слова читать нельзя
	hardGapMs:      900,  // ...а вот такая пауза рвёт строку всегда, даже на одном слове:
	                      // это уже смена реплики, и склейка через неё растянула бы титр
	                      // на всю тишину (ровно то, чем болел прежний алгоритм)
	maxChars:       84,   // максимум символов в строке
	maxDurationMs:  6000, // максимум длительности строки
	minLineMs:      500,  // минимальная длительность строки (защита от мигания)
};

// Конец предложения: . ! ? … (возможно с закрывающей кавычкой/скобкой).
const SENTENCE_END = /[.!?…](["»”'’)\]]+)?$/;

// Карта ремапа из stderr (`-debug`): без неё пословные тайминги нельзя вернуть
// на исходную таймлинию. Пусто = VAD выключен (тогда ремап и не нужен).
function parseVadMap(stderr: string): VadSeg[] {
	const re = /vad_segment_info: orig_start: ([\d.]+), orig_end: ([\d.]+), vad_start: ([\d.]+), vad_end: ([\d.]+)/g;
	const out: VadSeg[] = [];
	for (const m of stderr.matchAll(re)) {
		out.push({ o0: +m[1] * 1000, o1: +m[2] * 1000, v0: +m[3] * 1000, v1: +m[4] * 1000 });
	}
	return out;
}

// ── Нарезка на речевые блоки ────────────────────────────────────────────────────
// Whisper слышит только речь, но НЕ склеенную: каждый блок — непрерывный кусок аудио,
// который подаётся отдельным файлом. Этим снимается корень обеих болячек сразу:
//   • текст не деградирует, как при `--vad` (тот склеивает куски встык, и модель теряет
//     просодию: «Sophie» превращалась в «sofi», реплики пропадали целиком);
//   • слова не растягиваются через паузы, потому что пауз внутри блока почти нет —
//     а смещение блока известно точно, так что тайминги переносятся сложением.
// Соседние куски, разделённые паузой короче BLOCK_JOIN_MS, идут одним блоком: так у
// модели остаётся контекст фразы, а вызовов меньше.
const BLOCK_JOIN_MS = 2000;   // пауза короче — куски объединяем
const BLOCK_MIN_MS  = 500;    // блок короче — не транскрибируем (там обычно шум/музыка,
                              // и на коротком куске модель охотно выдумывает текст)
const BLOCK_PAD_MS  = 150;    // запас по краям, чтобы не срезать атаку и хвост слова

type SpeechBlock = { startMs: number; durMs: number };

function buildSpeechBlocks(vadMap: VadSeg[], totalMs: number): SpeechBlock[] {
	const joined: Array<[number, number]> = [];
	for (const s of vadMap) {
		const last = joined[joined.length - 1];
		if (last && s.o0 - last[1] < BLOCK_JOIN_MS) last[1] = s.o1;
		else joined.push([s.o0, s.o1]);
	}
	const blocks: SpeechBlock[] = [];
	for (const [a, b] of joined) {
		if (b - a < BLOCK_MIN_MS) continue;
		const start = Math.max(0, a - BLOCK_PAD_MS);
		const end = totalMs > 0 ? Math.min(totalMs, b + BLOCK_PAD_MS) : b + BLOCK_PAD_MS;
		blocks.push({ startMs: start, durMs: end - start });
	}
	return blocks;
}

// Слова берём из ТОКЕНОВ, а не из `seg.offsets`: сегменты whisper укладывает встык
// (t0 сегмента = t1 предыдущего), поэтому слово рядом с паузой впитывает её целиком —
// на реальном файле титр вставал на 4.5 c раньше реплики, а строки суммарно висели
// в тишине 16 из 36 секунд речи. У токенов границы настоящие.
//
// Тайминги здесь УЖЕ в исходной таймлинии: основной прогон идёт без `--vad`, аудио не
// сжималось, ремапить нечего. Карта речи нужна для другого — обрезать слова, которые
// модель растянула через паузу (последнее слово реплики она тянет до начала следующей).
// Это замена прежнему костылю `maxWordTailMs`.
function parseWhisperWords(jsonText: string, vadMap: VadSeg[], offsetMs = 0): WhisperWord[] {
	// Обрезаем слово по речевому куску, с которым оно пересекается сильнее всего.
	//
	// Слово, не пересёкшееся ни с одним куском, НЕ трогаем. Карта заведомо неполна:
	// Silero пропускает тихую речь — замерено, реплику, которую whisper распознал,
	// карта при пороге 0.5 не покрыла вовсе, при 0.2 покрыла на 43%. Прижимать такие
	// слова к ближайшей границе нельзя: уедут в чужую реплику и схлопнутся в точку.
	const clip = (from: number, to: number): [number, number] => {
		if (!vadMap.length) return [from, to];
		let best: VadSeg | null = null;
		let bestOverlap = 0;
		for (const s of vadMap) {
			// o0/o1 — координаты в ИСХОДНОМ аудио. Пара v0/v1 из той же строки описывает
			// сжатую таймлинию VAD-прогона и здесь ни при чём: наши слова уже исходные.
			const overlap = Math.min(to, s.o1) - Math.max(from, s.o0);
			if (overlap > bestOverlap) { bestOverlap = overlap; best = s; }
		}
		// Слово, задевшее речь только краем, лежит в ПАУЗЕ: whisper тянет первое слово
		// реплики от конца предыдущей, и такое слово нельзя обрезать «назад» — иначе титр
		// выскакивает задолго до того, как персонаж заговорил (замерено: «Thank» задевало
		// предыдущую реплику на 7% своей длины и вставало на 3.5 c раньше). Место такого
		// слова — начало СЛЕДУЮЩЕЙ речи.
		if (best && bestOverlap < (to - from) * MIN_OVERLAP_RATIO) {
			const next = vadMap.find(s => s.o0 >= from);
			if (next) return [next.o0, next.o0 + MIN_WORD_MS];
			best = null;
		}
		if (!best) {
			// Пересечения нет вовсе. Если речь начинается рядом (типичный случай — первое
			// слово файла, которое whisper тянет от нуля), переносим слово в этот кусок,
			// сохраняя длительность. Если рядом ничего нет — не трогаем: это, скорее
			// всего, тихая речь, которую Silero не расслышал, и её место мы не знаем.
			let near: VadSeg | null = null;
			let nearDist = NEAR_SEGMENT_MS;
			for (const s of vadMap) {
				const dist = to < s.o0 ? s.o0 - to : from > s.o1 ? from - s.o1 : 0;
				if (dist < nearDist) { nearDist = dist; near = s; }
			}
			if (!near) return [from, to];
			return [near.o0, Math.min(near.o1, near.o0 + (to - from))];
		}
		const f = Math.max(from, best.o0);
		const t = Math.min(to, best.o1);
		// Обрезка не должна съесть слово целиком — тогда лучше оставить как было.
		return t - f >= MIN_WORD_MS ? [f, t] : [from, to];
	};

	const data = JSON.parse(jsonText);
	const words: WhisperWord[] = [];
	for (const seg of data?.transcription ?? []) {
		const text = (seg?.text ?? '').trim();
		if (!text) continue;
		// Спецтокены ([_BEG_], [_TT_*]) несут мусорные offsets — выбрасываем.
		const tokens = (seg?.tokens ?? []).filter((t: any) => !String(t?.text ?? '').startsWith('[_'));
		const froms = tokens.map((t: any) => t?.offsets?.from).filter((n: any) => typeof n === 'number');
		const tos   = tokens.map((t: any) => t?.offsets?.to).filter((n: any) => typeof n === 'number');
		if (!froms.length || !tos.length) continue;
		const [from, to] = clip(Math.min(...froms) + offsetMs, Math.max(...tos) + offsetMs);
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
		// Тайминги пословные и отремаплены на исходную таймлинию — хвост честный,
		// капать его (как было, пока слова брались из `seg.offsets`) больше не нужно.
		let to = last.to;
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
			gapToNext > GROUP.hardGapMs ||    // длинная пауза = смена реплики
			(gapToNext > GROUP.pauseGapMs && chars >= GROUP.minCharsForGap) || // короткая
			chars >= GROUP.maxChars ||        // строка длинная
			dur >= GROUP.maxDurationMs        // строка долгая
		) {
			flush();
		}
	}

	// Слово, стоящее на стыке речевых кусков VAD, whisper иногда приписывает соседней
	// реплике (внутри куска слова уложены встык, и на границе выбор неоднозначен) — в
	// субтитрах это огрызок в одно-два слова, улетевший на секунды вперёд. Отличить его
	// от настоящей короткой реплики даёт пунктуация: настоящая начинается после
	// законченной фразы, огрызок продолжает оборванную. Такой огрызок возвращаем в
	// предыдущую строку, но его улетевший хвост не берём — иначе титр повиснет в тишине.
	const merged: SubLine[] = [];
	for (const line of lines) {
		const prev = merged[merged.length - 1];
		// Примыкание по времени обязательно: улетевший далеко огрызок — это, скорее
		// всего, начало следующей реплики. Одного «предыдущая строка не закончена» мало,
		// потому что whisper на части материала не ставит пунктуацию вообще — тогда
		// условие выполняется всегда, и строки слипаются каскадом, склеивая соседние
		// реплики в одну (текст двух реплик показывался на месте первой).
		const isOrphan = line.text.trim().split(/\s+/).length <= 2;
		const adjoins = !!prev && line.from - prev.to <= GROUP.pauseGapMs;
		if (prev && isOrphan && adjoins && !SENTENCE_END.test(prev.text)) {
			prev.text = `${prev.text} ${line.text}`;
			if (line.from - prev.to <= GROUP.pauseGapMs) prev.to = line.to;
			continue;
		}
		merged.push(line);
	}

	// Не даём строкам перекрываться по времени.
	for (let i = 0; i < merged.length - 1; i++) {
		if (merged[i].to > merged[i + 1].from) merged[i].to = merged[i + 1].from;
	}
	return merged;
}

// ── Сериализация ─────────────────────────────────────────────────────────────────

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

// Проза (формат "txt"): объединяем слова в предложения по знакам конца, БЕЗ субтитровых
// лимитов длины/длительности — текст не дробится по 84 символам/6 сек, а следует
// пунктуации whisper'а. Если предложение долго не заканчивается (точки нет), длинную
// паузу используем как запасной разрыв строки. Одно предложение/реплика — одна строка.
const PROSE_PARA_GAP_MS = 1500;
function buildProse(words: WhisperWord[]): string {
	const lines: string[] = [];
	let cur: WhisperWord[] = [];
	const flush = () => {
		if (!cur.length) return;
		const text = cur.map(w => w.text).join(' ').replace(/\s+([,.!?…:;])/g, '$1').trim();
		if (text) lines.push(text);
		cur = [];
	};
	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		cur.push(w);
		const next = words[i + 1];
		const gapToNext = next ? next.from - w.to : Infinity;
		if (!next || SENTENCE_END.test(w.text) || gapToNext > PROSE_PARA_GAP_MS) flush();
	}
	return lines.join('\n') + '\n';
}

// ── Основная функция плагина ───────────────────────────────────────────────────

export async function transcribeAudioFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { fs, ffmpeg, paths, system, exec, sendToMW } = ctx;
	const finalFiles: string[] = [];
	const startTime = Date.now();
	const nodeId: string | undefined = _item?.id;

	const [pluginRoot, platformTarget, cpuCount, tmpRoot] = await Promise.all([
		resolvePluginRoot(ctx),
		paths.platformTarget(),
		system.cpuCount(),
		paths.tmpdir(),
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

	// Слайдер vadThreshold: порог детектора речи для РАЗМЕТКИ ПАУЗ (не для фильтрации
	// аудио — основной прогон слышит файл целиком). 0 — коррекция таймингов выключена.
	// Рабочий диапазон низкий (0.2–0.35): пропустить тихую речь дороже, чем принять за
	// речь музыку — во втором случае мы просто ничего не обрежем.
	const vadThreshold = (() => {
		const v = Number(_item.vadThreshold);
		return Number.isFinite(v) ? Math.min(0.9, Math.max(0, v)) : 0.3;
	})();
	const useVad = vadThreshold > 0;
	const vadModel = useVad ? await getVadModel(pluginRoot, ctx) : null;
	if (useVad && !vadModel) {
		sendToMW('log', { level: 'warn', text: `[whisper] VAD on, but no Silero model found in whisper/vad/ — running without VAD` });
	}

	// Перенос контекста между окнами (точность пунктуации/регистра ↔ стабильность таймкодов).
	const crossContext = Boolean(_item.crossContext);
	// Опциональная начальная подсказка (initial prompt) для whisper.
	const initialPrompt = typeof _item.promptHint === 'string' ? _item.promptHint : '';

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

		// Вся I/O whisper (temp WAV + сырой JSON) идёт в ASCII-папку системного temp.
		// whisper-cli (whisper.cpp, narrow char* argv) на Windows коверкает не-ASCII пути —
		// кириллица/CJK в реальном пути назначения (имя файла ИЛИ родительские папки) ломают
		// чтение WAV и запись JSON, и шаг молча возвращает пусто. Поэтому реальный путь
		// whisper'у не отдаём вообще: работаем в temp под ASCII-именем ($random(5) — nanoid,
		// гарантированно ASCII), а готовый результат переносим в папку назначения через
		// Tauri fs (Rust, UTF-8 safe). Папка одноразовая — целиком чистится в finally.
		const workDir = path.join(tmpRoot, 'whisper', formatNameByPattern({ string: '$random(5)' }));
		await fs.mkdir(workDir);
		try {
			// 1. Конвертируем в WAV 16kHz mono (в temp-папку)
			const pcmFile = path.join(workDir, 'audio.wav');
			await ffmpeg.run({
				command: ['-y', '-i', fileFrom, '-vn', '-ac', '1', '-ar', '16000', pcmFile],
				text: `${_description?.infoText ?? ''}: [whisper] preparing audio`,
			});

			// 2. Модель (нужна и для detect-only, и для транскрипции)
			const outputFormatRaw = (_item.outputFormat ?? 'jsonfull');
			const modelFile = _item.whisperModel ?? 'ggml-large-v3-turbo.bin';
			const modelPath = path.join(modelsFolder, modelFile);
			if (!await fs.exists(modelPath)) {
				sendToMW('log', { level: 'error', text: `[whisper] model not found: ${modelPath}` });
				continue;
			}

			// ── Режим "только детект языка" ───────────────────────────────────────
			if (outputFormatRaw === 'Detect Language') {
				const probeModel = await findProbeModel(modelsFolder, modelPath, ctx);
				const { lang: detectedLang } = await probeAudio(bin, probeModel, pcmFile, threads, vadModel, vadThreshold, ctx, nodeId);
				const langFile = path.join(fileDir, `${fileBaseName} [${detectedLang}].txt`);
				await fs.write(langFile, '');
				sendToMW('log', { text: `[whisper] detected language: "${detectedLang}" → ${langFile}` });
				finalFiles.push(langFile);
				continue;
			}

			// 3. Разведка: язык + карта речи одним дешёвым прогоном. Язык отдаём основному
			// прогону явно — сам он теперь считает файл целиком, вместе с музыкой, и `auto`
			// на музыкальном интро способен уехать не в тот язык.
			const probeModel = await findProbeModel(modelsFolder, modelPath, ctx);
			const { lang: detectedLang, vadMap } = await probeAudio(bin, probeModel, pcmFile, threads, vadModel, vadThreshold, ctx, nodeId);
			sendToMW('log', { text: `[whisper] probe: language "${detectedLang}", речевых кусков: ${vadMap.length}${vadMap.length ? '' : ' (карты нет — тайминги не корректируются)'}` });

			// 4. Основная транскрипция: всегда пословный JSON, затем сборка формата.
			const outputFormat = outputFormatRaw.toLowerCase();
			const ext = FORMAT_EXT[outputFormat] ?? '.json';

			const dtwPreset = modelToDtwPreset(modelFile);
			if (dtwPreset) {
				sendToMW('log', { text: `[whisper] DTW timestamps preset: ${dtwPreset}` });
			} else {
				sendToMW('log', { level: 'warn', text: `[whisper] no DTW preset for "${modelFile}" — word timings will be approximate` });
			}

			// whisper пишет <outputBase>.json в temp-папку (ASCII). Финальное осмысленное имя —
			// `${fileBaseName} (whisper)` в папке назначения (как было раньше).
			const outputBase = path.join(workDir, 'out');
			const finalNameBase = path.join(fileDir, `${fileBaseName} (whisper)`);

			// Речевые блоки: аудио режется по карте, каждый блок идёт отдельным файлом.
			// Без карты (VAD выключен) остаётся прежний путь — один прогон по всему файлу.
			const totalMs = Math.round((fileInfo.durationInSeconds ?? 0) * 1000);
			const blocks = vadMap.length ? buildSpeechBlocks(vadMap, totalMs) : [];
			const pieces: Array<{ file: string; offsetMs: number }> = [];
			for (let b = 0; b < blocks.length; b++) {
				const piece = path.join(workDir, `blk${String(b).padStart(3, '0')}.wav`);
				await ffmpeg.run({
					command: ['-y', '-i', pcmFile, '-ss', (blocks[b].startMs / 1000).toFixed(3),
						'-t', (blocks[b].durMs / 1000).toFixed(3), '-ar', '16000', '-ac', '1', piece],
					text: `${_description?.infoText ?? ''}: [whisper] cutting speech ${b + 1}/${blocks.length}`,
				});
				pieces.push({ file: piece, offsetMs: blocks[b].startMs });
			}
			if (!pieces.length) pieces.push({ file: pcmFile, offsetMs: 0 });

			const single = pieces.length === 1 && pieces[0].file === pcmFile;
			const transcribeArgs = buildTranscribeArgs(modelPath, pieces.map(p => p.file), detectedLang,
				single ? outputBase : null, threads, dtwPreset, crossContext, initialPrompt);
			sendToMW('log', { text: `[whisper] transcribing, model: ${modelFile}, lang: ${detectedLang}, блоков речи: ${single ? 'без нарезки' : pieces.length}, cross-context: ${crossContext ? 'on' : 'off'}${initialPrompt.trim() ? ', prompt: on' : ''}` });

			const transcribeResult = await exec(bin, transcribeArgs, { nodeId });
			if (transcribeResult.exit_code !== 0) {
				sendToMW('log', { level: 'error', text: `[whisper] transcription failed:\n${transcribeResult.stderr.slice(-500)}` });
				continue;
			}
			// Какой язык whisper в итоге определил (из stderr основного прогона).
			const langMatch = (transcribeResult.stderr ?? '').match(/auto-detected language:\s*(\w+)/i);
			if (langMatch?.[1]) sendToMW('log', { text: `[whisper] auto-detected language: ${langMatch[1]}` });

			try {
				// Слова каждого блока сдвигаем на его смещение — так тайминги возвращаются
				// в таймлинию исходного файла без всякого ремапа.
				const words: WhisperWord[] = [];
				for (const piece of pieces) {
					const jsonPath = single ? `${outputBase}.json` : `${piece.file}.json`;
					words.push(...parseWhisperWords(await fs.read(jsonPath), vadMap, piece.offsetMs));
				}

				if (outputFormat === 'jsonfull') {
					// Пословный JSON собираем САМИ, а не отдаём файл whisper как есть: при
					// нарезке его выходов несколько, и в каждом своя таймлиния от нуля.
					// Формат прежний (`transcription[]` с `offsets`), тайминги — исходные.
					const finalJson = `${finalNameBase}.json`;
					await fs.write(finalJson, JSON.stringify({
						result: { language: detectedLang },
						transcription: words.map(w => ({
							offsets: { from: w.from, to: w.to },
							timestamps: { from: msToStamp(w.from, ','), to: msToStamp(w.to, ',') },
							text: w.text,
							tokens: [{ text: w.text, offsets: { from: w.from, to: w.to } }],
						})),
					}, null, 2));
					sendToMW('log', { text: `[whisper] built jsonfull: ${words.length} words` });
					finalFiles.push(finalJson);
				} else {
					const lines = groupWords(words);
					const finalPath = `${finalNameBase}${ext}`;
					const content =
						outputFormat === 'vtt'  ? buildVtt(lines) :
						outputFormat === 'json' ? buildJson(lines) :
						outputFormat === 'txt'  ? buildProse(words) :
						buildSrt(lines);
					await fs.write(finalPath, content);
					sendToMW('log', { text: `[whisper] built ${outputFormat}: ${lines.length} lines from ${words.length} words` });
					finalFiles.push(finalPath);
				}
			} catch (e: any) {
				sendToMW('log', { level: 'error', text: `[whisper] failed to build ${outputFormat}: ${e?.message ?? String(e)}` });
			}
		} finally {
			// Одноразовая temp-папка whisper целиком (WAV + сырой JSON + остатки) — удаляем
			// при любом исходе, включая continue/ошибку.
			await tryRemove(workDir, ctx);
		}
	}

	const elapsed = msToTime(Date.now() - startTime);
	sendToMW('log', { level: 'info', text: `[whisper] ⏱ done in ${elapsed}\nResult:\n${finalFiles.join('\n')}` });
	return finalFiles;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function tryRemove(p: string, ctx: PluginContext) {
	const { fs } = ctx;
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
