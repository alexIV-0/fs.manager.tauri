// NodeApp.tsx
import { usePathStore } from '@/Store/Node/usePathStore';
import { useSavedState } from '@/Store/Node/useSavedState';
import { rebuildColorTypes } from '@/Store/Color/buildColorTypes';
import ThemeWrapper from '@/theme/ThemeWrapper';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useEffect, useRef, useState } from 'react';

import { SavedState } from './definitions/types';
import NodeView from './layout/FlowNodeView';
import './index.css';
import type { CollectedUINode } from '@/Utils/collectPluginUINodes';
import { buildNodeDefinitions } from './definitions';
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

	useEffect(() => {
		let isMounted = true;

		const loadEverything = async () => {
			try {
				rebuildColorTypes();

				// Plugin UI ноды собирает MAIN_WIN (там есть populated plugin_Store/typeOfNodes_store)
				// и кладёт в localStorage перед вызовом 'open-node-window'.
				// NODE_WIN — отдельный renderer-процесс, эти сторы тут пустые.
				const storedNodes = localStorage.getItem('pluginUINodes');
				let nodes: CollectedUINode[] = [];

				if (storedNodes) {
					nodes = JSON.parse(storedNodes) as CollectedUINode[];
					setPluginUINodes(nodes);
				}

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
		window.electronAPI.onUpdateData(handler);

		if (!initialized.current) {
			initialized.current = true;
			window.electronAPI.requestData();
		}

		return () => {
			window.electronAPI.removeUpdateData(handler);
		};
	}, [addPath]);

	useEffect(() => {
		if (!path) return;

		let cancelled = false;
		setSavedState(null);

		const init = async () => {
			// Раньше: 3 sequential IPC по одной папке. Теперь: один батч-вызов,
			// внутри nativeFs создаёт все три параллельно через tokio thread pool.
			const folders = ['IN', 'options', 'OUT'].map((f) => joinPath(path, f));
			await window.electronAPI.invoke('testAndCreateFolders', folders);
			const newState = await window.electronAPI.invoke('getNodeObjFromFile', path);
			if (cancelled) return;
			setSavedState(newState as SavedState);
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
