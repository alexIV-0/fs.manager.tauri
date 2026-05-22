import { runProcessing } from '@/PROCESSING/runProcessing';
import { abortNow } from '@/PROCESSING/utils/processingAbort';
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
import { CurentProjectFolder } from './ProjectFolderColumn/CurentProjectFolder';

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
import MyDivider from './Universal/myDivider';

export default function AppMain() {
	const isRunningRef = useRef(false);

	const { setMainFolderId } = setActiveFolders_store();
	const { mainFolderArr } = mainFolders_stor();
	const { isScanning, isScanningProcess, mainFolderIndex, setIsScanning, setIsScanningProcess, setMainFolderIndex } = isScanningStore();

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
		window.electronAPI.invoke('abort-processing');
		setIsScanning(false);
		useStatusBar_Store.getState().setStatusBarState('waiting starting');
	};

	const stopAfterProcessButtClick = () => {
		setIsScanningProcess(!isScanningProcess);
	};

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
					<MainFolderColumn />
					<ProjectFolderColumn />
					<GlobalMenuProvider>
						<CurentProjectFolder />
					</GlobalMenuProvider>
				</Box>
				<Box sx={{ ...bottomBoxStyle, mt: '5px', zIndex: 10 }}>
					<MyDivider disablePadding />
					<Box
						sx={{
							display: 'flex',
							gap: '5px',
							justifyContent: 'space-between',
							alignItems: 'center',
							overflow: 'hidden',
							p: '0 10px',
						}}
					>
						<StatusBar />
						<IconButton onClick={reLoadExtension}>
							<RotateCw />
						</IconButton>
					</Box>
					<MyDivider disablePadding />
					<Box
						sx={{
							display: 'flex',
							gap: '5px',
							p: '5px',
							overflow: 'hidden',
						}}
					>
						{!isScanning ? (
							<MyButton onClick={startButtClick} innerText={'START'} />
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
				</Box>
			</Box>
		</ThemeWrapper>
	);
}
