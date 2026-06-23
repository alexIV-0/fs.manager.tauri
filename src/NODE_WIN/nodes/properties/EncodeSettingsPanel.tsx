// src/NODE_WIN/nodes/properties/EncodeSettingsPanel.tsx
//
// Переиспользуемая панель render-настроек (контейнер/кодек/preset/CRF/pix_fmt) на базе
// общего ffmpegCaps. Встраивается в редакторы плагинов, которым нужно дать выбор энкода
// вместо зашитых аргументов (ffSwitch, overlay, merge…). Аргументы строит buildEncodeArgs.

import type { CSSProperties } from 'react';
import { greyColor } from '@/Store/Color/grayColor';
import PanelSlider from './PanelSlider';
import {
	EncodeSettings,
	VIDEO_PRESETS,
	VIDEO_CODECS,
	ENCODE_CONTAINERS,
	videoCodecsForContainer,
	pixFmtsFor,
	type VideoCodecId,
} from '@/Utils/ffmpegCaps';

const CODEC_LABELS: Record<string, string> = {
	h264: 'H.264', h265: 'H.265', vp9: 'VP9', av1: 'AV1', prores: 'ProRes', dnxhd: 'DNxHD', hap: 'Hap', hap_q: 'Hap Q', copy: 'Copy',
};

export default function EncodeSettingsPanel({ value, onChange }: { value: EncodeSettings; onChange: (e: EncodeSettings) => void }) {
	const label = greyColor(50);
	// Плагины-композеры всегда перекодируют → 'copy' не предлагаем.
	const codecs: VideoCodecId[] = videoCodecsForContainer(value.container).filter((c) => c !== 'copy');
	const caps = VIDEO_CODECS[value.codec];
	const pixFmts = pixFmtsFor(value.codec, false);

	const selStyle: CSSProperties = {
		flex: 1, minWidth: 0, background: greyColor(20), color: greyColor(85),
		border: `1px solid ${greyColor(30)}`, borderRadius: 3, fontSize: 11, padding: '3px 6px', outline: 'none',
	};
	const row = (lbl: string, ctrl: React.ReactNode) => (
		<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
			<span style={{ fontSize: 11, color: label, minWidth: 72, flexShrink: 0 }}>{lbl}</span>
			{ctrl}
		</div>
	);

	return (
		<div>
			{row('Container', (
				<select
					value={value.container}
					onChange={(e) => {
						const c = e.target.value;
						const cs: VideoCodecId[] = videoCodecsForContainer(c).filter((x) => x !== 'copy');
						onChange({ ...value, container: c, codec: cs.includes(value.codec) ? value.codec : (cs[0] ?? 'h264') });
					}}
					style={selStyle}
				>
					{ENCODE_CONTAINERS.map((c) => (
						<option key={c} value={c} style={{ background: '#1e1e2e' }}>{c === 'original' ? 'Original (как у источника)' : c.toUpperCase()}</option>
					))}
				</select>
			))}
			{row('Codec', (
				<select value={value.codec} onChange={(e) => onChange({ ...value, codec: e.target.value as VideoCodecId })} style={selStyle}>
					{codecs.map((c) => (
						<option key={c} value={c} style={{ background: '#1e1e2e' }}>{CODEC_LABELS[c] ?? c}</option>
					))}
				</select>
			))}
			{caps?.preset && row('Preset', (
				<select value={value.preset} onChange={(e) => onChange({ ...value, preset: e.target.value })} style={selStyle}>
					{VIDEO_PRESETS.map((p) => (
						<option key={p} value={p} style={{ background: '#1e1e2e' }}>{p}</option>
					))}
				</select>
			))}
			{caps?.quality === 'crf' && (
				<PanelSlider label='CRF (0=lossless, 51=worst)' value={value.crf} min={0} max={51} step={1} onChange={(v) => onChange({ ...value, crf: Math.round(v) })} />
			)}
			{pixFmts.length > 0 && row('Pixel fmt', (
				<select value={pixFmts.includes(value.pixFmt) ? value.pixFmt : pixFmts[0]} onChange={(e) => onChange({ ...value, pixFmt: e.target.value })} style={selStyle}>
					{pixFmts.map((p) => (
						<option key={p} value={p} style={{ background: '#1e1e2e' }}>{p}</option>
					))}
				</select>
			))}
		</div>
	);
}
