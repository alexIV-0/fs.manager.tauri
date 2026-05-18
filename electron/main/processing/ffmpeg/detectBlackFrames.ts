import { escapeShellArg } from '../../utilits/escapeShellArg';
import { getPathToProg } from '../../utilits/getPathToProg';
import { execFFmpegCommand } from './execFFmpegCommand';

export async function detectBlackFrames(inputFile: string, _description: any, amount: number = 98): Promise<number[]> {
	// const ffmpeg = await getPathToProg('ffmpeg');
	let ffmpeg = _description.programmPath.ffmpeg[0];
	const command = `${escapeShellArg(ffmpeg[0])} -i ${escapeShellArg(inputFile)} -vf blackframe=amount=${amount} -an -f null -`;

	try {
		const { stdout, stderr } = await execFFmpegCommand(command);

		const timeRegex = /t:([\d.]+)/g;
		const matches = [...stderr.matchAll(timeRegex)];
		const timestamps = [...new Set(matches.map((m) => parseFloat(m[1])))];
		timestamps.unshift(0);
		return timestamps;
	} catch (error: any) {
		console.error('FFmpeg error:', error.message);
		// console.error('stderr:', error.stderr);
		throw error;
	}
}
