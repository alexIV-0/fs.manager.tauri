import { useEffect, useState } from 'react';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { VideoPreview } from './components/VideoPreview';
import { AudioPreview } from './components/AudioPreview';
import { ImagePreview } from './components/ImagePreview';
import { TextPreview } from './components/TextPreview';

export interface PreviewData {
	filePath: string;
	fileType: string;
}

// Расширения, которые всегда открываются в текстовом редакторе
// независимо от того, что вернул getFileTypeByExtname
const TEXT_EXTS = new Set([
	'txt', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'less',
	'html', 'htm', 'xml', 'yaml', 'yml', 'md', 'markdown',
	'sh', 'bash', 'zsh', 'py', 'rb', 'php', 'go', 'rs', 'java',
	'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'sql',
	'vtt', 'srt', 'lrc', 'csv', 'tsv', 'ini', 'toml', 'env',
]);

// Определяем тип для компонента превью по расширению файла и типу из IPC
function resolveViewType(fileType: string, filePath: string): 'video' | 'audio' | 'images' | 'text' | 'unsupported' {
	const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

	// Сначала проверяем расширение — оно точнее для текстовых файлов
	if (TEXT_EXTS.has(ext)) return 'text';

	// Затем используем тип из IPC
	switch (fileType) {
		case 'video': return 'video';
		case 'audio': return 'audio';
		case 'image': return 'images';
		case 'text':
		case 'title':
		case 'xlsx':
			return 'text';
		default:
			return 'unsupported';
	}
}

function PreviewApp() {
	const [data, setData] = useState<PreviewData | null>(null);

	useEffect(() => {
		window.electronAPI.onUpdateData((_event: any, rawData: string) => {
			try {
				setData(JSON.parse(rawData));
			} catch {
				console.error('Invalid preview data:', rawData);
			}
		});

		window.electronAPI.requestData();

	}, []);

	// Esc — закрыть окно, даже если фокус в Monaco-редакторе.
	useKeyboardShortcut({
		key: 'Escape',
		skipOnInput: false,
		callback: () => window.close(),
	});

	useKeyboardShortcut({
		key: 'F12',
		skipOnInput: false,
		callback: () => window.electronAPI.openDevTools(),
	});

	// Drag-зона по верху окна (32px) — за неё можно перетаскивать окно.
	// Кнопка закрытия убрана: окно закрывается по Esc или нативной кнопкой OS.
	const chrome = (
		<div style={{
			position: 'fixed', top: 0, left: 0, right: 0, height: 32,
			WebkitAppRegion: 'drag',
			zIndex: 1000,
		} as any} />
	);

	if (!data) {
		return (
			<>
				{chrome}
				<div
					style={{
						color: '#555',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						height: '100vh',
						background: '#111',
						fontSize: 14,
						fontFamily: 'system-ui, sans-serif',
					}}
				>
					Waiting for file...
				</div>
			</>
		);
	}

	const { filePath, fileType } = data;
	const viewType = resolveViewType(fileType, filePath);

	const content = (() => {
		switch (viewType) {
			case 'video':
				return <VideoPreview key={filePath} filePath={filePath} />;
			case 'audio':
				return <AudioPreview key={filePath} filePath={filePath} />;
			case 'images':
				return <ImagePreview key={filePath} filePath={filePath} />;
			case 'text':
				return <TextPreview key={filePath} filePath={filePath} />;
			default:
				return (
					<div
						style={{
							color: '#666',
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							justifyContent: 'center',
							height: '100vh',
							background: '#111',
							gap: 10,
							fontFamily: 'system-ui, sans-serif',
						}}
					>
						<span style={{ fontSize: 15 }}>Cannot preview this file type</span>
						<span style={{ fontSize: 12, color: '#444', maxWidth: 400, textAlign: 'center', wordBreak: 'break-all' }}>
							{filePath}
						</span>
					</div>
				);
		}
	})();

	return (
		<>
			{content}
			{chrome}
		</>
	);
}

export default PreviewApp;
