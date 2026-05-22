import { getSignal } from './utils/processingAbort';

export async function waitingSome(_time: number): Promise<void> {
	const signal = getSignal();

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, _time);

		const onAbort = () => {
			clearTimeout(timeout);
			reject(new DOMException('Aborted', 'AbortError'));
		};

		if (signal.aborted) {
			onAbort();
			return;
		}

		signal.addEventListener('abort', onAbort);
	});
}
