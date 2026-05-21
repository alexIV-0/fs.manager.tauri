import { getFullInfoFromVideoFile } from './getFullInfoFromVideoFile';
import { spawnFFmpegCommand } from './spawnFFmpegCommand';
import { sendToMW } from '../../../../plugins-dev/_template/pluginSender';

export async function copyFileWithAddMetadata(_fileFrom: string, _fileTo: string, _description: any) {
	const description = {
		department: 'inovationHub', // тут просто наш отдел
		modification: _description.automationType, //типы модификаций в массиве,
		project: _description.projectName, //имя проекта/папки на GD,
		contact: _description.contact, //данные человека кто заказал текущую модификацию, // думаю в будущем тут имя (или контакт) человека, кто закачал файл на GD
	};
	// const jsonStr = JSON.stringify(description).replace(/'/g, "'\\''");
	const jsonStr = JSON.stringify(description);

	// sendToMW('statusbar', { text: `👉 ffprobPath: ${ffprobPath}` });

	const fileInfo = await getFullInfoFromVideoFile(_fileFrom, _description);
	const command = {
		text: `${_description.infoText}: [copy file whith add metadata]\n${_fileFrom} → ${_fileTo}`,
		duration: fileInfo.durationInSeconds,
		command: [`-i`, _fileFrom, `-metadata`, `description=${jsonStr}`, `-c`, `copy`, _fileTo],
	};

	// sendToMW('log', { level: 'info', text: `команда ffmpeg для вставки метаданных в видеофайл:\n${command.command}` });
	// sendToMW('log', { level: 'info', text: `👉 Значение метаданных: description=${jsonStr}` });
	// sendToMW('log', { level: 'info', text: `👉 Сырой jsonStr: ${jsonStr}` });

	await spawnFFmpegCommand(command, _description, sendToMW);
	// const file = _file;
	// const metadata = _metadata;
}
