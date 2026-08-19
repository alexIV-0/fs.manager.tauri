import { TextEditProperty, TextEditLanguage, CustomNodeData, Property, isDynamicProperty } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useUpdateFlow } from '@/NODE_WIN/hooks/useUpdateFlow';
import { useCascadeValidation } from '@/NODE_WIN/hooks/useCascadeValidation';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { greyColor } from '@/Store/Color/grayColor';
import { useEdges, useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropertyLabelEditor from './PropertyLabelEditor';
import TooltipOrDelete from './TooltipOrDelete';
import TextEditModal from './TextEdit/TextEditModal';
import { SavePresetModal } from './TextEdit/SavePresetModal';
import { LoadPresetModal } from './TextEdit/LoadPresetModal';
import { PRESETS, MIN_WIDTH, MIN_HEIGHT } from './TextEdit/constants';
import { ResizeDirection } from './TextEdit/types';
import InputHandle from '../components/InputHandle';
import { registerMonacoClipboard } from '@/Utils/monacoClipboard';
import { runUserCode } from '@/Utils/runUserCode';
import { RunPanelState } from './TextEdit/types';

function TextEditPropertyComponent({ property }: { property: TextEditProperty }) {
	const nodeId = useNodeContext();
	const { updateNodeProperty } = useUpdateFlow();
	const updateNodeInternals = useUpdateNodeInternals();
	const reactFlow = useReactFlow();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const defColor = colorTypes.default as string;
	const { handleEdgeRemoval, handleNodePropertyChange } = useCascadeValidation();

	const borderColor = greyColor(25);
	const bgModal = greyColor(12);
	const bgHeader = greyColor(18);
	const previewBg = greyColor(15);
	const previewBgHover = greyColor(18);

	const theme = { bgModal, bgHeader, borderColor, defColor };

	const edges = useEdges();
	const isConnected = property.isInput ? edges.some((e) => e.target === nodeId && e.targetHandle === property.id) : false;

	const { controlProps } = property;
	const editLabel = controlProps?.editLabel ?? false;
	const tooltip = controlProps?.tooltip ?? '';
	const isDynamic = isDynamicProperty(property);
	const runnable = controlProps?.runnable ?? false;

	const [isOpen, setIsOpen] = useState(false);
	const [value, setValue] = useState<string>(controlProps.value ?? '');
	const [language, setLanguage] = useState<TextEditLanguage>(controlProps.language ?? 'plaintext');
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [modalSize, setModalSize] = useState(PRESETS.M);
	const [anchorPos, setAnchorPos] = useState<{ x: number; y: number } | null>(null);
	const [showSavePreset, setShowSavePreset] = useState(false);
	const [showLoadPreset, setShowLoadPreset] = useState(false);
	const [running, setRunning] = useState(false);
	const [runResult, setRunResult] = useState<RunPanelState | null>(null);

	const buttonRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<HTMLDivElement>(null);
	const monacoRef = useRef<any>(null);
	const editorInst = useRef<any>(null);
	const modalSizeRef = useRef(PRESETS.M);
	const resizingRef = useRef<{
		dir: ResizeDirection;
		startX: number;
		startY: number;
		startW: number;
		startH: number;
	} | null>(null);

	useEffect(() => {
		modalSizeRef.current = modalSize;
	}, [modalSize]);

	// ── Label ─────────────────────────────────────────────────────────────────

	const handleSaveLabel = useCallback(
		(newLabel: string) => {
			reactFlow.updateNode(nodeId, (node) => {
				const nodeData = node.data as CustomNodeData;
				const updatedProperties = nodeData.properties.map((p) => {
					if (p.id !== property.id) return p;
					return { ...p, controlProps: { ...p.controlProps, label: newLabel } };
				});
				return { ...node, data: { ...nodeData, properties: updatedProperties } };
			});
		},
		[nodeId, property.id, reactFlow],
	);

	// ── Delete ────────────────────────────────────────────────────────────────

	const handleDelete = useCallback(() => {
		const incomingEdges = reactFlow.getEdges().filter((e) => e.target === nodeId && e.targetHandle === property.id);
		if (incomingEdges.length > 0) {
			reactFlow.setEdges((eds) => eds.filter((e) => !(e.target === nodeId && e.targetHandle === property.id)));
		}
		reactFlow.updateNode(nodeId, (node) => {
			const nodeData = node.data as CustomNodeData;
			const updatedProperties = nodeData.properties.filter((p) => p.id !== property.id) as Property[];
			return { ...node, data: { ...nodeData, properties: updatedProperties } };
		});
		setTimeout(() => {
			incomingEdges.forEach((edge) => handleEdgeRemoval(edge));
			handleNodePropertyChange(nodeId);
			updateNodeInternals(nodeId);
		}, 0);
	}, [nodeId, property.id, reactFlow, handleEdgeRemoval, handleNodePropertyChange, updateNodeInternals]);

	// ── Monaco ────────────────────────────────────────────────────────────────

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
			value,
			language,
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
			renderLineHighlight: 'none',
		});
		editorInst.current.onDidChangeModelContent(() => {
			setValue(editorInst.current.getValue());
		});

		// WKWebView не отдаёт Monaco системный буфер — регистрируем copy/cut/paste вручную.
		registerMonacoClipboard(editorInst.current, monaco);
	}, [value, language]);

	const handleOpen = useCallback(async () => {
		if (buttonRef.current) {
			const rect = buttonRef.current.getBoundingClientRect();
			setAnchorPos({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
		}
		await initMonaco();
		setIsOpen(true);
	}, [initMonaco]);

	useEffect(() => {
		if (!isOpen) return;
		const t = setTimeout(() => mountEditor(), 50);
		return () => clearTimeout(t);
	}, [isOpen, mountEditor]);

	const handleClose = useCallback(() => {
		if (editorInst.current) {
			editorInst.current.dispose();
			editorInst.current = null;
		}
		setIsOpen(false);
		setIsFullscreen(false);
	}, []);

	const handleSave = useCallback(() => {
		const currentValue = editorInst.current ? editorInst.current.getValue() : value;
		updateNodeProperty(nodeId, property.id, currentValue);
		setValue(currentValue);
		updateNodeInternals(nodeId);
		handleClose();
	}, [nodeId, property.id, value, updateNodeProperty, updateNodeInternals, handleClose]);

	const handleLanguageChange = useCallback((lang: TextEditLanguage) => {
		setLanguage(lang);
		if (editorInst.current && monacoRef.current) {
			const model = editorInst.current.getModel();
			if (model) monacoRef.current.editor.setModelLanguage(model, lang);
		}
	}, []);

	const handleApplyPreset = useCallback((preset: keyof typeof PRESETS) => {
		setIsFullscreen(false);
		setModalSize(PRESETS[preset]);
		setTimeout(() => editorInst.current?.layout(), 50);
	}, []);

	const handleToggleFullscreen = useCallback(() => {
		setIsFullscreen((prev) => !prev);
		setTimeout(() => editorInst.current?.layout(), 50);
	}, []);

	const getCurrentEditorValue = useCallback((): string => {
		return editorInst.current ? editorInst.current.getValue() : value;
	}, [value]);

	// ── Run (тест кода прямо в ноде) ────────────────────────────────────────────
	// Собираем scope из соседних добавленных входов ТАК ЖЕ, как рантайм плагина:
	// динамические свойства (editLabel) — по лейблу. Литеральные поля (TextEdit/Slider/…)
	// берут своё текущее значение; коннектор-входы (link) в дизайн-тайме недоступны → undefined.
	const handleRun = useCallback(async () => {
		const node = reactFlow.getNode(nodeId);
		if (!node) return;
		const props = (node.data as CustomNodeData).properties;

		const scope: Record<string, unknown> = {};
		const unavailable: string[] = [];
		for (const p of props) {
			if (p.id === property.id) continue; // само поле кода
			const dyn = (p.controlProps as any)?.editLabel === true;
			if (!dyn) continue; // берём только пользовательские входы, добавленные через «+»
			const name = (p.controlProps as any)?.label;
			if (!name) continue;
			if (p.controlType === 'link') {
				scope[name] = undefined; // значение придёт из пайплайна
				unavailable.push(name);
			} else {
				scope[name] = (p.controlProps as any)?.value;
			}
		}

		setRunning(true);
		try {
			const res = await runUserCode(getCurrentEditorValue(), scope);
			setRunResult({ ...res, unavailable });
		} finally {
			setRunning(false);
		}
	}, [reactFlow, nodeId, property.id, getCurrentEditorValue]);

	const handleClearRun = useCallback(() => setRunResult(null), []);

	const handlePresetLoaded = useCallback((text: string) => {
		if (editorInst.current) {
			editorInst.current.setValue(text);
		}
		setValue(text);
	}, []);

	// ── Resize ────────────────────────────────────────────────────────────────

	const handleResizeMouseDown = useCallback((e: React.MouseEvent, dir: ResizeDirection) => {
		e.preventDefault();
		e.stopPropagation();
		resizingRef.current = {
			dir,
			startX: e.clientX,
			startY: e.clientY,
			startW: modalSizeRef.current.width,
			startH: modalSizeRef.current.height,
		};
	}, []);

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!resizingRef.current) return;
			const { dir, startX, startY, startW, startH } = resizingRef.current;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			let newW = startW;
			let newH = startH;
			if (dir === 'e' || dir === 'w') newW = Math.max(MIN_WIDTH, startW + dx * (dir === 'e' ? 2 : -2));
			if (dir === 'n' || dir === 's') newH = Math.max(MIN_HEIGHT, startH + dy * (dir === 's' ? 2 : -2));
			if (dir === 'ne') {
				newW = Math.max(MIN_WIDTH, startW + dx * 2);
				newH = Math.max(MIN_HEIGHT, startH - dy * 2);
			}
			if (dir === 'nw') {
				newW = Math.max(MIN_WIDTH, startW - dx * 2);
				newH = Math.max(MIN_HEIGHT, startH - dy * 2);
			}
			if (dir === 'se') {
				newW = Math.max(MIN_WIDTH, startW + dx * 2);
				newH = Math.max(MIN_HEIGHT, startH + dy * 2);
			}
			if (dir === 'sw') {
				newW = Math.max(MIN_WIDTH, startW - dx * 2);
				newH = Math.max(MIN_HEIGHT, startH + dy * 2);
			}
			setModalSize({ width: Math.round(newW), height: Math.round(newH) });
			editorInst.current?.layout();
		};
		const onMouseUp = () => {
			resizingRef.current = null;
		};
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
		return () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		};
	}, []);

	useEffect(() => {
		if (editorInst.current) setTimeout(() => editorInst.current?.layout(), 10);
	}, [modalSize, isFullscreen]);

	useEffect(() => {
		return () => {
			if (editorInst.current) {
				editorInst.current.dispose();
				editorInst.current = null;
			}
		};
	}, []);

	// ── Preview ───────────────────────────────────────────────────────────────

	const inheritedValue = controlProps.inheritedValue;
	const firstLine = value ? value.split('\n')[0] : '';
	const hasMoreLines = value ? value.includes('\n') : false;
	const preview = isConnected ? (inheritedValue ?? '⟵ connected') : value ? firstLine + (hasMoreLines ? ' …' : '') : 'Click to edit...';

	// ── Render ────────────────────────────────────────────────────────────────

	return (
		<>
			<div ref={buttonRef} style={{ padding: '4px 12px' }} className='nodrag'>
				<div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
					{property.isInput && <InputHandle property={property} />}
					<PropertyLabelEditor label={controlProps?.label ?? ''} editLabel={editLabel} onSave={handleSaveLabel} />
					<TooltipOrDelete isDynamic={isDynamic} tooltip={tooltip} onDelete={handleDelete} property={property} />
				</div>
				<div
					onClick={isConnected ? undefined : handleOpen}
					style={{
						width: '100%',
						marginTop: 2,
						padding: '5px 8px',
						borderRadius: 4,
						border: `1px solid ${borderColor}`,
						cursor: isConnected ? 'default' : 'pointer',
						backgroundColor: previewBg,
						boxSizing: 'border-box',
						opacity: isConnected ? 0.5 : 1,
					}}
					onMouseEnter={
						isConnected
							? undefined
							: (e) => {
									(e.currentTarget as HTMLDivElement).style.backgroundColor = previewBgHover;
								}
					}
					onMouseLeave={
						isConnected
							? undefined
							: (e) => {
									(e.currentTarget as HTMLDivElement).style.backgroundColor = previewBg;
								}
					}
				>
					<span
						style={{
							fontSize: 11,
							color: isConnected ? greyColor(50) : value ? greyColor(65) : greyColor(40),
							fontFamily: 'monospace',
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							userSelect: 'none',
							display: 'block',
						}}
					>
						{preview}
					</span>
				</div>
			</div>

			{createPortal(
				isOpen ? (
					<>
						<TextEditModal
							{...theme}
							label={controlProps.label || ''}
							value={value}
							language={language}
							isFullscreen={isFullscreen}
							modalSize={modalSize}
							anchorPos={anchorPos}
							editorRef={editorRef}
							onClose={handleClose}
							onSave={handleSave}
							onLanguageChange={handleLanguageChange}
							onToggleFullscreen={handleToggleFullscreen}
							onApplyPreset={handleApplyPreset}
							onResizeMouseDown={handleResizeMouseDown}
							onSavePreset={() => setShowSavePreset(true)}
							onLoadPreset={() => setShowLoadPreset(true)}
							runnable={runnable}
							running={running}
							runResult={runResult}
							onRun={handleRun}
							onClearRun={handleClearRun}
						/>

						{showSavePreset && (
							<SavePresetModal
								{...theme}
								initialText={getCurrentEditorValue()}
								initialLanguage={language}
								editItem={null}
								onClose={() => setShowSavePreset(false)}
								onSaved={() => {}}
							/>
						)}

						{showLoadPreset && (
							<LoadPresetModal
								{...theme}
								currentLanguage={language}
								onClose={() => setShowLoadPreset(false)}
								onLoad={handlePresetLoaded}
							/>
						)}
					</>
				) : null,
				document.body,
			)}
		</>
	);
}

export default memo(TextEditPropertyComponent);
