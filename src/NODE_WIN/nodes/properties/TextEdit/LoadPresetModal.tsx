import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Pencil } from 'lucide-react';
import { LoadPresetModalProps, PresetIndexItem } from './types';
import { loadIndex, saveIndex, loadPresetText, deletePresetFiles } from './presetUtils';
import { SavePresetModal } from './SavePresetModal';

export function LoadPresetModal({
	onClose,
	onLoad,
	bgModal,
	bgHeader,
	borderColor,
	defColor,
	currentLanguage,
}: LoadPresetModalProps) {
	const [index, setIndex] = useState<PresetIndexItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [editItem, setEditItem] = useState<PresetIndexItem | null>(null);
	const [editText, setEditText] = useState('');

	const theme = { bgModal, bgHeader, borderColor, defColor };

	useEffect(() => {
		loadIndex().then((items) => {
			setIndex(items);
			setLoading(false);
		});
	}, []);

	const handleLoad = async (item: PresetIndexItem) => {
		const text = await loadPresetText(item.id);
		onLoad(text);
		onClose();
	};

	const handleDelete = async (e: React.MouseEvent, item: PresetIndexItem) => {
		e.stopPropagation();
		const updated = index.filter((i) => i.id !== item.id);
		await saveIndex(updated);
		await deletePresetFiles(item.id);
		setIndex(updated);
	};

	const handleEditClick = async (e: React.MouseEvent, item: PresetIndexItem) => {
		e.stopPropagation();
		const text = await loadPresetText(item.id);
		setEditText(text);
		setEditItem(item);
	};

	const handleEditSaved = () => {
		loadIndex().then(setIndex);
		setEditItem(null);
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
					width: 480,
					maxHeight: 520,
					minHeight: 200,
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
					<span style={{ fontSize: 13, fontWeight: 500, color: defColor }}>Load Preset</span>
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

				{/* List */}
				<div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
					{loading && (
						<div style={{ padding: 16, color: defColor, opacity: 0.5, fontSize: 12, textAlign: 'center' }}>
							Loading...
						</div>
					)}
					{!loading && index.length === 0 && (
						<div style={{ padding: 16, color: defColor, opacity: 0.5, fontSize: 12, textAlign: 'center' }}>
							No presets saved yet
						</div>
					)}
					{!loading &&
						index.map((item) => (
							<div
								key={item.id}
								onClick={() => handleLoad(item)}
								onMouseEnter={() => setHoveredId(item.id)}
								onMouseLeave={() => setHoveredId(null)}
								title={item.description || undefined}
								style={{
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									padding: '8px 10px',
									borderRadius: 4,
									cursor: 'pointer',
									marginBottom: 2,
									backgroundColor: hoveredId === item.id ? 'rgba(255,255,255,0.06)' : 'transparent',
									border: `1px solid ${hoveredId === item.id ? borderColor : 'transparent'}`,
									transition: 'background-color 0.15s',
								}}
							>
								{/* Название + описание */}
								<div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
									<span
										style={{
											fontSize: 13,
											color: defColor,
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											whiteSpace: 'nowrap',
										}}
									>
										{item.name}
									</span>
									{item.description && (
										<span
											style={{
												fontSize: 10,
												color: defColor,
												opacity: 0.45,
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap',
											}}
										>
											{item.description}
										</span>
									)}
								</div>

								{/* Язык + кнопки при наведении */}
								<div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8, flexShrink: 0 }}>
									<span style={{ fontSize: 10, color: defColor, opacity: 0.35, marginRight: 4 }}>
										{item.language}
									</span>
									{hoveredId === item.id && (
										<>
											<button
												onClick={(e) => handleEditClick(e, item)}
												title='Edit preset'
												style={{
													background: 'none',
													border: 'none',
													cursor: 'pointer',
													color: defColor,
													opacity: 0.7,
													display: 'flex',
													alignItems: 'center',
													padding: 3,
													borderRadius: 3,
												}}
											>
												<Pencil size={13} />
											</button>
											<button
												onClick={(e) => handleDelete(e, item)}
												title='Delete preset'
												style={{
													background: 'none',
													border: 'none',
													cursor: 'pointer',
													color: '#e06c75',
													opacity: 0.7,
													display: 'flex',
													alignItems: 'center',
													padding: 3,
													borderRadius: 3,
												}}
											>
												<X size={13} />
											</button>
										</>
									)}
								</div>
							</div>
						))}
				</div>
			</div>

			{/* Модалка редактирования поверх */}
			{editItem && (
				<SavePresetModal
					initialText={editText}
					initialLanguage={editItem.language}
					editItem={editItem}
					onClose={() => setEditItem(null)}
					onSaved={handleEditSaved}
					{...theme}
				/>
			)}
		</>,
		document.body,
	);
}
