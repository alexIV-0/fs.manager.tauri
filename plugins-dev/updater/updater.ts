// System plugin: GitHub-based app updater.
// Provides release list fetching and installer download/open.
//
// Usage in AppUpdaterAccordion:
//   const mod = await loadPlugin('updater', '1.0.0')
//   const releases = await mod.fetchReleases('alexIV-0', 'fs.manager.tauri')
//   await mod.downloadAndOpen(asset.browser_download_url, asset.name)

import type { PluginContext } from '../../src/PluginAPI/host';

// Это НЕ нода: плагин грузят напрямую из React (AppUpdaterAccordion) через
// loadPlugin, минуя processItem, поэтому ctx третьим аргументом ему никто не
// передаёт. Сервисы принимаем параметрами — их подставляет вызывающий компонент,
// у которого есть доступ к hostServices. Экспорт `onLoad` убран: его наличие
// запрещало loader.ts кэшировать модуль.

export interface GithubAsset {
	name: string;
	browser_download_url: string;
	size: number;
	content_type: string;
}

export interface GithubRelease {
	id: number;
	tag_name: string;
	name: string;
	body: string;
	published_at: string;
	draft: boolean;
	prerelease: boolean;
	assets: GithubAsset[];
}

// ─── Platform detection ───────────────────────────────────────────────────────

type PlatformKey = 'darwin-aarch64' | 'darwin-x86_64' | 'windows-x86_64' | 'linux-x86_64';

function detectPlatform(): PlatformKey {
	const ua = navigator.userAgent.toLowerCase();
	const platform = navigator.platform?.toLowerCase() ?? '';

	if (ua.includes('mac') || platform.includes('mac')) {
		// Apple Silicon or Intel
		const isArm = ua.includes('arm') || platform.includes('arm') || ua.includes('aarch64');
		return isArm ? 'darwin-aarch64' : 'darwin-x86_64';
	}
	if (ua.includes('win') || platform.includes('win')) return 'windows-x86_64';
	return 'linux-x86_64';
}

// Asset filename patterns per platform
const PLATFORM_PATTERNS: Record<PlatformKey, RegExp[]> = {
	'darwin-aarch64': [/aarch64\.dmg$/i, /arm64\.dmg$/i, /darwin.*arm.*\.dmg$/i],
	'darwin-x86_64':  [/x64\.dmg$/i, /x86_64\.dmg$/i, /darwin.*x64.*\.dmg$/i, /\.dmg$/i],
	'windows-x86_64': [/x64[-_]setup\.exe$/i, /\.msi$/i, /x64\.exe$/i, /setup\.exe$/i, /\.exe$/i],
	'linux-x86_64':   [/amd64\.AppImage$/i, /x86_64\.AppImage$/i, /\.AppImage$/i, /\.deb$/i],
};

/**
 * Returns the best matching asset for the current platform from a release's asset list.
 * Tries patterns in priority order; returns null if nothing matches.
 */
export function getPlatformAsset(assets: GithubAsset[]): GithubAsset | null {
	const platform = detectPlatform();
	const patterns = PLATFORM_PATTERNS[platform];

	for (const pattern of patterns) {
		const found = assets.find((a) => pattern.test(a.name));
		if (found) return found;
	}
	return null;
}

export function getCurrentPlatform(): PlatformKey {
	return detectPlatform();
}

// ─── GitHub API ───────────────────────────────────────────────────────────────

/**
 * Fetches all releases from a GitHub repo.
 * Returns releases sorted newest-first, excluding drafts.
 */
export async function fetchReleases(owner: string, repo: string, http: PluginContext['http']): Promise<GithubRelease[]> {
	const response = await http.fetch(
		`https://api.github.com/repos/${owner}/${repo}/releases`,
		{
			headers: [
				['Accept', 'application/vnd.github.v3+json'],
				['User-Agent', 'fsManager-updater'],
			],
		},
	);

	if (!response.ok) {
		throw new Error(`GitHub API error ${response.status}: ${response.body}`);
	}

	const releases: GithubRelease[] = JSON.parse(response.body);
	return releases.filter((r) => !r.draft).sort((a, b) =>
		new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
	);
}

// ─── Download & install ───────────────────────────────────────────────────────

/**
 * Downloads an installer asset to the system temp folder and opens it.
 * On macOS: opens .dmg with system open dialog.
 * On Windows: runs .msi / .exe installer.
 * On Linux: marks .AppImage as executable and opens it.
 *
 * Returns the downloaded file path.
 */
export async function downloadAndOpen(
	downloadUrl: string,
	filename: string,
	http: PluginContext['http'],
	paths: PluginContext['paths'],
	system: PluginContext['system'],
): Promise<string> {
	const tmpDir = await paths.tmpdir();
	const dest = `${tmpDir}/${filename}`;

	await http.download(downloadUrl, dest, {
		headers: [['User-Agent', 'fsManager-updater']],
	});

	// Open with system default — on macOS mounts DMG, on Windows runs installer
	await system.openPath(dest);

	return dest;
}

// ─── Version comparison ───────────────────────────────────────────────────────

/** Compares semver strings. Returns: positive if a > b, negative if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
	const normalize = (v: string) => v.replace(/^v/, '').split('.').map(Number);
	const pa = normalize(a);
	const pb = normalize(b);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/** Strips leading 'v' from a version tag (e.g. "v1.2.3" → "1.2.3"). */
export function normalizeVersion(tag: string): string {
	return tag.replace(/^v/, '');
}
