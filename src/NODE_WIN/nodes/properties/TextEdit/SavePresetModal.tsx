import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { SavePresetModalProps } from './types';
import { loadIndex, saveIndex, savePresetText, generateId } from './presetUtils';

export function SavePresetModal({
	initialText,
	initialLanguage,
	editItem,
	onClose,
	onSaved,
	bgModal,
	bgHeader,
	borderColor,
	defColor,
}: SavePresetModalProps) {
	const [text, setText] = useState(initialText);
	const [name, setName] = useState(editItem?.name ?? '');
	const [description, setDescription] = useState(editItem?.description ?? '');
	const [saving, setSaving] = useState(false);
	const [nameError, setNameError] = useState(false);

	const inputStyle: React.CSSProperties = {
		width: '100%',
		boxSizing: 'border-box',
		padding: '6px 8px',
		borderRadius: 4,
		border: `1px solid ${borderColor}`,
		backgroundColor: bgModal,
		color: defColor,
		fontSize: 12,
		outline: 'none',
		resize: 'none',
		fontFamily: 'inherit',
	};

	const handleSave = async () => {
		if (!name.trim()) {
			setNameError(true);
			return;
		}
		setSaving(true);
		try {
			const index = await loadIndex();

			if (editItem) {
				const updated = index.map((item) =>
					item.id === editItem.id
						? { ...item, name: name.trim(), description: description.trim(), language: initialLanguage }
						: item,
				);
				await saveIndex(updated);
				await savePresetText(editItem.id, text);
			} else {
				const id = generateId();
				await saveIndex([
					...index,
					{ id, name: name.trim(), description: description.trim(), language: initialLanguage },
				]);
				await savePresetText(id, text);
			}

			onSaved();
			onClose();
		} catch (e) {
			console.error('Failed to save preset:', e);
		} finally {
			setSaving(false);
		}
	};

	return createPortal(
		<>
			<div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10001, backgroundColor: 'rgba(0,0,0,0.5)' }} />
			<div
				style={{
					position: 'fixed',
					top: '50%',
					left: '50%',
					transform: 'translate(-50%, -50%)',
					width: 720,
					height: 420,
					zIndex: 10002,
					display: 'flex',
					flexDirection: 'column',
					backgroundColor: bgModal,
					border: `1px solid ${borderColor}`,
					borderRadius: 6,
					overflow: 'hidden',
					boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
				}}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						padding: '0 12px',
						height: 38,
						flexShrink: 0,
						backgroundColor: bgHeader,
						borderBottom: `1px solid ${borderColor}`,
					}}
				>
					<span style={{ fontSize: 13, fontWeight: 500, color: defColor }}>
						{editItem ? 'Edit Preset' : 'Save Preset'}
					</span>
					<button
						onClick={onClose}
						style={{
							background: 'none',
							border: 'none',
							cursor: 'pointer',
							color: defColor,
							display: 'flex',
							alignItems: 'center',
							padding: 4,
						}}
					>
						<X size={14} />
					</button>
				</div>

				{/* Body */}
				<div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
					{/* Левая часть — текст */}
					<div
						style={{
							flex: 1,
							display: 'flex',
							flexDirection: 'column',
							padding: 12,
							borderRight: `1px solid ${borderColor}`,
						}}
					>
						<span style={{ fontSize: 11, color: defColor, marginBottom: 6, opacity: 0.6 }}>Text</span>
						<textarea
							value={text}
							onChange={(e) => setText(e.target.value)}
							style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: 11 }}
						/>
					</div>

					{/* Правая часть — название + описание */}
					<div style={{ width: 240, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
							<span style={{ fontSize: 11, color: defColor, opacity: 0.6 }}>
								Name <span style={{ color: '#e06c75' }}>*</span>
							</span>
							<input
								value={name}
								onChange={(e) => {
									setName(e.target.value);
									setNameError(false);
								}}
								placeholder='Preset name...'
								style={{ ...inputStyle, border: `1px solid ${nameError ? '#e06c75' : borderColor}` }}
							/>
							{nameError && <span style={{ fontSize: 10, color: '#e06c75' }}>Name is required</span>}
						</div>

						<div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
							<span style={{ fontSize: 11, color: defColor, opacity: 0.6 }}>Description</span>
							<textarea
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder='Optional description...'
								style={{ ...inputStyle, flex: 1 }}
							/>
						</div>

						<button
							onClick={handleSave}
							disabled={saving}
							style={{
								padding: '7px 0',
								borderRadius: 4,
								border: 'none',
								backgroundColor: saving ? '#555' : '#4a9eff',
								color: '#fff',
								fontSize: 12,
								cursor: saving ? 'not-allowed' : 'pointer',
								fontWeight: 500,
							}}
						>
							{saving ? 'Saving...' : editItem ? 'Update Preset' : 'Save Preset'}
						</button>
					</div>
				</div>
			</div>
		</>,
		document.body,
	);
}
