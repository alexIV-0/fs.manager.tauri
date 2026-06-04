import { useEffect, useRef } from 'react';

/**
 * Subscribes to a Tauri IPC event on mount and unsubscribes on unmount.
 * The callback is kept fresh via a ref — re-renders don't trigger re-subscription.
 */
export function useTauriEventListener<T extends (...args: any[]) => void>(
	subscribe: (handler: T) => void,
	unsubscribe: (handler: T) => void,
	callback: T,
): void {
	const callbackRef = useRef<T>(callback);
	callbackRef.current = callback;

	useEffect(() => {
		const handler = ((...args: Parameters<T>) => callbackRef.current(...args)) as T;
		subscribe(handler);
		return () => unsubscribe(handler);
		// subscribe/unsubscribe are window.tauriAPI methods — stable references
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
}
