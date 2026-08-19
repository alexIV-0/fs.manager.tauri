// NodeApp.tsx
import { usePathStore } from '@/Store/Node/usePathStore';
import { commands, unwrap } from '@/Utils/specta';
import { useSavedState } from '@/Store/Node/useSavedState';
import { rebuildColorTypes } from '@/Store/Color/buildColorTypes';
import ThemeWrapper from '@/theme/ThemeWrapper';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useEffect, useRef, useState } from 'react';

import { SavedState } from './definitions/types';
import NodeView from './layout/FlowNodeView';
import './index.css';
import { loadAllUINodes, type CollectedUINode } from '@/Utils/loadAllUINodes';
import { buildNodeDefinitions } from './definitions';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { listen } from '@tauri-apps/api/event';
import { ensureLocalStrict } from '@/Utils/storageSeam';
import { joinPath } from '@/Utils/joinPath';

import SaveButton from './layout/SaveButton';
import TopPanel from './layout/TopPanel';
import Sidebar from './layout/Sidebar';
import { ProcessingEventListener } from './nodes/components/ProcessingEventListener';
import { ProcessingStatusBar } from './nodes/components/ProcessingStatusBar';

// NodeApp.tsx - основной компонент
function NodeApp() {
	const { path, addPath } = usePathStore();
	const { savedState, setSavedState } = useSavedState();
	const initialized = useRef(false);
	const [isLoading, setIsLoading] = useState(true);
	const [initError, setInitError] = useState<string | null>(null);
	const [pluginUINodes, setPluginUINodes] = useState<CollectedUINode[]>([]);

	// F12 toggles this window's DevTools (dev/devtools builds). Mirrors PreviewApp.
	useKeyboardShortcut({ key: 'F12', skipOnInput: false, callback: () => window.tauriAPI.openDevTools() });

	useEffect(() => {
		let isMounted = true;

		const loadEverything = async () => {
			try {
				rebuildColorTypes();

				// Источник правды — Rust plugin manager. Он сканирует диск и держит
				// актуальный список UI-нод в памяти. Здесь же применяются enabled-фильтр
				// (из localStorage['plugins-data']) и colorType override (из localStorage['typeOfNodes']).
				const nodes = await loadAllUINodes();
				setPluginUINodes(nodes);
				buildNodeDefinitions(nodes);

				if (!isMounted) return;

				setIsLoading(false);
			} catch (err) {
				console.error('[NodeApp] ❌ Initialization error:', err);
				setInitError('Failed to initialize application');
				setIsLoading(false);
			}
		};

		loadEverything();

		return () => {
			isMounted = false;
		};
	}, []);

	// Живое обновление палитры при сборке/загрузке плагина из PluginBuilder
	// (событие 'plugins-changed' эмитится после plugin_build + load). Без этого
	// новый плагин появлялся только после перезапуска окна.
	useEffect(() => {
		const unlistenP = listen('plugins-changed', async () => {
			try {
				const nodes = await loadAllUINodes();
				setPluginUINodes(nodes);
				buildNodeDefinitions(nodes);
			} catch (err) {
				console.error('[NodeApp] plugins-changed reload failed:', err);
			}
		});
		return () => {
			unlistenP.then((un) => un());
		};
	}, []);

	if (isLoading) {
		return <FullScreenLoader message='Loading Node Editor...' />;
	}

	if (initError) {
		return <div>Error: {initError}</div>;
	}

	return (
		<LoadedNodeApp
			path={path}
			addPath={addPath}
			savedState={savedState}
			setSavedState={setSavedState}
			initialized={initialized}
			pluginUINodes={pluginUINodes}
		/>
	);
}

interface LoadedNodeAppProps {
	path: string | null;
	addPath: (path: string) => void;
	savedState: SavedState | null;
	setSavedState: (state: SavedState | null) => void;
	initialized: React.MutableRefObject<boolean>;
	pluginUINodes: CollectedUINode[];
}

function LoadedNodeApp({ path, addPath, savedState, setSavedState, initialized, pluginUINodes }: LoadedNodeAppProps) {
	// Ошибка ЧТЕНИЯ графа — отдельно от initError (тот про инициализацию окна).
	// reloadKey нужен, чтобы «Повторить» перезапускал эффект, не перезагружая окно:
	// путь приходит событием от главного окна, и после reload его пришлось бы ждать снова.
	const [loadError, setLoadError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);

	useEffect(() => {
		const handler = (_: unknown, data: string) => {
			addPath(data);
		};
		window.tauriAPI.onUpdateData(handler);

		if (!initialized.current) {
			initialized.current = true;
			window.tauriAPI.requestData();
		}

		return () => {
			window.tauriAPI.removeUpdateData(handler);
		};
	}, [addPath]);

	useEffect(() => {
		if (!path) return;

		let cancelled = false;
		setSavedState(null);
		setLoadError(null);

		const init = async () => {
			// Папки IN/OUT/options здесь БОЛЬШЕ НЕ создаём: незачем засорять диск у пустого,
			// нетронутого проекта. options появится при первом сохранении (внутри
			// save_flow_to_options_folder), IN/OUT — через ensureProjectFolders по составу
			// флоу.
			//
			// ГИДРАЦИЯ ДО ЧТЕНИЯ. Проект может жить только в облаке: options.json есть в
			// каталоге, а байтов на диске нет. `get_node_obj_from_file` смотрит диск
			// напрямую (`json_path.exists()`) и в этом случае вернул бы `{}` — редактор
			// открылся бы пустым, как будто проект новый.
			//
			// Почему сбой гидрации фатален, а не «покажем что есть»: первое же сохранение
			// зальёт пустой граф ПОВЕРХ облачного, причём безусловно. В `needs_upload`
			// (storage/service.rs) отсутствие baseline трактуется как «это наша новая
			// версия, пайплайн перезаписал облачный файл не скачивая» — ветка правильная
			// для обработки, но здесь она означает, что матрица расхождений конфликт не
			// увидит и работа пропадёт молча. Поэтому мягкий `ensureLocal` тут не годится:
			// он глотает ошибку хранилища и вернул бы ровно этот пустой граф.
			try {
				await ensureLocalStrict(joinPath(path, 'options', 'options.json'));
			} catch (e) {
				if (cancelled) return;
				setLoadError(e instanceof Error ? e.message : String(e));
				return;
			}
			if (cancelled) return;

			// Дальше файла может не быть вовсе — ни на диске, ни в каталоге. Это и есть
			// новый проект: вернётся `{}` и холст откроется чистым.
			const newState = unwrap(await commands.getNodeObjFromFile(path));
			if (cancelled) return;
			setSavedState(newState as unknown as SavedState);
		};

		init();

		return () => {
			cancelled = true;
		};
	}, [path, setSavedState, reloadKey]);

	// Пустой холст при неудавшейся гидрации не показываем ВООБЩЕ, а не просто без
	// нод: иначе рядом остаются Save и Sidebar, и одно нажатие затирает облачный граф.
	if (loadError) {
		return <FlowLoadError message={loadError} onRetry={() => setReloadKey((n) => n + 1)} />;
	}

	return (
		<div style={{ width: '100vw', height: '100vh' }}>
			<ThemeWrapper>
				<ReactFlowProvider>
					{/* слушатель событий обработки — без UI */}
					<ProcessingEventListener />

					<TopPanel title={path} />
					{savedState && <NodeView />}
					<Sidebar />
					<SaveButton />

					{/* всплывающий статус-бар снизу */}
					<ProcessingStatusBar />
				</ReactFlowProvider>
			</ThemeWrapper>
		</div>
	);
}

/** Граф есть, но недоступен. Отдельно от initError: там окно не поднялось, а здесь
 *  не прочитался конкретный проект, и повтор имеет смысл. */
function FlowLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div
			style={{
				width: '100vw',
				height: '100vh',
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: '#1a1a1a',
				color: 'white',
				flexDirection: 'column',
				gap: '16px',
				padding: '40px',
				textAlign: 'center',
			}}
		>
			<div style={{ fontSize: '22px', fontWeight: 500 }}>Не удалось получить настройки нод</div>
			<div style={{ fontSize: '14px', color: '#bbb', maxWidth: '640px', lineHeight: 1.5 }}>
				Файл <code>options.json</code> есть в облаке, но скачать его не получилось. Пустой холст не
				показываем намеренно: сохранение затёрло бы облачный граф.
			</div>
			<div style={{ fontSize: '13px', color: '#e57373', maxWidth: '640px', wordBreak: 'break-word' }}>{message}</div>
			<button
				onClick={onRetry}
				style={{
					marginTop: '8px',
					padding: '8px 20px',
					fontSize: '14px',
					color: 'white',
					backgroundColor: '#2f6f3f',
					border: '1px solid #4CAF50',
					borderRadius: '4px',
					cursor: 'pointer',
				}}
			>
				Повторить
			</button>
		</div>
	);
}

function FullScreenLoader({ message = 'Loading...' }) {
	return (
		<div
			style={{
				width: '100vw',
				height: '100vh',
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: '#1a1a1a',
				color: 'white',
				flexDirection: 'column',
				gap: '20px',
				padding: 0,
			}}
		>
			<div style={{ fontSize: '24px', fontWeight: '500' }}>{message}</div>
			<div style={{ width: '300px', height: '4px', backgroundColor: '#333', borderRadius: '2px' }}>
				<div
					style={{
						width: '40%',
						height: '100%',
						backgroundColor: '#4CAF50',
						animation: 'loading 1.5s ease-in-out infinite',
						borderRadius: '2px',
					}}
				/>
			</div>
			<div style={{ fontSize: '14px', color: '#888', marginTop: '10px' }}>Loading plugins and resources...</div>
			<style>{`
				@keyframes loading {
					0% { transform: translateX(0%); }
					100% { transform: translateX(150%); }
				}
			`}</style>
		</div>
	);
}

export default memo(NodeApp);
