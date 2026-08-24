import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Button, Divider, IconButton, Modal, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { ArrowDownToLine, X, Save, Hammer, FilePlus } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { Tab1PluginJson } from './Tab1PluginJson';
import { Tab2UiBuilder } from './Tab2UiBuilder';
import { Tab3ScriptPreview } from './Tab3ScriptPreview';
import { LoadPluginDialog } from './LoadPluginDialog';
import type { PluginJsonData, UiJsonData } from './types';
import { DEFAULT_PLUGIN_JSON, makeDefaultUiJson, generateScriptTemplate, normalizeUiJson } from './types';
import { joinPath } from '@/Utils/joinPath';
import { commands, unwrap } from '@/Utils/specta';
import { emit } from '@tauri-apps/api/event';

// ─────────────────────────────────────────────────────────────────────────────
// Main PluginBuilderModal
// ─────────────────────────────────────────────────────────────────────────────

interface PluginBuilderModalProps {
	open: boolean;
	onClose: () => void;
}

// Глубокое сравнение объектов для отслеживания изменений
function deepEqual(a: any, b: any): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function PluginBuilderModal({ open, onClose }: PluginBuilderModalProps) {
	const [tab, setTab] = useState(0);
	const [resetKey, setResetKey] = useState(0);
	const [pluginJson, setPluginJson] = useState<PluginJsonData>({ ...DEFAULT_PLUGIN_JSON });
	const [uiJson, setUiJson] = useState<UiJsonData>(makeDefaultUiJson);
	const [scriptContent, setScriptContent] = useState<string | null>(null);
	const [loadedPath, setLoadedPath] = useState<string | null>(null);
	const [loadDialogOpen, setLoadDialogOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [building, setBuilding] = useState(false);
	const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string; fullPath?: string } | null>(null);

	// Состояния для отслеживания изменений
	const [pluginJsonChanged, setPluginJsonChanged] = useState(false);
	const [uiJsonChanged, setUiJsonChanged] = useState(false);
	const [scriptChanged, setScriptChanged] = useState(false);

	// Рефы для хранения исходных значений
	const initialPluginJsonRef = useRef<PluginJsonData | null>(null);
	const initialUiJsonRef = useRef<UiJsonData | null>(null);
	const initialScriptRef = useRef<string | null>(null);

	// Синхронизация name (Tab1) ↔ label (Tab2): активна пока они не разошлись вручную
	const [nameLabelLinked, setNameLabelLinked] = useState(true);
	const nameLabelLinkedRef = useRef(true);
	nameLabelLinkedRef.current = nameLabelLinked;
	const pluginJsonRef = useRef(pluginJson);
	pluginJsonRef.current = pluginJson;

	const gray15 = greyColor(15);
	const gray40 = greyColor(40);

	// Reset on close
	useEffect(() => {
		if (!open) {
			setStatus(null);
			setPluginJsonChanged(false);
			setUiJsonChanged(false);
			setScriptChanged(false);
		}
	}, [open]);

	const handleLoad = (data: { pluginJson: PluginJsonData; uiJson: UiJsonData; scriptContent: string | null; folderPath: string }) => {
		setPluginJson(data.pluginJson);
		const normalized = normalizeUiJson(data.uiJson);
		setUiJson(normalized);
		setScriptContent(data.scriptContent);
		setLoadedPath(data.folderPath);
		setStatus(null);
		// Сохраняем исходные значения
		initialPluginJsonRef.current = { ...data.pluginJson };
		initialUiJsonRef.current = { ...normalized };
		initialScriptRef.current = data.scriptContent;
		// Сбрасываем флаги изменений
		setPluginJsonChanged(false);
		setUiJsonChanged(false);
		setScriptChanged(false);
		// Синхронизация name↔label: активна только если они совпадают при загрузке
		const linked = data.pluginJson.name === normalized.data.label;
		setNameLabelLinked(linked);
		nameLabelLinkedRef.current = linked;
	};

	// Обёртки для отслеживания изменений
	const handlePluginJsonChange = useCallback((data: PluginJsonData) => {
		setPluginJson(data);
		// id → type (всегда), name → label (пока линк активен) — один вызов setUiJson
		setUiJson((prev) => {
			const nextType = data.id;
			const nextLabel = nameLabelLinkedRef.current ? data.name : prev.data.label;
			if (prev.type === nextType && prev.data.label === nextLabel) return prev;
			if (initialUiJsonRef.current) setUiJsonChanged(true);
			return { ...prev, type: nextType, data: { ...prev.data, label: nextLabel } };
		});
		if (initialPluginJsonRef.current && !deepEqual(data, initialPluginJsonRef.current)) {
			setPluginJsonChanged(true);
		} else {
			setPluginJsonChanged(false);
		}
	}, []);

	const handleUiJsonChange = useCallback((data: UiJsonData) => {
		setUiJson(data);
		// Если label изменился и расходится с name — рвём линк
		if (nameLabelLinkedRef.current && data.data.label !== pluginJsonRef.current.name) {
			setNameLabelLinked(false);
			nameLabelLinkedRef.current = false;
		}
		if (initialUiJsonRef.current && !deepEqual(data, initialUiJsonRef.current)) {
			setUiJsonChanged(true);
		} else {
			setUiJsonChanged(false);
		}
	}, []);

	const handleScriptChange = useCallback((content: string | null) => {
		setScriptContent(content);
		if (initialScriptRef.current !== null && content !== initialScriptRef.current) {
			setScriptChanged(true);
		} else {
			setScriptChanged(false);
		}
	}, []);

	const handleNew = useCallback(() => {
		setPluginJson({ ...DEFAULT_PLUGIN_JSON });
		setUiJson(makeDefaultUiJson());
		setScriptContent(null);
		setLoadedPath(null);
		setStatus(null);
		initialPluginJsonRef.current = null;
		initialUiJsonRef.current = null;
		initialScriptRef.current = null;
		setPluginJsonChanged(false);
		setUiJsonChanged(false);
		setScriptChanged(false);
		setNameLabelLinked(true);
		nameLabelLinkedRef.current = true;
		setResetKey((k) => k + 1);
		setTab(0);
	}, []);

	const getTargetFolder = async (): Promise<string> => {
		if (loadedPath) {
			// If id was changed after loading/saving, follow the new id
			const loadedFolder = loadedPath.split(/[\\/]/).pop();
			if (loadedFolder === pluginJson.id) return loadedPath;
		}
		const devPath = unwrap(await commands.getPluginsDevPath());
		return joinPath(devPath, pluginJson.id);
	};

	const handleSave = async () => {
		setSaving(true);
		setStatus(null);
		try {
			const folder = await getTargetFolder();

			// Сохраняем только изменённые файлы
			if (pluginJsonChanged || !initialPluginJsonRef.current) {
				unwrap(await commands.writeFileAtomic(joinPath(folder, 'plugin.json'), JSON.stringify(pluginJson, null, '\t')));
			}
			if (uiJsonChanged || !initialUiJsonRef.current) {
				unwrap(await commands.writeFileAtomic(joinPath(folder, 'ui.json'), JSON.stringify(uiJson, null, '\t')));
			}
			if (scriptChanged || !initialScriptRef.current) {
				const scriptName = pluginJson.main.replace('.js', '.ts');
				const scriptPath = joinPath(folder, scriptName);
				unwrap(
					await commands.writeFileAtomic(
						scriptPath,
						scriptContent ?? generateScriptTemplate(pluginJson.main.replace(/\.js$/, 'Func')),
					),
				);
			}

			// Обновляем исходные значения после сохранения
			initialPluginJsonRef.current = { ...pluginJson };
			initialUiJsonRef.current = { ...uiJson };
			initialScriptRef.current = scriptContent;
			setPluginJsonChanged(false);
			setUiJsonChanged(false);
			setScriptChanged(false);

			setLoadedPath(folder);
			// Показываем только имя папки куда сохранился плагин
			const folderName = folder.split(/[\\/]/).pop() || folder;
			setStatus({ type: 'success', msg: `Сохранено → ${folderName}`, fullPath: folder });
		} catch (e: any) {
			setStatus({ type: 'error', msg: e.message });
		} finally {
			setSaving(false);
		}
	};

	const handleBuild = async () => {
		await handleSave();
		setBuilding(true);
		setStatus(null);
		try {
			const result = await window.tauriAPI.invoke<{
				success: boolean;
				stdout?: string;
				stderr?: string;
				error?: string;
			}>('plugin_build', pluginJson.id);
			if (result.success) {
				// Пере-собранную версию сначала выгружаем: load_plugin_internal при уже
				// загруженном ключе молча выходит и не перечитывает свежий ui.json/manifest.
				try {
					await window.plugins.unloadPlugin(pluginJson.id, pluginJson.version);
				} catch {
					/* не был загружен — нормально */
				}
				try {
					await window.plugins.loadPlugin(`${pluginJson.id}@${pluginJson.version}`);
				} catch (e: any) {
					setStatus({ type: 'error', msg: `Собрано, но не загрузилось: ${e?.message ?? e}` });
					return;
				}
				// Просим все окна перечитать список плагинов (палитра нод + список в настройках).
				await emit('plugins-changed', { id: pluginJson.id, version: pluginJson.version });
				setStatus({ type: 'success', msg: `Собрано и загружено: ${pluginJson.id}@${pluginJson.version}` });
			} else {
				setStatus({ type: 'error', msg: result.error ?? result.stderr ?? 'Build failed' });
			}
		} catch (e: any) {
			setStatus({ type: 'error', msg: e.message });
		} finally {
			setBuilding(false);
		}
	};

	const isBusy = saving || building;

	return (
		<>
			<Modal open={open} onClose={onClose}>
				<Box
					sx={{
						position: 'absolute',
						top: '50%',
						left: '50%',
						transform: 'translate(-50%, -50%)',
						width: '94vw',
						height: '90vh',
						display: 'flex',
						flexDirection: 'column',
						bgcolor: gray15,
						border: `1px solid ${gray40}`,
						borderRadius: 2,
						boxShadow: 24,
						overflow: 'hidden',
					}}
				>
					{/* ── Toolbar ── */}
					<Box
						sx={{
							display: 'flex',
							alignItems: 'center',
							gap: 1,
							px: 1.5,
							py: 0.75,
							borderBottom: `1px solid ${gray40}`,
							flexShrink: 0,
						}}
					>
						<Button
							size='small'
							variant='outlined'
							startIcon={<FilePlus size={12} />}
							onClick={handleNew}
							disabled={isBusy}
							sx={{ fontSize: 11, py: 0.3, px: 1, flexShrink: 0 }}
						>
							Новый
						</Button>

						<Button
							size='small'
							variant='outlined'
							startIcon={<ArrowDownToLine size={12} />}
							onClick={() => setLoadDialogOpen(true)}
							disabled={isBusy}
							sx={{ fontSize: 11, py: 0.3, px: 1, flexShrink: 0 }}
						>
							Загрузить
						</Button>

						<Divider orientation='vertical' flexItem sx={{ mx: 0.5 }} />

						<Tabs
							value={tab}
							onChange={(_, v) => setTab(v)}
							sx={{
								flex: 1,
								minHeight: 30,
								'& .MuiTab-root': { minHeight: 30, py: 0, fontSize: 12, px: 1.5 },
							}}
						>
							<Tab
								label={
									<Box sx={{ position: 'relative', display: 'inline-flex' }}>
										plugin.json
										{pluginJsonChanged && (
											<Box
												sx={{
													position: 'absolute',
													top: -4,
													right: -8,
													width: 6,
													height: 6,
													borderRadius: '50%',
													bgcolor: '#ffb74d',
												}}
											/>
										)}
									</Box>
								}
							/>
							<Tab
								label={
									<Box sx={{ position: 'relative', display: 'inline-flex' }}>
										ui.json
										{uiJsonChanged && (
											<Box
												sx={{
													position: 'absolute',
													top: -4,
													right: -8,
													width: 6,
													height: 6,
													borderRadius: '50%',
													bgcolor: '#ffb74d',
												}}
											/>
										)}
									</Box>
								}
							/>
							<Tab
								label={
									<Box sx={{ position: 'relative', display: 'inline-flex' }}>
										script
										{scriptChanged && (
											<Box
												sx={{
													position: 'absolute',
													top: -4,
													right: -8,
													width: 6,
													height: 6,
													borderRadius: '50%',
													bgcolor: '#ffb74d',
												}}
											/>
										)}
									</Box>
								}
							/>
						</Tabs>

						{status && (
							<Tooltip title={status.fullPath || ''} placement='bottom' arrow>
								<Typography
									variant='caption'
									sx={{
										color: status.type === 'success' ? '#81c784' : '#ef5350',
										maxWidth: 320,
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
										fontSize: 11,
										cursor: status.fullPath ? 'help' : 'default',
									}}
								>
									{status.msg}
								</Typography>
							</Tooltip>
						)}

						<Button
							size='small'
							variant='outlined'
							startIcon={<Hammer size={12} />}
							onClick={handleBuild}
							disabled={isBusy}
							sx={{ fontSize: 11, py: 0.3, px: 1, flexShrink: 0, borderColor: '#ffb74d66', color: '#ffb74d' }}
						>
							{building ? 'Сборка...' : 'Build & Load'}
						</Button>

						<Button
							size='small'
							variant='contained'
							startIcon={<Save size={12} />}
							onClick={handleSave}
							disabled={isBusy}
							sx={{ fontSize: 11, py: 0.3, px: 1, flexShrink: 0 }}
						>
							{saving ? 'Сохранение...' : 'Сохранить'}
						</Button>

						<IconButton size='small' onClick={onClose} sx={{ ml: 0.25 }}>
							<X size={15} />
						</IconButton>
					</Box>

					{/* ── Content ── */}
					<Box sx={{ flex: 1, overflow: 'hidden' }}>
						{tab === 0 && (
							<Box sx={{ height: '100%', overflow: 'auto' }}>
								<Tab1PluginJson data={pluginJson} onChange={handlePluginJsonChange} />
							</Box>
						)}
						{tab === 1 && <Tab2UiBuilder key={`${loadedPath ?? 'new'}-${resetKey}`} uiJson={uiJson} onChange={handleUiJsonChange} />}
						{tab === 2 && (
							<Tab3ScriptPreview
								key={`script-${resetKey}`}
								pluginJson={pluginJson}
								scriptContent={scriptContent}
								onScriptChange={handleScriptChange}
							/>
						)}
					</Box>
				</Box>
			</Modal>

			<LoadPluginDialog open={loadDialogOpen} onClose={() => setLoadDialogOpen(false)} onLoad={handleLoad} />
		</>
	);
}
