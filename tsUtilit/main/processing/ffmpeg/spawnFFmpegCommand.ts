import { spawn } from 'child_process';

export async function spawnFFmpegCommand(command: any, description: any, sendToMW?: any): Promise<any> {
	// const ffmpeg = await getPathToProg('ffmpeg');
	// const ffmpeg = ffmpegPath ? ffmpegPath : await getPathToProg('ffmpeg');
	const ffmpegRaw = description.programmPath.ffmpeg;
	const ffmpegBin = (Array.isArray(ffmpegRaw) ? String(ffmpegRaw[0]) : String(ffmpegRaw)).trim();
	// .replace(/^["']|["']$/g, '');

	sendToMW('log', { text: `ffmpeg path: ${ffmpegBin}\nspawFFmpeg command: ${command.command.join(' ')}` });

	return new Promise<void>((resolve, reject) => {
		const process = spawn(ffmpegBin, command.command);

		let stderrOutput = '';

		process.stdout.on('data', (data: any) => {
			console.log(`stdout: ${data}`);
		});

		process.stderr.on('data', (data: { toString: () => any }) => {
			const output = data.toString();
			stderrOutput += output;
			const timeMatch = output.match(/time=(\d+:\d+:\d+.\d+)/);
			if (timeMatch) {
				const currentTime = timeMatch[1];
				const [hours, minutes, seconds] = currentTime.split(':').map(Number);
				const elapsedSeconds = hours * 3600 + minutes * 60 + seconds;
				const progress = ((elapsedSeconds / command.duration) * 100).toFixed(2);
				sendToMW('statusbar', { text: `${command.text}: ${progress}%` });
			}
		});
		process.on('close', (code: number) => {
			if (code !== 0) {
				const errLines = stderrOutput.split('\n').filter((l) => l.trim()).slice(-10).join('\n');
				sendToMW('log', { level: 'error', text: `ffmpeg error (code ${code}):\n${errLines}` });
				reject(new Error(`ffmpeg exited with code ${code}\n${errLines}`));
			} else {
				resolve();
			}
		});
	});
}
