import { useState } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { Edit3, Plus } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import type { PluginJsonData } from './types';
import { COST_UNITS } from './types';
import { DescriptionEditorModal } from './DescriptionEditorModal';
import { NumInput } from '@/components/NumInput';

interface Tab1Props {
	data: PluginJsonData;
	onChange: (data: PluginJsonData) => void;
}

// Renders a single JSON key-value line
function JsonLine({ k, v, comma, children }: { k: string; v?: string | number; comma?: boolean; children?: React.ReactNode }) {
	const gray60 = greyColor(60);
	return (
		<Box sx={{ display: 'flex', alignItems: 'baseline', py: 0.15, px: 0.5, '&:hover': { bgcolor: 'rgba(255,255,255,0.015)' } }}>
			<Box sx={{ width: 16, flexShrink: 0 }} />
			<Box component='span' sx={{ color: '#89b4fa', fontFamily: 'monospace', fontSize: 13 }}>
				"{k}"
			</Box>
			<Box component='span' sx={{ color: gray60, fontFamily: 'monospace', fontSize: 13, mx: 0.5 }}>
				:
			</Box>
			<Box sx={{ ml: 1, flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
				{children ??
					(v !== undefined && v !== '' ? (
						typeof v === 'number' ? (
							<Box component='span' sx={{ color: '#fab387', fontFamily: 'monospace', fontSize: 13 }}>
								{v}
							</Box>
						) : (
							<Box>
								<Box component='span' sx={{ color: '#a6e3a1', fontFamily: 'monospace', fontSize: 13 }}>
									"
								</Box>
								<Box component='span' sx={{ color: '#cdd6f4', fontFamily: 'monospace', fontSize: 13 }}>
									{v}
								</Box>
								<Box component='span' sx={{ color: '#a6e3a1', fontFamily: 'monospace', fontSize: 13 }}>
									"
								</Box>
							</Box>
						)
					) : (
						<Box component='span' sx={{ color: gray60, fontFamily: 'monospace', fontSize: 12, fontStyle: 'italic' }}>
							""
						</Box>
					))}
			</Box>
			{comma !== false && (
				<Box component='span' sx={{ color: gray60, fontFamily: 'monospace', fontSize: 13 }}>
					,
				</Box>
			)}
		</Box>
	);
}

// Renders array items inline: ["item1", "item2"]
function InlineArray({ items, onEdit }: { items: string[]; onEdit: () => void }) {
	return (
		<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
			<Box component='span' sx={{ color: '#cdd6f4', fontFamily: 'monospace', fontSize: 13 }}>
				{'['}
			</Box>
			{items.flatMap((item, i) => [
				<Box key={item} component='span' sx={{ color: '#a6e3a1', fontFamily: 'monospace', fontSize: 13 }}>
					"{item}"
				</Box>,
				i < items.length - 1 ? (
					<Box key={`c${i}`} component='span' sx={{ color: '#cdd6f4', fontFamily: 'monospace', fontSize: 13 }}>
						,{' '}
					</Box>
				) : null,
			])}
			<Box component='span' sx={{ color: '#cdd6f4', fontFamily: 'monospace', fontSize: 13 }}>
				{']'}
			</Box>
			<Button size='small' onClick={onEdit} sx={{ minWidth: 20, p: 0.25, color: '#cdd6f4', fontSize: 12 }}>
				<Edit3 size={11} />
			</Button>
		</Box>
	);
}

export function Tab1PluginJson({ data, onChange }: Tab1Props) {
	const gray40 = greyColor(40);
	const [descModalOpen, setDescModalOpen] = useState(false);
	const [typeModalOpen, setTypeModalOpen] = useState(false);
	const [extModalOpen, setExtModalOpen] = useState(false);
	const [extInput, setExtInput] = useState('');
	const [typeInput, setTypeInput] = useState('');

	const set = (key: keyof PluginJsonData, value: unknown) => {
		if (key === 'id') {
			const autoMain = data.main === `${data.id}.js`;
			onChange({ ...data, id: value as string, main: autoMain ? `${value}.js` : data.main });
		} else {
			onChange({ ...data, [key]: value });
		}
	};

	const toggleType = (t: string) => {
		set('type', data.type.includes(t) ? data.type.filter((x) => x !== t) : [...data.type, t]);
	};

	// Shared input style
	const inp = (w: number, color: string) => ({
		background: 'transparent',
		border: 'none',
		outline: 'none',
		color,
		fontFamily: 'monospace',
		fontSize: 13,
		width: w,
		padding: '2px 4px',
	});

	return (
		<Box sx={{ p: 3, pl: 4 }}>
			<Box sx={{ width: '100%' }}>
				{/* Content */}
				<Box sx={{ p: 1 }}>
					<Box component='span' sx={{ color: '#cdd6f4', fontFamily: 'monospace', fontSize: 13 }}>
						{'{'}
					</Box>

					<JsonLine k='id'>
						<input value={data.id} onChange={(e) => set('id', e.target.value.replace(/\s/g, ''))} style={inp(180, '#cdd6f4')} />
					</JsonLine>

					<JsonLine k='name'>
						<input value={data.name} onChange={(e) => set('name', e.target.value)} style={inp(180, '#cdd6f4')} />
					</JsonLine>

					<JsonLine k='version'>
						<input value={data.version} onChange={(e) => set('version', e.target.value)} style={inp(60, '#fab387')} />
					</JsonLine>

					<JsonLine k='apiVersion'>
						<NumInput
							value={data.apiVersion}
							onChange={(v) => set('apiVersion', v)}
							integer
							style={inp(40, '#fab387')}
						/>
					</JsonLine>

					<Box sx={{ height: 6 }} />

					<JsonLine k='cost'>
						<input value={data.cost} onChange={(e) => set('cost', e.target.value)} style={inp(80, '#fab387')} />
					</JsonLine>

					<JsonLine k='costUnit'>
						<select
							value={data.costUnit}
							onChange={(e) => set('costUnit', e.target.value)}
							style={{
								...inp(90, '#a6e3a1'),
								appearance: 'none',
								WebkitAppearance: 'none',
								border: '1px solid rgba(166,227,161,0.3)',
								borderRadius: 3,
								padding: '2px 18px 2px 4px',
								cursor: 'pointer',
								backgroundImage: "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23a6e3a1'/%3E%3C%2Fsvg%3E\")",
								backgroundRepeat: 'no-repeat',
								backgroundPosition: 'right 4px center',
							}}
						>
							{COST_UNITS.map((u) => (
								<option key={u} value={u} style={{ background: '#1e1e2e', color: '#a6e3a1' }}>
									{u}
								</option>
							))}
						</select>
					</JsonLine>

					<Box sx={{ height: 6 }} />

					<JsonLine k='type' comma={false}>
						<InlineArray items={data.type} onEdit={() => setTypeModalOpen(true)} />
					</JsonLine>

					<JsonLine k='description'>
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1 }}>
							{data.description ? (
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
									<Box
										component='span'
										sx={{
											color: '#a6e3a1',
											fontFamily: 'monospace',
											fontSize: 12,
											maxWidth: 280,
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											whiteSpace: 'nowrap',
										}}
									>
										"{data.description.slice(0, 50)}
										{data.description.length > 50 ? '...' : ''}"
									</Box>
								</Box>
							) : (
								<Box component='span' sx={{ color: greyColor(60), fontFamily: 'monospace', fontSize: 12, fontStyle: 'italic' }}>
									""
								</Box>
							)}
							<Button
								size='small'
								onClick={() => setDescModalOpen(true)}
								sx={{ minWidth: 20, p: 0.25, color: '#cdd6f4', fontSize: 12 }}
							>
								<Edit3 size={11} />
							</Button>
						</Box>
					</JsonLine>

					<Box sx={{ height: 6 }} />

					<JsonLine k='main'>
						<input value={data.main} onChange={(e) => set('main', e.target.value)} style={inp(180, '#cdd6f4')} />
					</JsonLine>

					<JsonLine k='ui'>
						<input value={data.ui} onChange={(e) => set('ui', e.target.value)} style={inp(80, '#cdd6f4')} />
					</JsonLine>

					<Box sx={{ height: 6 }} />

					<JsonLine k='external' comma={false}>
						<InlineArray items={data.external} onEdit={() => setExtModalOpen(true)} />
					</JsonLine>

					<Box component='span' sx={{ color: '#cdd6f4', fontFamily: 'monospace', fontSize: 13 }}>
						{'}'}
					</Box>
				</Box>
			</Box>

			{/* Description modal */}
			<DescriptionEditorModal
				open={descModalOpen}
				value={data.description}
				onClose={() => setDescModalOpen(false)}
				onChange={(v) => set('description', v)}
			/>

			{/* Type modal */}
			<Dialog open={typeModalOpen} onClose={() => setTypeModalOpen(false)} maxWidth='xs' fullWidth>
				<DialogTitle sx={{ fontSize: 14, py: 1.5, pb: 1 }}>type: [...]</DialogTitle>
				<DialogContent sx={{ p: 2 }}>
					<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
						{data.type.map((t) => (
							<Chip
								key={t}
								label={t}
								color={data.type.includes(t) ? 'primary' : 'default'}
								onClick={() => toggleType(t)}
								sx={{ cursor: 'pointer' }}
							/>
						))}
					</Box>
					<Box sx={{ display: 'flex', gap: 0.5 }}>
						<input
							value={typeInput}
							onChange={(e) => setTypeInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && typeInput.trim()) {
									set('type', [...data.type, typeInput.trim()]);
									setTypeInput('');
								}
							}}
							placeholder='добавить тип...'
							style={{
								flex: 1,
								background: 'transparent',
								border: `1px solid ${greyColor(40)}`,
								borderRadius: 4,
								padding: '4px 8px',
								color: '#cdd6f4',
								fontSize: 12,
								fontFamily: 'monospace',
								outline: 'none',
							}}
						/>
						<Button
							size='small'
							onClick={() => {
								if (typeInput.trim()) {
									set('type', [...data.type, typeInput.trim()]);
									setTypeInput('');
								}
							}}
						>
							<Plus size={14} />
						</Button>
					</Box>
				</DialogContent>
				<DialogActions>
					<Button size='small' onClick={() => setTypeModalOpen(false)}>
						Закрыть
					</Button>
				</DialogActions>
			</Dialog>

			{/* External modal */}
			<Dialog open={extModalOpen} onClose={() => setExtModalOpen(false)} maxWidth='sm' fullWidth>
				<DialogTitle sx={{ fontSize: 14, py: 1.5, pb: 1 }}>external: [...]</DialogTitle>
				<DialogContent sx={{ p: 2 }}>
					<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
						{data.external.map((e) => (
							<Chip
								key={e}
								label={e}
								size='small'
								onDelete={() =>
									set(
										'external',
										data.external.filter((x) => x !== e),
									)
								}
							/>
						))}
						{data.external.length === 0 && (
							<Typography variant='caption' sx={{ opacity: 0.4 }}>
								пусто
							</Typography>
						)}
					</Box>
					<Box sx={{ display: 'flex', gap: 0.5 }}>
						<input
							value={extInput}
							onChange={(e) => setExtInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && extInput.trim()) {
									set('external', [...data.external, extInput.trim()]);
									setExtInput('');
								}
							}}
							placeholder='package-name'
							style={{
								flex: 1,
								background: 'transparent',
								border: `1px solid ${greyColor(40)}`,
								borderRadius: 4,
								padding: '4px 8px',
								color: '#cdd6f4',
								fontSize: 12,
								fontFamily: 'monospace',
								outline: 'none',
							}}
						/>
						<Button
							size='small'
							onClick={() => {
								if (extInput.trim()) {
									set('external', [...data.external, extInput.trim()]);
									setExtInput('');
								}
							}}
						>
							<Plus size={14} />
						</Button>
					</Box>
				</DialogContent>
				<DialogActions>
					<Button size='small' onClick={() => setExtModalOpen(false)}>
						Закрыть
					</Button>
				</DialogActions>
			</Dialog>
		</Box>
	);
}
