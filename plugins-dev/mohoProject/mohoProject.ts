// mohoProject — запускает Lua-скрипт в Moho для обработки аудио-файлов в проекте.
// Tauri-port: child_process.exec → exec helper (Rust exec_command), fs через helper.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';


export async function mohoProjectFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { fs, exec, sendToMW } = ctx;
	const finalFile: string[] = [];

	const inputFiles = _item.import?.inputFile ?? [];
	if (inputFiles.length === 0) throw new Error('inputFile is empty');

	const inputFilePath = Array.isArray(inputFiles) ? inputFiles[0] : inputFiles;
	const projectFolder = path.dirname(inputFilePath);
	const originalMohoProject = path.basename(inputFilePath, path.extname(inputFilePath));

	const mohoRaw = _description.programmPath?.moho;
	const mohoPath = (Array.isArray(mohoRaw) ? String(mohoRaw[0]) : String(mohoRaw)).trim();
	if (!mohoPath) throw new Error('[mohoProject] description.programmPath.moho не указан');

	const scriptPath = path.join(projectFolder, 'script.lua');
	const luaScript =
		`taperedCogs = false
function MohoScript(moho)
	local file_path = "${inputFilePath.replace(/\\/g, '\\\\')}"
	moho:FileOpen(file_path)
	gd_auto_animation_general:Run(moho)
end
`;

	try {
		await fs.write(scriptPath, luaScript);

		const audioExts: string[] = _description.typeOfFile?.['audio'] ?? [];
		const mohoExts: string[] = _description.typeOfFile?.['moho'] ?? [];

		let audioFiles = await fs.filesByExt(projectFolder, audioExts);
		while (audioFiles.length > 0) {
			sendToMW('statusbar', {
				text: `${_description.infoText}: [Moho Project] Processing (${audioFiles.length} audio files)`,
			});

			const result = await exec(mohoPath, [scriptPath]);
			if (result.exit_code !== 0) {
				throw new Error(`Moho exited with code ${result.exit_code}: ${result.stderr.slice(-400)}`);
			}

			audioFiles = await fs.filesByExt(projectFolder, audioExts);
		}

		const mohoProjects = await fs.filesByExt(projectFolder, mohoExts);
		for (const mohoProj of mohoProjects) {
			const projName = path.basename(mohoProj, path.extname(mohoProj));
			if (projName !== originalMohoProject) {
				finalFile.push(path.join(projectFolder, mohoProj));
			}
		}

		await fs.remove(scriptPath).catch(() => {});
	} catch (error) {
		sendToMW('log', { text: `❌ Error in Moho plugin: ${error}` });
		throw error;
	}

	return finalFile;
}
