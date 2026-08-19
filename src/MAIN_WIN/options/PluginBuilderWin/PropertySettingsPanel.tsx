import { useState, useEffect } from 'react';
import { Box, Button, Checkbox, Chip, FormControlLabel, IconButton, Stack, TextField, Typography } from '@mui/material';
import { NumInput } from '@/components/NumInput';
import { TimecodeInput } from '@/components/TimecodeInput';
import { X } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import type { UiPropertyData } from './types';
import { CONTROL_TYPE_COLORS, TEXT_EDIT_LANGUAGES, OUTPUT_TYPES } from './types';
import { ALL_ADDABLE_TYPES } from '@/NODE_WIN/definitions/types';
import { typeOfFile_store, typeOfdata_store } from '@/Store/MainWin/pathPattern_store';
import { OptionsPickerModal } from './OptionsPickerModal';
import { TooltipEditorModal } from './TooltipEditorModal';
import { CONVERT_THEMES } from '@/NODE_WIN/nodes/properties/ConvertEdit/convertThemes';
import { NUMERIC_FORMATS, numericConfigFor } from '@/Utils/numericFormat';

interface PropertySettingsPanelProps {
	property: UiPropertyData;
	outputSourceId?: string;
	allPropertyIds: string[];
	onChange: (p: UiPropertyData) => void;
	onClose: () => void;
}

/** Compact JSON-style field row */
function JsonField({ label, children }: { label: string; children: React.ReactNode }) {
	const gray60 = greyColor(60);
	return (
		<Stack direction='row' gap={0} alignItems='flex-start' sx={{ py: 0.2, px: 0.5, '&:hover': { bgcolor: 'rgba(255,255,255,0.015)' } }}>
			<Box sx={{ width: 16, flexShrink: 0 }} />
			<Box
				component='span'
				sx={{
					color: '#89b4fa',
					fontFamily: 'monospace',
					fontSize: 13,
					minWidth: 120,
					textAlign: 'right',
					mr: 0.5,
					pt: 0.3,
				}}
			>
				"{label}"
			</Box>
			<Box component='span' sx={{ color: gray60, fontFamily: 'monospace', fontSize: 13, mx: 0.5, pt: 0.3 }}>
				:
			</Box>
			<Box sx={{ ml: 1, flex: 1, minWidth: 0 }}>{children}</Box>
		</Stack>
	);
}

/** String value in quotes, green */
function JsonString({ value, placeholder }: { value: string; placeholder?: string }) {
	return value ? (
		<Box component='span' sx={{ color: '#a6e3a1', fontFamily: 'monospace', fontSize: 13 }}>
			<span style={{ color: '#a6e3a1' }}>"</span>
			{value}
			<span style={{ color: '#a6e3a1' }}>"</span>
		</Box>
	) : (
		<Box component='span' sx={{ color: greyColor(60), fontFamily: 'monospace', fontSize: 13, fontStyle: 'italic' }}>
			{placeholder ?? '""'}
		</Box>
	);
}

export function PropertySettingsPanel({ property, outputSourceId, allPropertyIds, onChange, onClose }: PropertySettingsPanelProps) {
	const gray40 = greyColor(40);
	const typeColor = CONTROL_TYPE_COLORS[property.controlType] ?? '#aaa';

	const cp = { ...property.controlProps };
	const setCp = (key: string, value: unknown) => onChange({ ...property, controlProps: { ...cp, [key]: value } });
	const setProp = (key: keyof UiPropertyData, value: unknown) => onChange({ ...property, [key]: value });

	const isOutputSource = property.id === outputSourceId;
	const isCheckbox = property.controlType === 'checkbox';

	// Modals
	const [optionsModalOpen, setOptionsModalOpen] = useState(false);
	const [acceptedModalOpen, setAcceptedModalOpen] = useState(false);
	const [tooltipModalOpen, setTooltipModalOpen] = useState(false);
	const [outputTypeModalOpen, setOutputTypeModalOpen] = useState(false);
	const [languageModalOpen, setLanguageModalOpen] = useState(false);

	// Inline input style
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

	const selStyle: React.CSSProperties = {
		background: 'transparent',
		border: `1px solid ${gray40}`,
		outline: 'none',
		color: '#cdd6f4',
		fontFamily: 'monospace',
		fontSize: 13,
		padding: '2px 4px',
		borderRadius: 4,
	};

	// Числовые контролы (slider/valueRange): формат решает, какие поля показывать
	// и чем вводить границы — таймкодом HH:MM:SS или числом.
	const numCfg = numericConfigFor(property.controlType, cp);
	const isTimecode = numCfg.format === 'timecode';
	const numFormatSelect = (
		<JsonField label='format'>
			<select value={numCfg.format} onChange={(e) => setCp('format', e.target.value)} style={selStyle}>
				{NUMERIC_FORMATS.map((f) => (
					<option key={f} value={f} style={{ background: '#1e1e2e', color: '#cdd6f4' }}>
						{f}
					</option>
				))}
			</select>
		</JsonField>
	);
	const numDecimals =
		numCfg.format === 'float' ? (
			<JsonField label='decimals'>
				<NumInput value={numCfg.decimals} onChange={(v) => setCp('decimals', v)} style={inp(40, '#fab387')} integer />
			</JsonField>
		) : null;
	const numStep = (
		<JsonField label='step'>
			<Stack direction='row' alignItems='center' gap={0.5}>
				<NumInput value={numCfg.step} onChange={(v) => setCp('step', v)} style={inp(60, '#fab387')} />
				{isTimecode && (
					<Box component='span' sx={{ color: greyColor(50), fontFamily: 'monospace', fontSize: 10, fontStyle: 'italic' }}>
						в секундах
					</Box>
				)}
			</Stack>
		</JsonField>
	);
	const numOverride = (
		<JsonField label='allowManualOverride'>
			<Checkbox size='small' checked={numCfg.allowManualOverride} onChange={(e) => setCp('allowManualOverride', e.target.checked)} sx={{ py: 0 }} />
		</JsonField>
	);
	/** Ввод одной границы/значения: таймкод HH:MM:SS либо число. */
	const numBound = (value: number, onChange: (v: number) => void, w = 70) =>
		isTimecode ? (
			<TimecodeInput value={value} onChange={onChange} min={0} style={inp(w + 20, '#fab387')} />
		) : (
			<NumInput value={value} onChange={onChange} style={inp(w, '#fab387')} />
		);

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			{/* Header */}
			<Stack
				direction='row'
				justifyContent='space-between'
				alignItems='center'
				sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${gray40}`, flexShrink: 0 }}
			>
				<Stack direction='row' gap={0.75} alignItems='center'>
					<Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: typeColor, flexShrink: 0 }} />
					<Box component='span' sx={{ color: typeColor, fontFamily: 'monospace', fontSize: 11 }}>
						{property.controlType}
					</Box>
				</Stack>
				<IconButton size='small' onClick={onClose} sx={{ p: 0.25 }}>
					<X size={14} />
				</IconButton>
			</Stack>

			{/* JSON fields */}
			<Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
				{/* id */}
				<JsonField label='id'>
					<input value={property.id} onChange={(e) => setProp('id', e.target.value.replace(/\s/g, ''))} style={inp(140, '#cdd6f4')} />
				</JsonField>

				{/* controlType */}
				<JsonField label='controlType'>
					<Box component='span' sx={{ color: typeColor, fontFamily: 'monospace', fontSize: 13 }}>
						"{property.controlType}"
					</Box>
				</JsonField>

				{/* label */}
				<JsonField label='label'>
					<input value={cp.label ?? ''} onChange={(e) => setCp('label', e.target.value)} style={inp(160, '#cdd6f4')} />
				</JsonField>

				{/* tooltip — modal */}
				<JsonField label='tooltip'>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
						<Box onClick={() => setTooltipModalOpen(true)} sx={{ cursor: 'pointer', '&:hover': { opacity: 0.8 } }}>
							{cp.tooltip ? (
								<JsonString value={cp.tooltip.slice(0, 30) + (cp.tooltip.length > 30 ? '...' : '')} />
							) : (
								<JsonString value='' placeholder='редактировать...' />
							)}
						</Box>
						<Button size='small' onClick={() => setTooltipModalOpen(true)} sx={{ minWidth: 20, p: 0.25, color: '#cdd6f4', fontSize: 11 }}>
							✎
						</Button>
					</Box>
				</JsonField>

				{/* required */}
				<JsonField label='required'>
					<Checkbox size='small' checked={!!property.required} onChange={(e) => setProp('required', e.target.checked)} sx={{ py: 0 }} />
				</JsonField>

				{/* isInput */}
				<JsonField label='isInput'>
					<Checkbox size='small' checked={!!property.isInput} onChange={(e) => setProp('isInput', e.target.checked)} sx={{ py: 0 }} />
				</JsonField>

				{/* acceptedTypes — modal */}
				{property.isInput && (
					<JsonField label='acceptedTypes'>
						<Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
							<Box
								onClick={() => setAcceptedModalOpen(true)}
								sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.3, cursor: 'pointer', flex: 1, '&:hover': { opacity: 0.8 } }}
							>
								{(property.acceptedTypes ?? []).length === 0 ? (
									<Box component='span' sx={{ color: greyColor(50), fontFamily: 'monospace', fontSize: 12, fontStyle: 'italic' }}>
										не задан
									</Box>
								) : (
									(property.acceptedTypes ?? []).map((t: string) => (
										<Box
											key={t}
											component='span'
											sx={{
												color: '#a6e3a1',
												fontFamily: 'monospace',
												fontSize: 11,
												bgcolor: 'rgba(166,227,161,0.12)',
												px: 0.5,
												py: 0.15,
												borderRadius: 0.5,
												border: '1px solid rgba(166,227,161,0.3)',
											}}
										>
											{t}
										</Box>
									))
								)}
							</Box>
							<Button
								size='small'
								onClick={() => setAcceptedModalOpen(true)}
								sx={{ minWidth: 20, p: 0.25, color: '#cdd6f4', fontSize: 11, flexShrink: 0 }}
							>
								✎
							</Button>
						</Box>
					</JsonField>
				)}

				{/* outputType — ONLY for the output source property */}
				{isOutputSource && (
					<JsonField label='outputType'>
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
							<Box onClick={() => setOutputTypeModalOpen(true)} sx={{ cursor: 'pointer', '&:hover': { opacity: 0.8 } }}>
								<Box
									component='span'
									sx={{
										fontSize: 13,
										fontFamily: 'monospace',
										color: '#fab387',
										bgcolor: greyColor(20),
										px: 0.5,
										py: 0.25,
										borderRadius: 0.5,
									}}
								>
									"{property.outputType ?? 'string'}"
								</Box>
							</Box>
							<Button
								size='small'
								onClick={() => setOutputTypeModalOpen(true)}
								sx={{ minWidth: 20, p: 0.25, color: '#cdd6f4', fontSize: 11 }}
							>
								✎
							</Button>
						</Box>
					</JsonField>
				)}

				{/* outputTypeMap — ONLY for checkbox */}
				{isCheckbox && (
					<JsonField label='outputTypeMap'>
						{property.outputTypeMap ? (
							<Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
								{Object.entries(property.outputTypeMap).map(([k, v]) => (
									<Stack key={k} direction='row' alignItems='center' gap={0.5}>
										<Box component='span' sx={{ color: '#89b4fa', fontFamily: 'monospace', fontSize: 11 }}>
											{k}
										</Box>
										<Box component='span' sx={{ color: gray40 }}>
											:
										</Box>
										<input
											value={v}
											onChange={(e) => setProp('outputTypeMap', { ...property.outputTypeMap!, [k]: e.target.value })}
											style={inp(80, '#cdd6f4')}
										/>
									</Stack>
								))}
							</Box>
						) : (
							<Checkbox
								size='small'
								checked={false}
								onChange={(e) => setProp('outputTypeMap', e.target.checked ? { true: 'text', false: 'string' } : undefined)}
								sx={{ py: 0 }}
							/>
						)}
					</JsonField>
				)}

				{/* ── addLink: allowedTypes ── */}
				{property.controlType === 'addLink' && (
					<>
						<Box sx={{ borderTop: `1px solid ${gray40}`, mt: 0.5, pt: 0.5 }}>
							<Box sx={{ px: 0.5, py: 0.25 }}>
								<Box component='span' sx={{ color: greyColor(60), fontFamily: 'monospace', fontSize: 11, opacity: 0.7 }}>
									// addLink options
								</Box>
							</Box>
						</Box>
						<JsonField label='allowedTypes'>
							<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.35 }}>
								{ALL_ADDABLE_TYPES.map((type) => {
									const current = (cp.allowedTypes as string[] | undefined) ?? [];
									const isActive = current.length === 0 || current.includes(type);
									return (
										<Chip
											key={type}
											label={type}
											size='small'
											onClick={() => {
												const effective =
													current.length === 0 ? [...ALL_ADDABLE_TYPES] : [...current];
												const next = effective.includes(type)
													? effective.filter((t) => t !== type)
													: [...effective, type];
												if (next.length === 0) return;
												const value =
													next.length === ALL_ADDABLE_TYPES.length ? undefined : next;
												setCp('allowedTypes', value);
											}}
											sx={{
												fontSize: 10,
												cursor: 'pointer',
												bgcolor: isActive ? 'rgba(244,143,177,0.15)' : 'transparent',
												border: `1px solid ${isActive ? '#f48fb1' : gray40}`,
												color: isActive ? '#f48fb1' : undefined,
												'& .MuiChip-label': { px: 0.75 },
											}}
										/>
									);
								})}
							</Box>
						</JsonField>
					</>
				)}

			{/* ── controlType-specific ── */}
			{(property.controlType === 'autocomplete' ||
				property.controlType === 'ddm' ||
				property.controlType === 'slider' ||
				property.controlType === 'textedit' ||
				property.controlType === 'jsonNavigator' ||
				property.controlType === 'checkbox' ||
				property.controlType === 'link' ||
				property.controlType === 'valueRange') && (
				<Box sx={{ borderTop: `1px solid ${gray40}`, mt: 0.5, pt: 0.5 }}>
					<Box sx={{ px: 0.5, py: 0.25 }}>
						<Box component='span' sx={{ color: greyColor(60), fontFamily: 'monospace', fontSize: 11, opacity: 0.7 }}>
							// {property.controlType} options
						</Box>
					</Box>
				</Box>
			)}

				{property.controlType === 'autocomplete' && (
					<>
						<JsonField label='options'>
							<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
								<Box
									onClick={() => setOptionsModalOpen(true)}
									sx={{ display: 'flex', alignItems: 'center', gap: 0.25, cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
								>
									<Box component='span' sx={{ color: '#cdd6f4', fontFamily: 'monospace', fontSize: 13 }}>
										{'['}
									</Box>
									{(cp.options ?? []).slice(0, 3).map((o: string, i: number) => (
										<Box key={o}>
											<Box component='span' sx={{ color: '#a6e3a1', fontFamily: 'monospace', fontSize: 13 }}>
												"{o}"
											</Box>
											{i < Math.min((cp.options ?? []).length, 3) - 1 && (
												<Box component='span' sx={{ color: '#cdd6f4', fontFamily: 'monospace', fontSize: 13 }}>
													,{' '}
												</Box>
											)}
										</Box>
									))}
									{(cp.options ?? []).length > 3 && (
										<Box component='span' sx={{ color: greyColor(60), fontFamily: 'monospace', fontSize: 12 }}>
											... +{(cp.options ?? []).length - 3}
										</Box>
									)}
									<Box component='span' sx={{ color: '#cdd6f4', fontFamily: 'monospace', fontSize: 13 }}>
										{']'}
									</Box>
								</Box>
								<Button
									size='small'
									onClick={() => setOptionsModalOpen(true)}
									sx={{ minWidth: 20, p: 0.25, color: '#cdd6f4', fontSize: 11 }}
								>
									✎
								</Button>
							</Box>
						</JsonField>
						<JsonField label='multiSelect'>
							<Checkbox
								size='small'
								checked={!!cp.multiSelect}
								onChange={(e) => setCp('multiSelect', e.target.checked)}
								sx={{ py: 0 }}
							/>
						</JsonField>
						<JsonField label='allowDuplicates'>
							<Checkbox
								size='small'
								checked={!!cp.allowDuplicates}
								onChange={(e) => setCp('allowDuplicates', e.target.checked)}
								sx={{ py: 0 }}
							/>
						</JsonField>
						<JsonField label='optionsOnly'>
							<Checkbox
								size='small'
								checked={!!cp.optionsOnly}
								onChange={(e) => setCp('optionsOnly', e.target.checked)}
								sx={{ py: 0 }}
							/>
						</JsonField>
					</>
				)}

				{property.controlType === 'ddm' && (
					<>
						<JsonField label='options'>
							<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.35, mb: 0.5 }}>
								{(cp.options ?? []).map((o: string) => (
									<Chip
										key={o}
										label={o}
										size='small'
										color={cp.value === o ? 'primary' : 'default'}
										onClick={() => setCp('value', o)}
										onDelete={() =>
											setCp(
												'options',
												(cp.options ?? []).filter((x: string) => x !== o),
											)
										}
										sx={{ fontSize: 10, cursor: 'pointer', '& .MuiChip-label': { px: 0.5 } }}
									/>
								))}
							</Box>
							<DdmAddChip cp={cp} setCp={setCp} />
						</JsonField>
						<JsonField label='freeInput'>
							<Checkbox size='small' checked={!!cp.freeInput} onChange={(e) => setCp('freeInput', e.target.checked)} sx={{ py: 0 }} />
						</JsonField>
					</>
				)}

				{property.controlType === 'checkbox' && (
					<JsonField label='value'>
						<Checkbox size='small' checked={!!cp.value} onChange={(e) => setCp('value', e.target.checked)} sx={{ py: 0 }} />
					</JsonField>
				)}

				{property.controlType === 'slider' && (
					<>
						{numFormatSelect}
						<JsonField label='minValue'>{numBound(numCfg.min, (v) => setCp('minValue', v), 60)}</JsonField>
						<JsonField label='maxValue'>{numBound(numCfg.max, (v) => setCp('maxValue', v), 60)}</JsonField>
						{numStep}
						{numDecimals}
						<JsonField label='value'>{numBound(cp.value ?? 50, (v) => setCp('value', v), 60)}</JsonField>
						<JsonField label='isTextInput'>
							<Checkbox
								size='small'
								checked={!!cp.isTextInput}
								onChange={(e) => setCp('isTextInput', e.target.checked)}
								sx={{ py: 0 }}
							/>
						</JsonField>
						<JsonField label='minMaxValueVisible'>
							<Checkbox
								size='small'
								checked={!!cp.minMaxValueVisible}
								onChange={(e) => setCp('minMaxValueVisible', e.target.checked)}
								sx={{ py: 0 }}
							/>
						</JsonField>
						{numOverride}
					</>
				)}

				{property.controlType === 'textedit' && (
					<JsonField label='language'>
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
							<Box onClick={() => setLanguageModalOpen(true)} sx={{ cursor: 'pointer', '&:hover': { opacity: 0.8 } }}>
								<Box
									component='span'
									sx={{
										fontSize: 13,
										fontFamily: 'monospace',
										color: '#a6e3a1',
										bgcolor: greyColor(20),
										px: 0.5,
										py: 0.25,
										borderRadius: 0.5,
									}}
								>
									"{cp.language ?? 'plaintext'}"
								</Box>
							</Box>
							<Button
								size='small'
								onClick={() => setLanguageModalOpen(true)}
								sx={{ minWidth: 20, p: 0.25, color: '#cdd6f4', fontSize: 11 }}
							>
								✎
							</Button>
						</Box>
					</JsonField>
				)}

				{property.controlType === 'jsonNavigator' && (
					<JsonField label='jsonSourcePropertyId'>
						<select
							value={cp.jsonSourcePropertyId ?? ''}
							onChange={(e) => setCp('jsonSourcePropertyId', e.target.value)}
							style={{
								background: 'transparent',
								border: `1px solid ${gray40}`,
								outline: 'none',
								color: '#cdd6f4',
								fontFamily: 'monospace',
								fontSize: 13,
								padding: '2px 18px 2px 4px',
								borderRadius: 4,
								appearance: 'none',
								WebkitAppearance: 'none',
								cursor: 'pointer',
								backgroundImage: "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23888'/%3E%3C%2Fsvg%3E\")",
								backgroundRepeat: 'no-repeat',
								backgroundPosition: 'right 4px center',
							}}
						>
							<option value='' style={{ background: '#1e1e2e', color: '#cdd6f4' }}>
								— не выбран —
							</option>
							{allPropertyIds
								.filter((id) => id !== property.id)
								.map((id) => (
									<option key={id} value={id} style={{ background: '#1e1e2e', color: '#cdd6f4' }}>
										{id}
									</option>
								))}
						</select>
					</JsonField>
				)}

			{property.controlType === 'convertSettings' && (
					<>
						<Box sx={{ borderTop: `1px solid ${gray40}`, mt: 0.5, pt: 0.5 }}>
							<Box sx={{ px: 0.5, py: 0.25 }}>
								<Box component='span' sx={{ color: greyColor(60), fontFamily: 'monospace', fontSize: 11, opacity: 0.7 }}>
									// convertSettings options
								</Box>
							</Box>
						</Box>
						<JsonField label='theme'>
							<select
								value={(cp.theme as string) ?? 'full'}
								onChange={(e) => setCp('theme', e.target.value)}
								style={{
									background: 'transparent',
									border: `1px solid ${gray40}`,
									outline: 'none',
									color: '#cdd6f4',
									fontFamily: 'monospace',
									fontSize: 13,
									padding: '2px 4px',
									borderRadius: 4,
								}}
							>
								{CONVERT_THEMES.map((t) => (
									<option key={t.id} value={t.id} style={{ background: '#1e1e2e', color: '#cdd6f4' }}>
										{t.label}
									</option>
								))}
							</select>
						</JsonField>
					</>
				)}

				{property.controlType === 'link' && (
				<JsonField label='outputMarker'>
					<Stack direction='row' alignItems='center' gap={0.5}>
						<input
							value={property.outputMarker ?? ''}
							onChange={(e) => setProp('outputMarker', e.target.value || undefined)}
							placeholder='не задан'
							style={inp(120, '#f5c2e7')}
						/>
						<Box component='span' sx={{ color: greyColor(50), fontFamily: 'monospace', fontSize: 10, fontStyle: 'italic' }}>
							показывать в downstream нодах
						</Box>
					</Stack>
				</JsonField>
			)}

			{property.controlType === 'valueRange' && (
				<>
					<Box sx={{ borderTop: `1px solid ${gray40}`, mt: 0.5, pt: 0.5 }}>
						<Box sx={{ px: 0.5, py: 0.25 }}>
							<Box component='span' sx={{ color: greyColor(60), fontFamily: 'monospace', fontSize: 11, opacity: 0.7 }}>
								// valueRange options
							</Box>
						</Box>
					</Box>
					{numFormatSelect}
					{numStep}
					<JsonField label='range'>
						<Stack direction='row' gap={0.5} alignItems='center'>
							{numBound(numCfg.min, (v) => setCp('range', [v, numCfg.max]), 50)}
							<Box component='span' sx={{ color: gray40, fontFamily: 'monospace', fontSize: 13, pt: 0.3 }}>
								…
							</Box>
							{numBound(numCfg.max, (v) => setCp('range', [numCfg.min, v]), 50)}
						</Stack>
					</JsonField>
					{numDecimals}
					{numOverride}
				</>
			)}
		</Box>

		{/* Modals */}
			<OptionsPickerModal
				open={optionsModalOpen}
				title='Выбор опций для Autocomplete'
				currentOptions={cp.options ?? []}
				onClose={() => setOptionsModalOpen(false)}
				onApply={(opts) => setCp('options', opts)}
			/>
			<AcceptedTypesModal
				open={acceptedModalOpen}
				currentTypes={property.acceptedTypes ?? []}
				onClose={() => setAcceptedModalOpen(false)}
				onApply={(types) => setProp('acceptedTypes', types)}
			/>
			<TooltipEditorModal
				open={tooltipModalOpen}
				value={cp.tooltip ?? ''}
				onClose={() => setTooltipModalOpen(false)}
				onChange={(v) => setCp('tooltip', v)}
			/>
			<OutputTypePickerModal
				open={outputTypeModalOpen}
				current={property.outputType ?? 'string'}
				onClose={() => setOutputTypeModalOpen(false)}
				onSelect={(t) => {
					setProp('outputType', t);
					setOutputTypeModalOpen(false);
				}}
			/>
			<PickerModal
				open={languageModalOpen}
				title='language:'
				items={TEXT_EDIT_LANGUAGES}
				current={cp.language ?? 'plaintext'}
				color='#a6e3a1'
				onClose={() => setLanguageModalOpen(false)}
				onSelect={(t) => {
					setCp('language', t);
					setLanguageModalOpen(false);
				}}
			/>
		</Box>
	);
}

// ── DDM add chip ─────────────────────────────────────────────────────────────

function DdmAddChip({ cp, setCp }: { cp: Record<string, unknown>; setCp: (k: string, v: unknown) => void }) {
	const [input, setInput] = useState('');
	const gray40 = greyColor(40);

	return (
		<Stack direction='row' gap={0.5} sx={{ mt: 0.5 }}>
			<input
				value={input}
				onChange={(e) => setInput(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && input.trim()) {
						setCp('options', [...((cp.options as string[]) ?? []), input.trim()]);
						setInput('');
					}
				}}
				placeholder='...'
				style={{
					flex: 1,
					background: 'transparent',
					border: `1px solid ${gray40}`,
					borderRadius: 4,
					padding: '2px 6px',
					color: '#cdd6f4',
					fontSize: 11,
					fontFamily: 'monospace',
					outline: 'none',
				}}
			/>
			<Button
				size='small'
				onClick={() => {
					if (input.trim()) {
						setCp('options', [...((cp.options as string[]) ?? []), input.trim()]);
						setInput('');
					}
				}}
				sx={{ minWidth: 20, p: 0.25, fontSize: 14 }}
			>
				+
			</Button>
		</Stack>
	);
}

// ── Accepted Types Modal ─────────────────────────────────────────────────────

function AcceptedTypesModal({
	open,
	currentTypes,
	onClose,
	onApply,
}: {
	open: boolean;
	currentTypes: string[];
	onClose: () => void;
	onApply: (types: string[]) => void;
}) {
	const [selected, setSelected] = useState<string[]>(currentTypes);
	const gray40 = greyColor(40);
	const gray60 = greyColor(60);

	useEffect(() => {
		if (open) setSelected(currentTypes);
	}, [open]);

	// File types — from user store (video, audio, image, scripts, etc.)
	const fileTypes = typeOfFile_store((s) => s.patternStore);
	// Special data types — from user store (folders, files, path, timecode, string)
	const dataTypes = typeOfdata_store((s) => s.patternStore);
	// Dynamic/logic types — built-in, not file-based
	const dynamicTypes = ['array', 'boolean', 'typeByExtension', 'accepted'];

	const toggle = (t: string) => setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

	const renderGroup = (label: string, items: { name: string; color?: string | null }[]) => (
		<Box sx={{ mb: 1.5 }}>
			<Typography variant='caption' sx={{ fontSize: 10, color: gray60, display: 'block', mb: 0.5 }}>
				{label}
			</Typography>
			<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
				{items.map(({ name, color }) => (
					<Chip
						key={name}
						label={name}
						size='small'
						onClick={() => toggle(name)}
						sx={{
							cursor: 'pointer',
							fontSize: 10,
							bgcolor: selected.includes(name) ? `${color ?? '#90caf9'}33` : 'transparent',
							border: `1px solid ${selected.includes(name) ? (color ?? '#90caf9') : gray40}`,
							color: selected.includes(name) ? (color ?? '#90caf9') : undefined,
						}}
					/>
				))}
			</Box>
		</Box>
	);

	return (
		<Box sx={{ display: open ? 'block' : 'none', position: 'fixed', inset: 0, bgcolor: 'rgba(0,0,0,0.5)', zIndex: 9999 }} onClick={onClose}>
			<Box
				sx={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: 'translate(-50%, -50%)',
					bgcolor: greyColor(15),
					border: `1px solid ${gray40}`,
					borderRadius: 2,
					p: 2,
					minWidth: 360,
					maxWidth: 500,
				}}
				onClick={(e) => e.stopPropagation()}
			>
				<Typography variant='caption' fontWeight={600} sx={{ fontSize: 12, mb: 1.5, display: 'block' }}>
					Accepted Types:
				</Typography>
				{renderGroup('Типы файлов (из настроек)', fileTypes)}
				{renderGroup('Специальные типы данных (из настроек)', dataTypes)}
				{renderGroup(
					'Динамические типы',
					dynamicTypes.map((t) => ({ name: t, color: null as null })),
				)}
				<Stack direction='row' justifyContent='flex-end' gap={0.5}>
					<Button size='small' onClick={onClose}>
						Отмена
					</Button>
					<Button
						size='small'
						variant='contained'
						onClick={() => {
							onApply(selected);
							onClose();
						}}
					>
						Применить
					</Button>
				</Stack>
			</Box>
		</Box>
	);
}

// ── Generic single-value picker modal ────────────────────────────────────────

function PickerModal({
	open,
	title,
	items,
	current,
	color = '#fab387',
	onClose,
	onSelect,
}: {
	open: boolean;
	title: string;
	items: string[];
	current: string;
	color?: string;
	onClose: () => void;
	onSelect: (t: string) => void;
}) {
	const gray40 = greyColor(40);

	return (
		<Box sx={{ display: open ? 'block' : 'none', position: 'fixed', inset: 0, bgcolor: 'rgba(0,0,0,0.5)', zIndex: 9999 }} onClick={onClose}>
			<Box
				sx={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: 'translate(-50%, -50%)',
					bgcolor: greyColor(15),
					border: `1px solid ${gray40}`,
					borderRadius: 2,
					p: 2,
					minWidth: 280,
				}}
				onClick={(e) => e.stopPropagation()}
			>
				<Typography variant='caption' fontWeight={600} sx={{ fontSize: 12, mb: 1.5, display: 'block' }}>
					{title}
				</Typography>
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
					{items.map((t) => (
						<Box
							key={t}
							onClick={() => onSelect(t)}
							sx={{
								px: 1.5,
								py: 0.6,
								cursor: 'pointer',
								borderRadius: 0.75,
								fontFamily: 'monospace',
								fontSize: 13,
								color: current === t ? color : '#cdd6f4',
								bgcolor: current === t ? `${color}18` : 'transparent',
								border: `1px solid ${current === t ? `${color}55` : gray40}`,
								'&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
							}}
						>
							{t}
						</Box>
					))}
				</Box>
			</Box>
		</Box>
	);
}

function OutputTypePickerModal(props: { open: boolean; current: string; onClose: () => void; onSelect: (t: string) => void }) {
	return <PickerModal {...props} title='outputType:' items={OUTPUT_TYPES} color='#fab387' />;
}
