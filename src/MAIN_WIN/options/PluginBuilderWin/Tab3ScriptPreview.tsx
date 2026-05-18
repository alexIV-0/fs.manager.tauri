import { useEffect, useRef, useCallback } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import type { PluginJsonData } from './types';
import { generateScriptTemplate } from './types';

interface Tab3Props {
	pluginJson: PluginJsonData;
	scriptContent: string | null;
	onScriptChange?: (v: string) => void;
}

export function Tab3ScriptPreview({ pluginJson, scriptContent, onScriptChange }: Tab3Props) {
	const gray40 = greyColor(40);
	const gray60 = greyColor(60);

	const editorRef = useRef<HTMLDivElement>(null);
	const monacoRef = useRef<any>(null);
	const editorInst = useRef<any>(null);

	const funcName = pluginJson.main.replace(/\.js$/, 'Func');
	const scriptName = pluginJson.main.replace('.js', '.ts');
	const initialContent = scriptContent ?? generateScriptTemplate(funcName);

	// Init Monaco (lazy, same pattern as TextEditProperty)
	const initMonaco = useCallback(async () => {
		if (monacoRef.current) return;
		const monaco = await import('monaco-editor');
		monacoRef.current = monaco;
		(self as any).MonacoEnvironment = {
			getWorker: () => {
				const blob = new Blob([''], { type: 'application/javascript' });
				return new Worker(URL.createObjectURL(blob));
			},
		};
	}, []);

	const mountEditor = useCallback(() => {
		if (!editorRef.current || !monacoRef.current || editorInst.current) return;
		const monaco = monacoRef.current;
		editorInst.current = monaco.editor.create(editorRef.current, {
			value: initialContent,
			language: 'typescript',
			theme: 'vs-dark',
			fontSize: 13,
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			wordWrap: 'on',
			lineNumbers: 'on',
			folding: true,
			automaticLayout: true,
			tabSize: 2,
			formatOnPaste: true,
			formatOnType: true,
			renderLineHighlight: 'line',
		});
		if (onScriptChange) {
			editorInst.current.onDidChangeModelContent(() => {
				onScriptChange(editorInst.current.getValue());
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		let cancelled = false;
		initMonaco().then(() => {
			if (!cancelled) {
				const t = setTimeout(() => mountEditor(), 50);
				return () => clearTimeout(t);
			}
		});
		return () => {
			cancelled = true;
			editorInst.current?.dispose();
			editorInst.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Sync content if scriptContent changes externally (e.g. plugin load)
	useEffect(() => {
		if (!editorInst.current) return;
		const current = editorInst.current.getValue();
		const next = scriptContent ?? generateScriptTemplate(funcName);
		if (current !== next) {
			editorInst.current.setValue(next);
		}
	}, [scriptContent, funcName]);

	return (
		<Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
			{/* Header bar */}
			<Stack direction='row' alignItems='center' gap={1} sx={{ px: 2, py: 0.75, borderBottom: `1px solid ${gray40}`, flexShrink: 0 }}>
				<Typography variant='caption' sx={{ color: gray60 }}>
					Файл: <strong>{scriptName}</strong>
				</Typography>
				{!scriptContent ? (
					<Chip label='будет создан при первом сохранении' size='small' variant='outlined' sx={{ fontSize: 10 }} />
				) : (
					<Chip label='существующий файл' size='small' color='success' variant='outlined' sx={{ fontSize: 10 }} />
				)}
				<Chip
					label='TypeScript'
					size='small'
					sx={{ fontSize: 10, ml: 'auto', bgcolor: '#007acc22', color: '#4fc3f7', border: '1px solid #007acc44' }}
				/>
			</Stack>

			{/* Monaco editor */}
			<Box ref={editorRef} sx={{ flex: 1, minHeight: 0 }} />
		</Box>
	);
}
