import { useRef, useState, useCallback, useEffect } from 'react';
import { Box, IconButton, Popover, Button, Stack } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';

const PRESET_COLORS = [
	'#ffffff',
	'#cdd6f4',
	'#89b4fa',
	'#a6e3a1',
	'#fab387',
	'#f38ba8',
	'#f9e2af',
	'#94e2d5',
	'#cba6f7',
	'#74c7ec',
	'#ffff00',
	'#ff6b6b',
	'#4ecdc4',
	'#ff9900',
	'#e879f9',
];

interface RichTextEditorProps {
	value: string;
	onChange: (v: string) => void;
	minHeight?: number;
}

export function RichTextEditor({ value, onChange, minHeight = 140 }: RichTextEditorProps) {
	const editorRef = useRef<HTMLDivElement>(null);
	const savedRangeRef = useRef<Range | null>(null);
	// use ref for color to avoid re-render lag while dragging color picker
	const colorInputRef = useRef<HTMLInputElement>(null);
	const [activeColor, setActiveColor] = useState('#89b4fa');
	const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);

	const gray15 = greyColor(15);
	const gray20 = greyColor(20);
	const gray40 = greyColor(40);
	const gray60 = greyColor(60);

	useEffect(() => {
		if (editorRef.current) editorRef.current.innerHTML = value || '';
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Save selection before focus leaves the editor (e.g. clicking toolbar)
	const saveSelection = useCallback(() => {
		const sel = window.getSelection();
		if (sel && sel.rangeCount > 0) {
			savedRangeRef.current = sel.getRangeAt(0).cloneRange();
		}
	}, []);

	const restoreSelection = useCallback(() => {
		const editor = editorRef.current;
		if (!editor) return;
		editor.focus();
		const sel = window.getSelection();
		if (sel && savedRangeRef.current) {
			sel.removeAllRanges();
			sel.addRange(savedRangeRef.current);
		}
	}, []);

	const exec = useCallback(
		(cmd: string, val?: string) => {
			restoreSelection();
			document.execCommand(cmd, false, val);
			const html = editorRef.current?.innerHTML ?? '';
			onChange(html === '<br>' ? '' : html);
			saveSelection();
		},
		[onChange, restoreSelection, saveSelection],
	);

	const applyColor = useCallback(
		(color: string) => {
			setActiveColor(color);
			setColorAnchor(null);
			exec('foreColor', color);
		},
		[exec],
	);

	const handleInput = useCallback(() => {
		const html = editorRef.current?.innerHTML ?? '';
		onChange(html === '<br>' ? '' : html);
	}, [onChange]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			// Предотвращаем всплытие Enter, чтобы родительские обработчики
			// не перехватывали его при редактировании текста
			if (e.key === 'Enter') {
				e.stopPropagation();
			}
			if (e.key === 'b' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				exec('bold');
			}
			if (e.key === 'i' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				exec('italic');
			}
			if (e.key === 'u' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				exec('underline');
			}
		},
		[exec],
	);

	const Divider = () => <Box sx={{ width: '1px', bgcolor: gray40, mx: 0.5, alignSelf: 'stretch', flexShrink: 0 }} />;

	const toolSx = {
		width: 26,
		height: 26,
		borderRadius: 0.5,
		color: '#cdd6f4',
		flexShrink: 0,
		'&:hover': { bgcolor: 'rgba(255,255,255,0.1)' },
	};

	return (
		<Box>
			{/* ── Toolbar — single row ── */}
			<Stack
				direction='row'
				alignItems='center'
				gap={0.25}
				sx={{
					px: 0.75,
					py: 0.4,
					bgcolor: gray20,
					border: `1px solid ${gray40}`,
					borderBottom: 'none',
					borderRadius: '6px 6px 0 0',
					overflow: 'hidden',
				}}
			>
				<IconButton
					size='small'
					onMouseDown={(e) => {
						e.preventDefault();
						exec('bold');
					}}
					title='Bold (Ctrl+B)'
					sx={toolSx}
				>
					<span style={{ fontWeight: 800, fontSize: 13, lineHeight: 1 }}>B</span>
				</IconButton>
				<IconButton
					size='small'
					onMouseDown={(e) => {
						e.preventDefault();
						exec('italic');
					}}
					title='Italic (Ctrl+I)'
					sx={toolSx}
				>
					<span style={{ fontStyle: 'italic', fontSize: 13, lineHeight: 1 }}>I</span>
				</IconButton>
				<IconButton
					size='small'
					onMouseDown={(e) => {
						e.preventDefault();
						exec('underline');
					}}
					title='Underline (Ctrl+U)'
					sx={toolSx}
				>
					<span style={{ textDecoration: 'underline', fontSize: 13, lineHeight: 1 }}>U</span>
				</IconButton>

				<Divider />

				<IconButton
					size='small'
					onMouseDown={(e) => {
						e.preventDefault();
						exec('insertUnorderedList');
					}}
					title='Bullet list'
					sx={toolSx}
				>
					<span style={{ fontSize: 12, lineHeight: 1 }}>•—</span>
				</IconButton>
				<IconButton
					size='small'
					onMouseDown={(e) => {
						e.preventDefault();
						exec('insertOrderedList');
					}}
					title='Numbered list'
					sx={toolSx}
				>
					<span style={{ fontSize: 12, lineHeight: 1 }}>1.</span>
				</IconButton>

				<Divider />

				{/* Color button — save selection first, then open popover */}
				<IconButton
					size='small'
					onMouseDown={(e) => {
						e.preventDefault();
						saveSelection();
					}}
					onClick={(e) => setColorAnchor(e.currentTarget)}
					title='Text color'
					sx={toolSx}
				>
					<span style={{ fontSize: 14, lineHeight: 1, borderBottom: `3px solid ${activeColor}`, paddingBottom: 1 }}>A</span>
				</IconButton>

				<Box sx={{ flex: 1 }} />

				<IconButton
					size='small'
					onMouseDown={(e) => {
						e.preventDefault();
						exec('removeFormat');
					}}
					title='Remove formatting'
					sx={{ ...toolSx, opacity: 0.5, fontSize: 11 }}
				>
					<span style={{ fontSize: 11 }}>✕fmt</span>
				</IconButton>
			</Stack>

			{/* ── Editable area ── */}
			<Box
				ref={editorRef}
				contentEditable
				suppressContentEditableWarning
				onInput={handleInput}
				onKeyDown={handleKeyDown}
				sx={{
					border: `1px solid ${gray40}`,
					borderRadius: '0 0 6px 6px',
					p: 1.5,
					minHeight,
					maxHeight: 320,
					overflowY: 'auto',
					bgcolor: gray15,
					fontSize: 13,
					lineHeight: 1.7,
					color: '#cdd6f4',
					outline: 'none',
					cursor: 'text',
					'& b, & strong': { fontWeight: 700 },
					'& i, & em': { fontStyle: 'italic' },
					'& u': { textDecoration: 'underline' },
					'& ul': { paddingLeft: '1.2em', margin: '2px 0' },
					'& ol': { paddingLeft: '1.2em', margin: '2px 0' },
					'& li': { marginBottom: 1 },
					'& div': { minHeight: '1.4em' },
				}}
			/>

			{/* ── Color popover ── */}
			<Popover
				open={Boolean(colorAnchor)}
				anchorEl={colorAnchor}
				onClose={() => setColorAnchor(null)}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
				slotProps={{
					paper: {
						sx: {
							bgcolor: gray15,
							border: `1px solid ${gray40}`,
							borderRadius: 1.5,
							p: 1.5,
						},
					},
				}}
			>
				{/* Preset swatches */}
				<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1, maxWidth: 200 }}>
					{PRESET_COLORS.map((c) => (
						<Box
							key={c}
							onMouseDown={(e) => e.preventDefault()} // don't lose editor focus via pointer
							onClick={() => applyColor(c)}
							sx={{
								width: 22,
								height: 22,
								borderRadius: 0.5,
								bgcolor: c,
								cursor: 'pointer',
								border: `2px solid ${activeColor === c ? '#fff' : gray40}`,
								transition: 'transform 0.1s',
								'&:hover': { transform: 'scale(1.2)' },
							}}
						/>
					))}
				</Box>

				{/* Custom color — use ref to avoid re-render lag */}
				<Stack direction='row' alignItems='center' gap={0.75}>
					<Box component='span' sx={{ fontSize: 11, color: gray60, whiteSpace: 'nowrap' }}>
						Свой:
					</Box>
					<input
						ref={colorInputRef}
						type='color'
						defaultValue={activeColor}
						style={{
							width: 32,
							height: 24,
							border: 'none',
							background: 'transparent',
							cursor: 'pointer',
							padding: 0,
						}}
					/>
					<Button
						size='small'
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => {
							const c = colorInputRef.current?.value ?? activeColor;
							applyColor(c);
						}}
						sx={{ fontSize: 10, py: 0.25, px: 0.75, minWidth: 0 }}
					>
						OK
					</Button>
				</Stack>
			</Popover>
		</Box>
	);
}
