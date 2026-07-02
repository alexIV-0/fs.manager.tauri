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

		const init = async () => {
			// Папки IN/OUT/options здесь БОЛЬШЕ НЕ создаём: незачем засорять диск у пустого,
			// нетронутого проекта. options появится при первом сохранении (внутри
			// save_flow_to_options_folder), IN/OUT — через ensureProjectFolders по составу
			// флоу. Здесь только читаем options.json (если его нет — вернётся {}).
			const newState = unwrap(await commands.getNodeObjFromFile(path));
			if (cancelled) return;
			setSavedState(newState as unknown as SavedState);
		};

		init();

		return () => {
			cancelled = true;
		};
	}, [path, setSavedState]);

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
