import { useState, memo } from 'react';
import { Box, IconButton, MenuItem, Select, Stack, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, Edit2, X } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import type { UiJsonData, UiPropertyData } from './types';
import { validateUiJson, toCamelCase } from './types';
import { NodeHeader } from './NodeHeader';
import { NodeResize } from './NodeResize';
import { NodePropertyItem } from './components/NodePropertyItem';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';

// ── Sortable property row ────────────────────────────────────────────────────

function SortablePropertyRow({
	property,
	isSelected,
	isOutputSource,
	onSelect,
	onDelete,
}: {
	property: UiPropertyData;
	isSelected: boolean;
	isOutputSource: boolean;
	onSelect: () => void;
	onDelete: () => void;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: property.id });
	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : 1,
	};

	return (
		<Box ref={setNodeRef} style={style}>
			<Box {...attributes} {...listeners} sx={{ cursor: 'grab', display: 'flex', alignItems: 'center', position: 'relative' }}>
				<NodePropertyItem property={property} isSelected={isSelected} isOutputSource={isOutputSource} onSelect={onSelect} />
				{/* Delete on hover */}
				<IconButton
					size='small'
					onClick={(e) => {
						e.stopPropagation();
						onDelete();
					}}
					sx={{
						position: 'absolute',
						right: 4,
						top: 4,
						p: 0.15,
						opacity: 0,
						'&:hover': { opacity: 0.8, color: 'error.main' },
						transition: 'opacity 0.15s',
					}}
				>
					<X size={10} />
				</IconButton>
			</Box>
		</Box>
	);
}

// ── Output handle ────────────────────────────────────────────────────────────

function OutputHandleEditor({
	sourceProperty,
	allPropertyIds,
	onChangeSource,
}: {
	sourceProperty: string | undefined;
	allPropertyIds: string[];
	onChangeSource: (id: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const gray30 = greyColor(30);
	const gray40 = greyColor(40);
	const gray60 = greyColor(60);

	const hasSource = !!sourceProperty && allPropertyIds.includes(sourceProperty);

	return (
		<Box sx={{ borderTop: `1px solid ${gray40}` }}>
			<Box
				onClick={() => setExpanded((v) => !v)}
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: 0.75,
					px: 1.5,
					py: 0.6,
					cursor: 'pointer',
					'&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
				}}
			>
				{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
				<Box
					sx={{
						width: 10,
						height: 10,
						borderRadius: '50%',
						bgcolor: hasSource ? '#81c784' : '#555',
						border: `2px solid ${hasSource ? '#4caf50' : '#777'}`,
						flexShrink: 0,
					}}
				/>
				<Typography variant='caption' sx={{ fontSize: 10.5, color: gray60 }}>
					Output handler
					{hasSource && <span style={{ color: '#81c784', marginLeft: 6 }}>→ {sourceProperty}</span>}
				</Typography>
			</Box>

			{expanded && (
				<Box sx={{ px: 1.5, pb: 1, bgcolor: gray30 }}>
					<Typography variant='caption' sx={{ color: gray60, display: 'block', mb: 0.5, fontSize: 10 }}>
						Параметр-источник типа выходного файла:
					</Typography>
					<Select
						size='small'
						value={sourceProperty ?? ''}
						fullWidth
						sx={{ fontSize: 11 }}
						onChange={(e) => onChangeSource(e.target.value)}
					>
						<MenuItem value='' sx={{ fontSize: 11, opacity: 0.5 }}>
							— не выбран —
						</MenuItem>
						{allPropertyIds.map((id) => (
							<MenuItem key={id} value={id} sx={{ fontSize: 11 }}>
								{id}
							</MenuItem>
						))}
					</Select>
				</Box>
			)}
		</Box>
	);
}

// ── Comment editor inside node ───────────────────────────────────────────────

function NodeComment({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	const gray40 = greyColor(40);
	const gray20 = greyColor(20);
	const gray60 = greyColor(60);

	const commit = () => {
		setEditing(false);
		onChange(draft);
	};
	const cancel = () => {
		setEditing(false);
		setDraft(value);
	};

	if (editing) {
		return (
			<Box sx={{ px: 1.5, pb: 1 }}>
				<textarea
					value={draft}
					autoFocus
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && e.metaKey) commit();
						if (e.key === 'Escape') cancel();
					}}
					style={{
						width: '100%',
						minHeight: 60,
						resize: 'vertical',
						background: gray20,
						border: `1px solid ${gray40}`,
						borderRadius: 4,
						color: gray60,
						fontSize: 11,
						padding: 8,
						fontFamily: 'inherit',
					}}
				/>
				<Stack direction='row' gap={0.5} sx={{ mt: 0.5 }}>
					<button
						onClick={commit}
						style={{
							fontSize: 10,
							cursor: 'pointer',
							background: '#2e7d32',
							color: '#fff',
							border: 'none',
							borderRadius: 3,
							padding: '2px 8px',
						}}
					>
						OK
					</button>
					<button
						onClick={cancel}
						style={{
							fontSize: 10,
							cursor: 'pointer',
							background: gray40,
							color: gray60,
							border: 'none',
							borderRadius: 3,
							padding: '2px 8px',
						}}
					>
						Отмена
					</button>
				</Stack>
			</Box>
		);
	}

	return (
		<Box
			onClick={() => {
				setDraft(value);
				setEditing(true);
			}}
			sx={{
				px: 1.5,
				py: 0.5,
				fontSize: 10,
				color: gray60,
				cursor: 'text',
				'&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
				minHeight: 20,
				display: 'flex',
				alignItems: 'center',
				gap: 0.5,
			}}
		>
			{value ? <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span> : <span style={{ opacity: 0.3 }}>+ comment...</span>}
			<Edit2 size={9} style={{ opacity: 0.3, marginLeft: 'auto' }} />
		</Box>
	);
}

// ── Node Preview ─────────────────────────────────────────────────────────────

interface NodePreviewProps {
	uiJson: UiJsonData;
	onChange: (uiJson: UiJsonData) => void;
	selectedId: string | null;
	onSelectProperty: (id: string | null) => void;
	dropRef: ReturnType<typeof useDroppable>['setNodeRef'];
	isOverDrop: boolean;
}

export const NodePreview = memo(function NodePreview({ uiJson, onChange, selectedId, onSelectProperty, dropRef, isOverDrop }: NodePreviewProps) {
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const gray20 = greyColor(20);
	const gray40 = greyColor(40);

	const data = uiJson.data;
	const props = data.properties;

	const setProperties = (newProps: UiPropertyData[]) => onChange({ ...uiJson, data: { ...data, properties: newProps } });

	const updateLabel = (label: string) => onChange({ ...uiJson, type: toCamelCase(label), data: { ...data, properties: [...props], label } });

	const nodeColor = (colorTypes[data.colorType] as string) ?? '#555';

	const validationErrors = validateUiJson(uiJson);
	const isValid = validationErrors.length === 0;

	return (
		<Box sx={{ flex: 1, overflow: 'auto', p: 2, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
			<Box sx={{ position: 'relative' }}>
				{/* Main node card */}
				<Box
					sx={{
						width: uiJson.width,
						border: `1px solid ${gray40}`,
						borderRadius: 1,
						overflow: 'hidden',
						bgcolor: gray20,
						boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
					}}
				>
					{/* Header */}
					<NodeHeader label={data.label} color={nodeColor} isValid={isValid} type={uiJson.type} onLabelChange={updateLabel} />

					{/* Properties drop zone */}
					<Box
						ref={dropRef}
						sx={{
							minHeight: 60,
							outline: isOverDrop ? '1px dashed' : 'none',
							outlineColor: 'primary.main',
							transition: 'outline 0.15s',
						}}
					>
						{props.map((prop) => (
							<SortablePropertyRow
								key={prop.id}
								property={prop}
								isSelected={selectedId === prop.id}
								isOutputSource={data.output?.sourceProperty === prop.id}
								onSelect={() => onSelectProperty(selectedId === prop.id ? null : prop.id)}
								onDelete={() => {
									setProperties(props.filter((p) => p.id !== prop.id));
									if (selectedId === prop.id) onSelectProperty(null);
								}}
							/>
						))}
						{props.length === 0 && (
							<Box sx={{ p: 2, textAlign: 'center', opacity: 0.3 }}>
								<Typography variant='caption' sx={{ fontSize: 11 }}>
									Перетащите компонент из панели справа
								</Typography>
							</Box>
						)}
					</Box>

					{/* Comment */}
					<NodeComment
						value={data.comment}
						onChange={(v) => onChange({ ...uiJson, data: { ...data, properties: [...props], comment: v } })}
					/>

					{/* Output handle */}
					<OutputHandleEditor
						sourceProperty={data.output?.sourceProperty}
						allPropertyIds={props.map((p) => p.id)}
						onChangeSource={(id) =>
							onChange({
								...uiJson,
								data: { ...data, properties: [...props], output: id ? { sourceProperty: id } : undefined },
							})
						}
					/>
				</Box>

				{/* Resize handle */}
				<NodeResize width={uiJson.width} height={uiJson.height} onChange={(w, h) => onChange({ ...uiJson, width: w, height: h })} />
			</Box>
		</Box>
	);
});
