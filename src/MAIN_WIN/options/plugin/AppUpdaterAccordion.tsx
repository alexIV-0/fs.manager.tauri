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
	fetchReleases: (owner: string, repo: string) => Promise<GithubRelease[]>;
	downloadAndOpen: (url: string, filename: string) => Promise<string>;
	getPlatformAsset: (assets: GithubAsset[]) => GithubAsset | null;
	compareVersions: (a: string, b: string) => number;
	normalizeVersion: (tag: string) => string;
}

const OWNER = 'alexIV-0';
const REPO = 'fs.manager.tauri';
const PLUGIN_VERSION = '1.0.0';

export const AppUpdaterAccordion: React.FC = () => {
	const [expanded, setExpanded] = useState(false);
	const [currentVersion, setCurrentVersion] = useState('');
	const [releases, setReleases] = useState<GithubRelease[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [installing, setInstalling] = useState<string | null>(null);
	const [installed, setInstalled] = useState<string | null>(null);

	const modRef = useRef<UpdaterMod | null>(null);

	useEffect(() => {
		window.electronAPI
			.invoke<string>('app:getVersion')
			.then(setCurrentVersion)
			.catch(() => {});
	}, []);

	const loadReleases = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			if (!modRef.current) {
				modRef.current = await loadPlugin('updater', PLUGIN_VERSION);
			}
			const mod = modRef.current!;
			const data = await mod.fetchReleases(OWNER, REPO);
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

	const handleInstall = async (release: GithubRelease) => {
		if (!modRef.current) return;
		const asset = modRef.current.getPlatformAsset(release.assets);
		if (!asset) {
			setError(`No installer found for your platform in ${release.tag_name}`);
			return;
		}
		setInstalling(release.tag_name);
		setInstalled(null);
		try {
			await modRef.current.downloadAndOpen(asset.browser_download_url, asset.name);
			setInstalled(release.tag_name);
		} catch (e: any) {
			setError(`Install failed: ${e?.message ?? e}`);
		} finally {
			setInstalling(null);
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
						label={`v${currentVersion}`}
						size='small'
						sx={{
							height: 18,
							fontSize: '0.65rem',
							bgcolor: greyColor(22),
							color: greyColor(55),
							border: 'none',
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
													<CircularProgress size={14} sx={{ color: cyanColor(60) }} />
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

				{/* After install hint */}
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
