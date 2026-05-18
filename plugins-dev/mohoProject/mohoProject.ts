import { getSomeFromFolder } from '../../electron/main/fileSistem/getSomeFromFolder';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

export { onLoad } from '../_template/pluginSender';

function execCommand(command: string): Promise<void> {
	return new Promise((resolve, reject) => {
		exec(command, (error) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
}

export async function mohoProjectFunc(_item: any, _description: any) {
	const finalFile: string[] = [];

	const inputFiles = _item.import?.inputFile ?? [];
	if (inputFiles.length === 0) {
		throw new Error('inputFile is empty');
	}

	const inputFilePath = Array.isArray(inputFiles) ? inputFiles[0] : inputFiles;
	const projectFolder = path.dirname(inputFilePath);
	const originalMohoProject = path.basename(inputFilePath, path.extname(inputFilePath));

	const mohoRaw = _description.programmPath.moho;
	const mohoPath = (Array.isArray(mohoRaw) ? String(mohoRaw[0]) : String(mohoRaw)).trim();

	const scriptPath = path.join(projectFolder, 'script.lua');

	const luaScript = `
taperedCogs = false
function MohoScript(moho)
	local file_path = "${inputFilePath.replace(/\\/g, '\\\\')}"
	moho:FileOpen(file_path)
	gd_auto_animation_general:Run(moho)
end
	`;

	try {
		fs.writeFileSync(scriptPath, luaScript, 'utf8');

		const command = `"${mohoPath}" "${scriptPath}"`;
		let audioFiles = getSomeFromFolder(projectFolder, [{ type: 'audio', ext: _description.typeOfFile['audio'] }]).audio;

		while (audioFiles.length > 0) {
			sendToMW('statusbar', {
				text: `${_description.infoText}: [Moho Project] Processing (${audioFiles.length} audio files)`,
			});

			await execCommand(command);

			audioFiles = getSomeFromFolder(projectFolder, [{ type: 'audio', ext: _description.typeOfFile['audio'] }]).audio;
		}

		const mohoProjects = getSomeFromFolder(projectFolder, [{ type: 'moho', ext: _description.typeOfFile['moho'] }]).moho;

		for (const mohoProj of mohoProjects) {
			const mohjoProjName = path.basename(mohoProj, path.extname(mohoProj));
			if (mohjoProjName !== originalMohoProject) {
				finalFile.push(path.join(projectFolder, mohoProj));
			}
		}

		fs.unlinkSync(scriptPath);
	} catch (error) {
		sendToMW('log', { text: `❌ Error in Moho plugin: ${error}` });
		throw error;
	}

	return finalFile;
}
