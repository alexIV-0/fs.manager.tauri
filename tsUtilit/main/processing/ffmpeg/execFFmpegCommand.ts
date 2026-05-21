import { exec } from 'child_process';
export async function execFFmpegCommand(command: string): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		exec(command, (error: any, stdout: string, stderr: string) => {
			if (error) {
				reject({ error, stdout, stderr });
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
}
