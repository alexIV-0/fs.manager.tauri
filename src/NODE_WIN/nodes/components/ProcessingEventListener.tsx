import { useProcessingStatus_store } from '@/Store/Node/useProcessingStatus_store';
import { useEffect, useRef } from 'react';
import { useElectronEventListener } from '@/hooks/useElectronEventListener';

export function ProcessingEventListener() {
	const { setActiveNode, setNodeStatus, setStatusText, setIsRunning, resetAll } = useProcessingStatus_store();
	const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useElectronEventListener(
		window.electronAPI.onProcessingEvent,
		window.electronAPI.removeProcessingEvent,
		(event: { type: string; payload: any }) => {
			const { type, payload } = event;

			switch (type) {
				// нода начала выполняться
				case 'node:start':
					setActiveNode(payload.nodeId);
					setNodeStatus(payload.nodeId, 'running');
					setIsRunning(true);
					break;

				// нода завершилась успешно
				case 'node:done':
					setNodeStatus(payload.nodeId, 'done');
					// снимаем "активную" подсветку с этой ноды
					setActiveNode(null);
					break;

				// нода завершилась с ошибкой
				case 'node:error':
					setNodeStatus(payload.nodeId, 'error');
					setActiveNode(null);
					setStatusText(`❌ Ошибка в ноде ${payload.nodeId}: ${payload.message}`);
					break;

				// статус-бар из плагинов
				case 'statusbar': {
					const raw = typeof payload === 'string' ? payload : payload?.text;
					if (typeof raw === 'string') setStatusText(raw);
					break;
				}

				// лог из плагинов
				case 'log': {
					const raw = typeof payload?.text === 'string' ? payload.text : undefined;
					if (raw) setStatusText(raw);
					break;
				}

				// обработка прервана
				case 'aborted':
					setActiveNode(null);
					setIsRunning(false);
					setStatusText('⏹ Обработка остановлена');
					break;

				// весь процесс завершён — сбрасываем все статусы через 2 сек
				case 'process:complete':
					setActiveNode(null);
					setIsRunning(false);
					if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
					resetTimeoutRef.current = setTimeout(() => resetAll(), 2000);
					break;

				default:
					break;
			}
		},
	);

	// очищаем таймер при размонтировании
	useEffect(() => {
		return () => {
			if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
		};
	}, []);

	return null;
}
