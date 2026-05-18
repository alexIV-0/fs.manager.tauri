import { convertSecondsToTimecode } from '../../utilits/convertSecondsToTimecode';
import { execFFmpegCommand } from './execFFmpegCommand';
// import { getPathToProg } from '../../utilits/getPathToProg';

export interface FullVideoInfo {
	durationInSeconds: number;
	durationInTimcode: string;

	fps: number;
	avg_frame_rate?: string;
	r_frame_rate?: string;
	time_base?: string;

	width: number;
	height: number;

	codec_name: string;
	profile?: string;
	level?: number;
	pix_fmt?: string;

	color_range?: string;
	color_space?: string;
	color_primaries?: string;
	color_transfer?: string;

	sar?: string;
	dar?: string;

	hasAudio: boolean;
	hasVideo: boolean;

	audioCodec?: string;
	audioSampleRate?: number;
	audioChannels?: number;
	audioChannelLayout?: string;
	audioBitrate?: number;
}

export async function getFullInfoFromVideoFile(_path: string, description: any): Promise<FullVideoInfo> {
	// try {
	// let ffprobe = ffprobePath || (await getPathToProg('ffprobe'));
	let ffprobe = description.programmPath.ffprobe[0];

	// const ffprobe = await getPathToProg('ffprobe');
	const command = `"${ffprobe}" -v error -show_entries stream=codec_name,profile,level,pix_fmt,r_frame_rate,avg_frame_rate,time_base,width,height,color_range,color_space,color_primaries,color_transfer,sample_aspect_ratio,display_aspect_ratio,duration,duration_ts,start_pts,start_time,codec_type,sample_rate,channels,channel_layout,bit_rate -of json "${_path}"`;

	const { stdout, stderr } = await execFFmpegCommand(command);
	if (stderr) throw new Error(`ffprobe error: ${stderr}`);

	const streams = JSON.parse(stdout).streams;
	const videoStream = streams.find((s: any) => s.codec_type === 'video');
	const audioStream = streams.find((s: any) => s.codec_type === 'audio');

	if (!videoStream && !audioStream) {
		throw new Error(`No video/audio streams found in file: ${_path}`);
	}

	// ------ FPS ------
	let fps = 0;

	const avg = videoStream?.avg_frame_rate;
	const r = videoStream?.r_frame_rate;

	const parseFps = (str?: string) => {
		if (!str || str === '0/0') return 0;
		const [n, d] = str.split('/').map(Number);
		return d ? n / d : 0;
	};

	fps = parseFps(avg);
	if (fps === 0) fps = parseFps(r);

	fps = Number(fps.toFixed(3));

	// ------ duration ------
	let durationSec = Number(videoStream?.duration);

	if (!durationSec || durationSec === 0) {
		const ts = Number(videoStream?.duration_ts);
		const tbStr = videoStream?.time_base;
		if (ts && tbStr) {
			const [num, den] = tbStr.split('/').map(Number);
			durationSec = ts * (num / den);
		}
	}

	if (!durationSec && audioStream?.duration) {
		durationSec = Number(audioStream.duration);
	}

	const durationInTimcode = convertSecondsToTimecode(durationSec || 0, fps || 25);

	// ------ RESULT ------
	const result: FullVideoInfo = {
		durationInSeconds: durationSec || 0,
		durationInTimcode,

		// FPS-related
		fps,
		avg_frame_rate: videoStream?.avg_frame_rate,
		r_frame_rate: videoStream?.r_frame_rate,
		time_base: videoStream?.time_base,

		// Video
		width: videoStream?.width || 0,
		height: videoStream?.height || 0,
		codec_name: videoStream?.codec_name || '',
		profile: videoStream?.profile,
		level: videoStream?.level,
		pix_fmt: videoStream?.pix_fmt,

		color_range: videoStream?.color_range,
		color_space: videoStream?.color_space,
		color_primaries: videoStream?.color_primaries,
		color_transfer: videoStream?.color_transfer,

		sar: videoStream?.sample_aspect_ratio,
		dar: videoStream?.display_aspect_ratio,

		// Audio
		hasAudio: !!audioStream,
		hasVideo: !!videoStream,

		audioCodec: audioStream?.codec_name,
		audioSampleRate: audioStream?.sample_rate ? Number(audioStream.sample_rate) : undefined,
		audioChannels: audioStream?.channels,
		audioChannelLayout: audioStream?.channel_layout,
		audioBitrate: audioStream?.bit_rate ? Number(audioStream.bit_rate) : undefined,
	};

	// console.log('fullFileInfo:', result);
	return result;
	// } catch (error) {
	// 	console.error('Error getting full file info:', error);
	// 	throw error;
	// }
}
