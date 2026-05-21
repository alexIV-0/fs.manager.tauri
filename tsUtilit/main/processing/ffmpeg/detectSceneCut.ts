import { escapeShellArg } from '../../utilits/escapeShellArg';
import { execFFmpegCommand } from './execFFmpegCommand';

interface SceneCandidate {
	time: number;
	score: number;
}

// Otsu's method: finds the threshold that maximises between-class variance
// in the score distribution of the specific file — no manual tuning needed
function otsuThreshold(scores: number[]): number {
	if (scores.length < 2) return 0.3;

	const bins = 200;
	const hist = new Array(bins).fill(0);
	for (const s of scores) {
		hist[Math.min(Math.floor(s * bins), bins - 1)]++;
	}

	const total = scores.length;
	let sum = 0;
	for (let i = 0; i < bins; i++) sum += i * hist[i];

	let sumB = 0,
		wB = 0,
		maxVar = 0,
		threshold = 0.3;
	for (let i = 0; i < bins; i++) {
		wB += hist[i];
		if (wB === 0 || wB === total) continue;
		const wF = total - wB;
		sumB += i * hist[i];
		const mB = sumB / wB;
		const mF = (sum - sumB) / wF;
		const variance = wB * wF * (mB - mF) ** 2;
		if (variance > maxVar) {
			maxVar = variance;
			threshold = i / bins;
		}
	}

	return threshold;
}

function parseCandidates(stdout: string): SceneCandidate[] {
	const lines = stdout.split(/\r?\n/);
	const candidates: SceneCandidate[] = [];

	for (let i = 0; i < lines.length - 1; i++) {
		const timeMatch = lines[i].match(/pts_time:([\d.]+)/);
		if (!timeMatch) continue;
		const scoreMatch = lines[i + 1]?.match(/lavfi\.scene_score=([\d.]+)/);
		if (!scoreMatch) continue;
		candidates.push({
			time: parseFloat(timeMatch[1]),
			score: parseFloat(scoreMatch[1]),
		});
	}

	return candidates;
}

// export async function detectSceneCuts(inputFile: string, _threshold: number = 0.3, _description: any): Promise<number[]> {
export async function detectSceneCuts(inputFile: string, _description: any): Promise<number[]> {
	const ffmpeg = escapeShellArg(_description.programmPath.ffmpeg[0]);

	// Low ffmpeg threshold to collect all candidates; Otsu will filter them
	const command = `${ffmpeg} -v info -vsync 0 -i ${escapeShellArg(
		inputFile,
	)} -vf "select='gt(scene,0.01)',metadata=print:file=-:key=lavfi.scene_score" -f null -`;

	try {
		const { stdout } = await execFFmpegCommand(command);

		const candidates = parseCandidates(stdout);
		if (candidates.length === 0) return [0];

		const threshold = otsuThreshold(candidates.map((c) => c.score));
		const timestamps = candidates.filter((c) => c.score >= threshold).map((c) => c.time);

		timestamps.unshift(0);
		return [...new Set(timestamps)].sort((a, b) => a - b);
	} catch (error: any) {
		throw new Error(`Failed to detect scene cuts: ${error.error?.message || error.message}`);
	}
}
