import { runProcessing } from '@/PROCESSING/runProcessing';
import { abortNow } from '@/PROCESSING/utils/processingAbort';
import { RUN_PROCESSING } from '@/PROCESSING/runLanes';
import { startPostScheduler, stopPostScheduler } from '@/PROCESSING/autoPost/scheduler';
import { usePostingAvailable } from '@/PROCESSING/autoPost/usePostingAvailable';
import { usePosting_store } from '@/Store/Processing/usePosting_store';
import { startWorker, stopWorkerNow, stopWorkerSoft } from '@/PROCESSING/remoteWorker/runner';
import { useWorkerAvailable } from '@/PROCESSING/remoteWorker/useWorkerAvailable';
import { useWorker_store } from '@/Store/Processing/useWorker_store';
import { commands } from '@/Utils/specta';
import { greenColor, greyColor, steelColor } from '@/Store/Color/grayColor';
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { pathPattern_store, programPathPattern_store, typeOfFile_store, typeOfNodes_store } from '@/Store/MainWin/pathPattern_store';
import { appSettings_client } from '@/Store/Settings/appSettings_client';
import ThemeWrapper from '@/theme/ThemeWrapper';
import { Box, IconButton } from '@mui/material';
import { RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { CurentProjectFolder } from './ProjectFolderColumn/CurentProjectFolder';
import { storage_store } from '@/Store/MainWin/storage_store';
import { useStorageChanged } from './Storage/useStorageChanged';

import { MainTopPanel } from './MainTopPanel';
import { ProjectFolderColumn } from './ProjectFolderColumn/ProjectFolderColumn';
import { GlobalMenuProvider } from './FileExplorerColumn/ContextMenu/GlobalMenuContext';

import { bottomBoxStyle } from './mainStyles';
import StatusBar from './statusBar';
import { rebuildColorTypes } from '@/Store/Color/buildColorTypes';
import { useStatusBar_Store } from '@/Store/Processing/useStatusBar_Store';
// 🔥 ОБНОВЛЕННЫЙ ИМПОРТ - добавьте initializePlugins
import { initializePlugins } from '@/Store/MainWin/plugin_store';
import { MainFolderColumn } from './MainFolderColumn/MainFolderColumn';
import MyButton from './Universal/myButton';
import PostingStatusLine from './PostingStatusLine';
import StatusRow from './Universal/StatusRow';
import WorkerStatusLine from './WorkerStatusLine';
import MyDivider from './Universal/myDivider';
import { useColumnTabNavigation } from './hooks/useColumnTabNavigation';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';

export default function AppMain() {
	const isRunningRef = useRef(false);

	// Поднимаем хранилище тем же способом, что и в прошлый раз (демо или живое).
	// Без этого после перезапуска облачная папка молча выглядит обычной локальной:
	// колонка читает диск, значков нет, синхронизатор простаивает.
	useEffect(() => {
		void storage_store.getState().autoConnect();
	}, []);

	// Tab / Shift+Tab — переключение фокуса между колонками
	useColumnTabNavigation();

	// F12 toggles this window's DevTools (dev/devtools builds). Mirrors PreviewApp.
	useKeyboardShortcut({ key: 'F12', skipOnInput: false, callback: () => window.tauriAPI.openDevTools() });

	const { setMainFolderId } = setActiveFolders_store();
	const { mainFolderArr } = mainFolders_stor();
	const { isScanning, isScanningProcess, mainFolderIndex, setIsScanning, setIsScanningProcess, setMainFolderIndex } = isScanningStore();
	const { isPosting } = usePosting_store();
	// Постинг показываем/разрешаем только когда есть чем собрать пайплайн finder → poster
	// (плагин-источник `finder` + хотя бы один постер). Иначе прячем весь UI постинга.
	const postingReady = usePostingAvailable();

	// Режим воркера: есть плагин-адаптер очереди — показываем кнопки, нет — прячем.
	const workerReady = useWorkerAvailable();
	const { isWorking, stopRequested } = useWorker_store();

	const bgLoading = greyColor(15);
	const bgLoadingBar = greyColor(30);
	const bgMain = greyColor(18);
	const colorGreen70 = greenColor(70);
	const colorGreen95 = greenColor(95);
	const colorSteel50 = steelColor(50);
	const colorSteel70 = steelColor(70);

	// 🔥 состояние загрузки плагинов
	const [pluginsLoaded, setPluginsLoaded] = useState(false);

	// ========================
	// Загрузка плагинов при старте - УПРОЩЕННАЯ ВЕРСИЯ
	// ========================
	useEffect(() => {
		const loadAllPlugins = async () => {
			try {
				// Используем готовую утилиту инициализации
				await initializePlugins();

				// console.log('[UI Nodes Loaded]', state.getUINodes().length, 'UI nodes');

				// Выводим детальную информацию
				// state.plugins.forEach((plugin) => {
				// 	console.log(`Plugin: ${plugin.name}@${plugin.version}`, plugin);
				// 	// console.log(`Plugin: ${plugin.name}@${plugin.version}`, {
				// 	// 	enabled: plugin.enable,
				// 	// 	hasUI: plugin.hasUI,
				// 	// 	types: plugin.type,
				// 	// 	path: plugin.path,
				// 	// });
				// });
			} catch (err) {
				console.error('Ошибка при загрузке плагинов:', err);
			} finally {
				setPluginsLoaded(true);
			}
		};

		loadAllPlugins();
	}, []);

	// Значки зеркала после фоновой передачи: скачали префетчем, залил демон,
	// вытеснили по таймеру — интерфейс об этом иначе не узнаёт.
	useStorageChanged();

	// Живое обновление списка плагинов после сборки/загрузки из PluginBuilder.
	useEffect(() => {
		const unlistenP = listen('plugins-changed', () => {
			initializePlugins().catch((err) => console.error('plugins-changed reinit failed:', err));
		});
		return () => {
			unlistenP.then((un) => un());
		};
	}, []);

	// ========================
	// ЗАПУСКАЕТСЯ ОСНОВНОЙ ПРОЦЕСС ОБРАБОТКИ
	// ========================
	const startButtClick = () => {
		if (isRunningRef.current) return;
		isRunningRef.current = true;
		setIsScanning(true);
		setIsScanningProcess(true);
		setMainFolderIndex(-1);

		const process = async () => {
			try {
				await runProcessing();
			} finally {
				isRunningRef.current = false;
				setIsScanning(false);
			}
		};
		process();
	};

	const stopButtNowClick = () => {
		if (!isRunningRef.current) return;
		abortNow();
		// Полоса обработки: у постинга своя, его ffmpeg этот стоп больше не убивает.
		commands.abortProcessing(RUN_PROCESSING);
		setIsScanning(false);
		useStatusBar_Store.getState().setStatusBarState('waiting starting');
	};

	const stopAfterProcessButtClick = () => {
		setIsScanningProcess(!isScanningProcess);
	};

	// ========================
	// ОТДЕЛЬНЫЙ ПРОЦЕСС АВТОПОСТИНГА (независим от обработки)
	// ========================
	const startPostingClick = () => startPostScheduler();
	const stopPostingClick = () => stopPostScheduler();

	// Если постинг крутится, а нужный плагин (finder или все постеры) выключили/удалили
	// на лету — гасим раннер: без finder → poster он всё равно не соберёт маршрут.
	useEffect(() => {
		if (!postingReady && isPosting) stopPostScheduler();
	}, [postingReady, isPosting]);

	// То же для воркера: снесли плагин-адаптер на ходу — очередь спрашивать нечем.
	// Гасим аварийно, чтобы взятая задача вернулась в очередь, а не висела до
	// протухания аренды.
	useEffect(() => {
		if (!workerReady && isWorking) stopWorkerNow();
	}, [workerReady, isWorking]);

	const reLoadExtension = () => {
		window.location.reload();
	};

	// ========================
	// Инициализация сторов
	// ========================
	useEffect(() => {
		rebuildColorTypes();

		// Подтягиваем AppSettings + ColorTypes из main при старте —
		// дальше MAX_PARALLEL и runProcessing-интервалы читают из кэша.
		appSettings_client.getState().load();

		// Загружаем Tauri-backed сторы из JSON-файлов (fileTypes.json, programPaths.json).
		// localStorage остаётся как быстрый кэш при старте; Tauri — source of truth.
		typeOfFile_store.getState().loadFromTauri();
		programPathPattern_store.getState().loadFromTauri();

		if (mainFolderArr.length == 0) {
			setMainFolderId(null);
			return;
		}
		setMainFolderId(mainFolderArr[0].id);

		pathPattern_store.getState();
		programPathPattern_store.getState();
		typeOfFile_store.getState();
		typeOfNodes_store.getState();
	}, []);

	// 🔥 пока плагины не загрузились, не рендерим интерфейс
	if (!pluginsLoaded) {
		return (
			<ThemeWrapper>
				<Box
					sx={{
						width: '100vw',
						height: '100vh',
						backgroundColor: bgLoading,
						display: 'flex',
						justifyContent: 'center',
						alignItems: 'center',
						flexDirection: 'column',
					}}
				>
					<div style={{ fontSize: '18px', marginBottom: '20px' }}>Loading plugins...</div>
					{/* Можно добавить индикатор загрузки */}
					<div style={{ width: '200px', height: '4px', backgroundColor: bgLoadingBar, borderRadius: '2px' }}>
						<div
							style={{
								width: '100%',
								height: '100%',
								backgroundColor: colorGreen70,
								animation: 'pulse 1.5s ease-in-out infinite',
								borderRadius: '2px',
							}}
						/>
					</div>
					<style>{`
						@keyframes pulse {
							0% { opacity: 0.6; }
							50% { opacity: 1; }
							100% { opacity: 0.6; }
						}
					`}</style>
				</Box>
			</ThemeWrapper>
		);
	}

	return (
		<ThemeWrapper>
			<Box
				sx={{
					width: '100vw',
					height: '100vh',
					backgroundColor: bgMain,
					display: 'flex',
					flexDirection: 'column',
					boxSizing: 'border-box',
				}}
			>
				<MainTopPanel />
				<Box
					sx={{
						display: 'flex',
						flexDirection: 'row',
						flex: 1,
						minHeight: 0,
						overflow: 'hidden',
					}}
				>
					<GlobalMenuProvider>
						<MainFolderColumn />
						{/* Колонки одни и те же для локальных и облачных папок. Раньше
						    здесь стояла подмена на отдельные онлайн-колонки — она и
						    порождала «другой» вид проектов, неменяющиеся заголовки и
						    пропадающую нижнюю панель. Облачная папка отличается только
						    источником листинга (каталог вместо диска), а это спрятано
						    в `readDirContent`. */}
						<ProjectFolderColumn />
						<CurentProjectFolder />
					</GlobalMenuProvider>
				</Box>
				<Box sx={{ ...bottomBoxStyle, mt: '5px', zIndex: 10 }}>
					<MyDivider disablePadding />
					{/* Три раннера — три одинаковые строки. Общий StatusRow, чтобы они не расходились
					    по стилю: раньше у обработки не было приглушения в простое, и это читалось как
					    «другой шрифт», хотя размер везде одинаковый. */}
					<StatusRow
						label='обработка'
						active={isScanning}
						trailing={
							<IconButton onClick={reLoadExtension}>
								<RotateCw />
							</IconButton>
						}
					>
						<StatusBar />
					</StatusRow>
					<MyDivider disablePadding />
					{/* ── Воркер: виден только когда есть плагин очереди ── */}
					{workerReady && (
						<>
							<StatusRow label='воркер' active={isWorking}>
								<WorkerStatusLine />
							</StatusRow>
							<MyDivider disablePadding />
						</>
					)}
					{/* ── Постинг: виден только когда есть finder + постер ── */}
					{postingReady && (
						<>
							<StatusRow label='постинг' active={isPosting}>
								<PostingStatusLine />
							</StatusRow>
							<MyDivider disablePadding />
						</>
					)}
					<Box
						sx={{
							display: 'flex',
							gap: '5px',
							p: '5px',
							overflow: 'hidden',
						}}
					>
						{!isScanning ? (
							// Локальный запуск и режим воркера взаимоисключающие: два прогона по
							// одной полосе делили бы семафоры и флаг прерывания, и стоп одного
							// убивал бы процессы другого.
							<MyButton onClick={startButtClick} innerText={'START LOCAL PROCESS'} disabled={isWorking} />
						) : (
							<Box sx={{ display: 'flex', flex: 20, flexDirection: 'row', gap: '5px' }}>
								<MyButton
									sx={{ backgroundColor: colorGreen70, '&:hover': { bgcolor: colorGreen95 } }}
									onClick={stopButtNowClick}
									innerText={'Stop at current plugin'}
								/>
								<MyButton
									sx={
										isScanningProcess
											? { backgroundColor: colorGreen70, '&:hover': { bgcolor: colorGreen95 } }
											: { backgroundColor: colorSteel50, '&:hover': { bgcolor: colorSteel70 } }
									}
									onClick={stopAfterProcessButtClick}
									innerText={isScanningProcess ? 'Stop after current block' : 'Stop scheduled — click to cancel'}
								/>
							</Box>
						)}
					</Box>
					{workerReady && (
						<Box
							sx={{
								display: 'flex',
								gap: '5px',
								p: '0 5px 5px 5px',
								overflow: 'hidden',
							}}
						>
							{!isWorking ? (
								<MyButton
									onClick={startWorker}
									innerText={'START ONLINE WORKER'}
									// Пока идёт локальный прогон, за онлайн-задачами не ходим.
									disabled={isScanning}
								/>
							) : (
								<Box sx={{ display: 'flex', flex: 20, flexDirection: 'row', gap: '5px' }}>
									<MyButton
										sx={{ backgroundColor: colorGreen70, '&:hover': { bgcolor: colorGreen95 } }}
										onClick={stopWorkerNow}
										// Аварийная: рвёт обработку и возвращает задачу в очередь, чтобы
										// её не ждали 15 минут до протухания аренды.
										innerText={'Stop now and release task'}
									/>
									<MyButton
										sx={
											stopRequested
												? { backgroundColor: colorSteel50, '&:hover': { bgcolor: colorSteel70 } }
												: { backgroundColor: colorGreen70, '&:hover': { bgcolor: colorGreen95 } }
										}
										onClick={stopWorkerSoft}
										innerText={stopRequested ? 'Finishing current task…' : 'Stop after current task'}
										disabled={stopRequested}
									/>
								</Box>
							)}
						</Box>
					)}
					{postingReady && (
						<Box
							sx={{
								display: 'flex',
								gap: '5px',
								p: '0 5px 5px 5px',
								overflow: 'hidden',
							}}
						>
							{!isPosting ? (
								<MyButton
									// sx={{ backgroundColor: colorSteel50, '&:hover': { bgcolor: colorSteel70 } }}
									onClick={startPostingClick}
									innerText={'START POSTING'}
								/>
							) : (
								<MyButton
									sx={{ backgroundColor: colorGreen70, '&:hover': { bgcolor: colorGreen95 } }}
									onClick={stopPostingClick}
									innerText={'Stop posting'}
								/>
							)}
						</Box>
					)}
				</Box>
			</Box>
		</ThemeWrapper>
	);
}
