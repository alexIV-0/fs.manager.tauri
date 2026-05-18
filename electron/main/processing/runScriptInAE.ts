import { exec } from 'child_process';
import chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface AEResult {
	success: boolean;
	data?: any;
	error?: string;
}

function buildScript(
	originalScriptPath: fs.PathOrFileDescriptor,
	inObj: Record<string, any>,
	lockPath: string,
	resultPath: string,
) {
	let script = fs.readFileSync(originalScriptPath, 'utf-8');

	// Вставляем аргументы
	script = script.replace(/var\s+inObj\s*=\s*\{\s*\}/, `var inObj = ${JSON.stringify(inObj)}`);

	// Заменяем вызов funcName(inObj) на перехватывающую обвязку
	script = script.replace(
		/(\w+)\(inObj\);/,
		(match, funcName) => `
var __lock__ = new File("${lockPath.replace(/\\/g, '/')}");
__lock__.open("w");
__lock__.write("working");
__lock__.close();

try {
    var __result__ = ${funcName}(inObj);
    var __rf__ = new File("${resultPath.replace(/\\/g, '/')}");
    __rf__.open("w");
    __rf__.write(JSON.stringify({ success: true, data: __result__ }));
    __rf__.close();
} catch(e) {
    var __rf__ = new File("${resultPath.replace(/\\/g, '/')}");
    __rf__.open("w");
    __rf__.write(JSON.stringify({ success: false, error: e.message }));
    __rf__.close();
}

__lock__.remove();
    `,
	);

	return script;
}

function launchInAE(aePath: string, scriptFile: string): void {
	if (process.platform === 'win32') {
		exec(`"${aePath}" -r "${scriptFile}"`);
	} else {
		const appName = path.basename(aePath, '.app');
		exec(`osascript -e 'tell application "${appName}" to DoScriptFile "${scriptFile}"'`);
	}
}

function watchForResult(resultPath: string, onResult: (result: AEResult) => void): void {
	const watcher = chokidar.watch(resultPath, {
		persistent: true,
		ignoreInitial: false,
	});

	const tryRead = (filePath: string) => {
		try {
			const content = fs.readFileSync(filePath, 'utf-8');
			const parsed = JSON.parse(content);

			watcher.close();
			fs.unlinkSync(filePath);

			onResult(parsed);
		} catch {
			// файл ещё пишется — ждём следующего события
		}
	};

	watcher.on('add', tryRead);
	watcher.on('change', tryRead);
}

export function runScriptInAE(aePath: string, originalScriptPath: string, inObj: Record<string, any>): Promise<AEResult> {
	return new Promise((resolve) => {
		const tempDir = path.dirname(inObj.tempScriptPath);
		if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
		const tempScriptName = path.basename(inObj.tempScriptPath, path.extname(inObj.tempScriptPath));

		const lockFile = path.join(tempDir, `ae_${tempScriptName}.lock`);
		const resultFile = path.join(tempDir, `ae_${tempScriptName}.json`);
		const tempScript = path.join(tempDir, `ae_${tempScriptName}.jsx`);

		const scriptContent = buildScript(originalScriptPath, inObj, lockFile, resultFile);
		fs.writeFileSync(tempScript, scriptContent, 'utf-8');

		// Подписываемся ДО запуска
		watchForResult(resultFile, (result) => {
			if (!inObj.keepTempFiles) {
				if (fs.existsSync(tempScript)) fs.unlinkSync(tempScript);
				if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
			}
			resolve(result);
		});

		// Запускаем AE без ожидания
		launchInAE(aePath, tempScript);
	});
}
