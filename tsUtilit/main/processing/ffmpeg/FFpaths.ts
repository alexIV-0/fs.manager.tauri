import { getPathToProg } from '../../utilits/getPathToProg';

// export const ffmpeg = getPathToProg('ffmpeg');
// export const ffprobe = getPathToProg('ffprobe');
let ffmpeg: string, ffprobe: string;

async function initializeFFmpeg() {
	ffmpeg = await getPathToProg('ffmpeg');
	ffprobe = await getPathToProg('ffprobe');
}

// Запустите инициализацию
initializeFFmpeg().catch(console.error);

export { ffmpeg, ffprobe };
