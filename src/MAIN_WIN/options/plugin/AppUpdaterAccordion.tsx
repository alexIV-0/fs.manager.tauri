import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
	Accordion,
	AccordionDetails,
	AccordionSummary,
	Box,
	Chip,
	CircularProgress,
	Tooltip,
	Typography,
} from '@mui/material';
import { AlertCircle, CheckCircle, ChevronDown, Download, RefreshCw } from 'lucide-react';
import { cyanColor, greyColor } from '@/Store/Color/grayColor';
import { loadPlugin } from '@/PluginAPI/loader';
// updater — не нода, ctx ему передать некому: подставляем host-сервисы сами.
import { hostServices } from '@/PluginAPI/host';
import { getVersion } from '@tauri-apps/api/app';
import { check as checkUpdate } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

interface GithubAsset {
	name: string;
	browser_download_url: string;
	size: number;
}

interface GithubRelease {
	id: number;
	tag_name: string;
	name: string;
	body: string;
	published_at: string;
	prerelease: boolean;
	assets: GithubAsset[];
}

interface UpdaterMod {
	fetchReleases: (owner: string, repo: string, http: typeof hostServices.http) => Promise<GithubRelease[]>;
	downloadAndOpen: (
		url: string,
		filename: string,
		http: typeof hostServices.http,
		paths: typeof hostServices.paths,
		system: typeof hostServices.system,
	) => Promise<string>;
	getPlatformAsset: (assets: GithubAsset[]) => GithubAsset | null;
	compareVersions: (a: string, b: string) => number;
	normalizeVersion: (tag: string) => string;
}

const OWNER = 'alexIV-0';
const REPO = 'fs.manager.releases';
const PLUGIN_VERSION = '1.0.0';

export const AppUpdaterAccordion: React.FC = () => {
	const [expanded, setExpanded] = useState(false);
	const [currentVersion, setCurrentVersion] = useState('');
	const [releases, setReleases] = useState<GithubRelease[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [installing, setInstalling] = useState<string | null>(null);
	const [installed, setInstalled] = useState<string | null>(null);
	const [progress, setProgress] = useState<number | null>(null);

	const modRef = useRef<UpdaterMod | null>(null);

	useEffect(() => {
		getVersion().then(setCurrentVersion).catch(() => {});
	}, []);

	// Тихая автопроверка последней версии при монтировании — чтобы в шапке аккордеона
	// сразу показать "v{current} / v{latest}" без раскрытия. Ошибки игнорируем
	// (например, нет сети) — в этом случае latest просто не покажется.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				if (!modRef.current) {
					modRef.current = await loadPlugin('updater', PLUGIN_VERSION);
				}
				const data = await modRef.current!.fetchReleases(OWNER, REPO, hostServices.http);
				if (!cancelled) setReleases((prev) => (prev.length === 0 ? data : prev));
			} catch {
				/* silent */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// Самый свежий не-prerelease релиз из загруженного списка.
	const latestStable = releases.find((r) => !r.prerelease) ?? releases[0];
	const latestTag = latestStable ? latestStable.tag_name.replace(/^v/, '') : '';
	const hasUpdate =
		!!latestTag &&
		!!currentVersion &&
		!!modRef.current &&
		modRef.current.compareVersions(latestTag, currentVersion) > 0;

	const loadReleases = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			if (!modRef.current) {
				modRef.current = await loadPlugin('updater', PLUGIN_VERSION);
			}
			const mod = modRef.current!;
			const data = await mod.fetchReleases(OWNER, REPO, hostServices.http);
			setReleases(data);
		} catch (e: any) {
			setError(e?.message ?? 'Failed to fetch releases');
		} finally {
			setLoading(false);
		}
	}, []);

	const handleExpand = (_: React.SyntheticEvent, isExpanded: boolean) => {
		setExpanded(isExpanded);
		if (isExpanded && releases.length === 0 && !loading) {
			loadReleases();
		}
	};

	// Качаем подписанный бандл нативным апдейтером и накатываем его поверх
	// текущей установки + релончим. Работает только если в репо лежит latest.json
	// с подписями (см. tauri.conf.json/plugins/updater).
	// Возвращает true если native установка прошла; false если latest.json нет
	// или версия из latest.json не совпадает с запрошенным релизом — тогда
	// падаем в fallback на скачивание DMG/EXE.
	const tryNativeInstall = async (release: GithubRelease): Promise<boolean> => {
		try {
			const update = await checkUpdate();
			if (!update) return false; // latest.json не настроен или нет апдейта
			// Проверяем что native-апдейт указывает на ту же версию что выбрал юзер.
			// Если в latest.json другая версия — не путаем юзера, fallback.
			const nativeVer = update.version.replace(/^v/, '');
			const wantVer = release.tag_name.replace(/^v/, '');
			if (nativeVer !== wantVer) return false;

			let total = 0;
			let downloaded = 0;
			await update.downloadAndInstall((event) => {
				if (event.event === 'Started') {
					total = event.data.contentLength ?? 0;
					setProgress(0);
				} else if (event.event === 'Progress') {
					downloaded += event.data.chunkLength;
					if (total > 0) setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
				} else if (event.event === 'Finished') {
					setProgress(100);
				}
			});
			await relaunch(); // приложение перезапустится — дальше код не выполнится
			return true;
		} catch (e) {
			console.warn('[AppUpdater] native install failed, falling back:', e);
			return false;
		}
	};

	const handleInstall = async (release: GithubRelease) => {
		if (!modRef.current) return;
		const asset = modRef.current.getPlatformAsset(release.assets);
		if (!asset) {
			setError(`No installer found for your platform in ${release.tag_name}`);
			return;
		}
		setInstalling(release.tag_name);
		setInstalled(null);
		setProgress(null);
		try {
			// Сначала пробуем тихую native-установку (если есть latest.json + подпись).
			const nativeOk = await tryNativeInstall(release);
			if (nativeOk) {
				setInstalled(release.tag_name);
				return;
			}
			// Fallback: скачиваем DMG/EXE/AppImage и открываем системно.
			setProgress(null);
			await modRef.current.downloadAndOpen(asset.browser_download_url, asset.name, hostServices.http, hostServices.paths, hostServices.system);
			setInstalled(release.tag_name);
		} catch (e: any) {
			setError(`Install failed: ${e?.message ?? e}`);
		} finally {
			setInstalling(null);
			setProgress(null);
		}
	};

	const isNewer = (tag: string) => {
		if (!modRef.current || !currentVersion) return false;
		return modRef.current.compareVersions(modRef.current.normalizeVersion(tag), currentVersion) > 0;
	};

	const isCurrent = (tag: string) => {
		if (!modRef.current || !currentVersion) return false;
		return modRef.current.compareVersions(modRef.current.normalizeVersion(tag), currentVersion) === 0;
	};

	return (
		<Accordion
			expanded={expanded}
			onChange={handleExpand}
			disableGutters
			sx={{
				bgcolor: greyColor(14),
				border: '1px solid',
				borderColor: 'divider',
				borderRadius: '4px !important',
				mb: 1,
				'&:before': { display: 'none' },
				flexShrink: 0,
			}}
		>
			<AccordionSummary
				expandIcon={<ChevronDown size={16} color={greyColor(55)} />}
				sx={{
					minHeight: 40,
					px: 2,
					'& .MuiAccordionSummary-content': { my: 0, alignItems: 'center', gap: 1.5 },
				}}
			>
				<RefreshCw size={14} color={cyanColor(60)} />
				<Typography sx={{ fontSize: '0.8rem', color: greyColor(75), fontWeight: 500 }}>
					App Updates
				</Typography>
				{currentVersion && (
					<Chip
						label={
							hasUpdate ? (
								<Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
									<Box component='span'>{`v${currentVersion}`}</Box>
									<Box component='span' sx={{ color: greyColor(40) }}>/</Box>
									<Box component='span' sx={{ color: '#66bb6a', fontWeight: 600 }}>{`v${latestTag}`}</Box>
								</Box>
							) : (
								`v${currentVersion}`
							)
						}
						size='small'
						sx={{
							height: 18,
							fontSize: '0.65rem',
							bgcolor: greyColor(22),
							color: greyColor(55),
							border: 'none',
							'& .MuiChip-label': { px: 0.75 },
						}}
					/>
				)}
			</AccordionSummary>

			<AccordionDetails sx={{ p: 0, borderTop: '1px solid', borderColor: 'divider' }}>
				{/* Toolbar */}
				<Box
					sx={{
						px: 2,
						py: 0.75,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						borderBottom: '1px solid',
						borderColor: 'divider',
					}}
				>
					<Typography sx={{ fontSize: '0.72rem', color: greyColor(45) }}>
						{loading ? 'Loading releases...' : `${releases.length} releases`}
					</Typography>
					<Tooltip title='Refresh'>
						<Box
							component='span'
							onClick={loadReleases}
							sx={{
								cursor: 'pointer',
								color: loading ? greyColor(35) : greyColor(55),
								display: 'flex',
								'&:hover': { color: cyanColor(70) },
								pointerEvents: loading ? 'none' : 'auto',
							}}
						>
							<RefreshCw size={13} />
						</Box>
					</Tooltip>
				</Box>

				{/* Error */}
				{error && (
					<Box sx={{ px: 2, py: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
						<AlertCircle size={13} color='#f44336' />
						<Typography sx={{ fontSize: '0.72rem', color: '#f44336' }}>{error}</Typography>
					</Box>
				)}

				{/* Release list */}
				<Box sx={{ maxHeight: 260, overflowY: 'auto' }}>
					{loading && releases.length === 0 ? (
						<Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
							<CircularProgress size={20} sx={{ color: cyanColor(60) }} />
						</Box>
					) : releases.length === 0 && !loading ? (
						<Box sx={{ px: 2, py: 1.5 }}>
							<Typography sx={{ fontSize: '0.72rem', color: greyColor(40) }}>
								No releases found. Push to GitHub to publish a release.
							</Typography>
						</Box>
					) : (
						releases.map((release) => {
							const current = isCurrent(release.tag_name);
							const newer = isNewer(release.tag_name);
							const isInstallingThis = installing === release.tag_name;
							const wasInstalled = installed === release.tag_name;
							const hasAsset = modRef.current ? Boolean(modRef.current.getPlatformAsset(release.assets)) : true;

							return (
								<Box
									key={release.id}
									sx={{
										px: 2,
										py: 0.75,
										display: 'flex',
										alignItems: 'center',
										gap: 1.5,
										borderBottom: '1px solid',
										borderColor: 'divider',
										bgcolor: current ? `${cyanColor(60)}10` : 'transparent',
										'&:last-child': { borderBottom: 'none' },
									}}
								>
									{/* Version */}
									<Box sx={{ minWidth: 70 }}>
										<Typography
											sx={{
												fontSize: '0.78rem',
												fontWeight: current ? 600 : 400,
												color: current ? cyanColor(80) : greyColor(75),
											}}
										>
											{release.tag_name}
										</Typography>
									</Box>

									{/* Date */}
									<Typography sx={{ fontSize: '0.68rem', color: greyColor(40), flex: 1 }}>
										{new Date(release.published_at).toLocaleDateString()}
									</Typography>

									{/* Badges */}
									{release.prerelease && (
										<Chip label='pre' size='small' sx={{ height: 16, fontSize: '0.6rem', bgcolor: greyColor(22), color: greyColor(50) }} />
									)}
									{current && (
										<Chip label='current' size='small' sx={{ height: 16, fontSize: '0.6rem', bgcolor: `${cyanColor(60)}20`, color: cyanColor(70) }} />
									)}
									{newer && !current && (
										<Chip label='new' size='small' sx={{ height: 16, fontSize: '0.6rem', bgcolor: '#2e7d3220', color: '#66bb6a' }} />
									)}

									{/* Install button */}
									{!current && (
										<Tooltip title={!hasAsset ? 'No installer for your platform' : wasInstalled ? 'Installer opened' : 'Download & install'}>
											<Box
												component='span'
												onClick={() => !isInstallingThis && !wasInstalled && hasAsset && handleInstall(release)}
												sx={{
													cursor: isInstallingThis || wasInstalled || !hasAsset ? 'default' : 'pointer',
													color: wasInstalled ? '#66bb6a' : !hasAsset ? greyColor(30) : greyColor(55),
													display: 'flex',
													'&:hover': {
														color: isInstallingThis || wasInstalled || !hasAsset ? undefined : cyanColor(70),
													},
												}}
											>
												{isInstallingThis ? (
													progress !== null ? (
														<Box sx={{ position: 'relative', display: 'inline-flex' }}>
															<CircularProgress
																size={20}
																variant='determinate'
																value={progress}
																sx={{ color: cyanColor(60) }}
															/>
															<Box
																sx={{
																	position: 'absolute',
																	inset: 0,
																	display: 'flex',
																	alignItems: 'center',
																	justifyContent: 'center',
																	fontSize: '0.55rem',
																	color: greyColor(70),
																}}
															>
																{progress}
															</Box>
														</Box>
													) : (
														<CircularProgress size={14} sx={{ color: cyanColor(60) }} />
													)
												) : wasInstalled ? (
													<CheckCircle size={14} />
												) : (
													<Download size={14} />
												)}
											</Box>
										</Tooltip>
									)}
								</Box>
							);
						})
					)}
				</Box>

				{/* After install hint — показывается только в fallback-режиме (без latest.json).
				    При native установке приложение релончится автоматически и эта подсказка не успеет
				    отрисоваться. */}
				{installed && (
					<Box sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
						<Typography sx={{ fontSize: '0.7rem', color: greyColor(50) }}>
							Installer opened. Complete installation and restart the app.
						</Typography>
					</Box>
				)}
			</AccordionDetails>
		</Accordion>
	);
};
