// src/NODE_WIN/nodes/properties/EncodeSettingsPanel.tsx
//
// Переиспользуемая панель render-настроек (контейнер/кодек/preset/CRF/pix_fmt) на базе
// общего ffmpegCaps. Живёт в попапе «настройки кодирования» в шапке ноды (NodeEncodeSettings)
// — это настройка ВЫХОДА ноды, а не параметр картинки, поэтому в окне превью её нет.
// Аргументы ffmpeg по этим настройкам строит buildEncodeArgs.

import { MenuItem, Select } from '@mui/material';
import {
	EncodeSettings,
	VIDEO_PRESETS,
	VIDEO_CODECS,
	ENCODE_CONTAINERS,
	alphaAvailable,
	videoCodecsForContainer,
	pixFmtsFor,
	type VideoCodecId,
} from '@/Utils/ffmpegCaps';
import { CheckRow, GearHint, LabeledRow, NumBox, gearSelSx } from './GearPopover';

const CODEC_LABELS: Record<string, string> = {
	h264: 'H.264', h265: 'H.265', vp9: 'VP9', av1: 'AV1', prores: 'ProRes', dnxhd: 'DNxHD', hap: 'Hap', hap_q: 'Hap Q', copy: 'Copy',
};

export default function EncodeSettingsPanel({ value, onChange }: { value: EncodeSettings; onChange: (e: EncodeSettings) => void }) {
	// Плагины-композеры всегда перекодируют → 'copy' не предлагаем.
	const codecs: VideoCodecId[] = videoCodecsForContainer(value.container).filter((c) => c !== 'copy');
	const caps = VIDEO_CODECS[value.codec];
	// Альфа — не «ещё один pix_fmt», а отдельный вопрос: у ProRes это профиль 4444, у Hap —
	// `-format hap_alpha`, у VP9 — yuva420p. Поэтому тумблер, а список pix_fmt под него.
	const canAlpha = alphaAvailable(value.container, value.codec);
	const wantAlpha = canAlpha && Boolean(value.alpha);
	const pixFmts = pixFmtsFor(value.codec, wantAlpha);
	const selSx = { ...gearSelSx, minWidth: 150 };

	return (
		<>
			<LabeledRow label='container'>
				<Select
					size='small'
					value={value.container}
					onChange={(e) => {
						const c = e.target.value;
						const cs: VideoCodecId[] = videoCodecsForContainer(c).filter((x) => x !== 'copy');
						onChange({ ...value, container: c, codec: cs.includes(value.codec) ? value.codec : (cs[0] ?? 'h264') });
					}}
					sx={selSx}
				>
					{ENCODE_CONTAINERS.map((c) => (
						<MenuItem key={c} value={c}>
							{c === 'original' ? 'original (как у источника)' : c.toUpperCase()}
						</MenuItem>
					))}
				</Select>
			</LabeledRow>

			<LabeledRow label='codec'>
				<Select
					size='small'
					value={value.codec}
					onChange={(e) => onChange({ ...value, codec: e.target.value as VideoCodecId })}
					sx={selSx}
				>
					{codecs.map((c) => (
						<MenuItem key={c} value={c}>
							{CODEC_LABELS[c] ?? c}
						</MenuItem>
					))}
				</Select>
			</LabeledRow>

			{caps?.preset && (
				<LabeledRow label='preset'>
					<Select size='small' value={value.preset} onChange={(e) => onChange({ ...value, preset: e.target.value })} sx={selSx}>
						{VIDEO_PRESETS.map((p) => (
							<MenuItem key={p} value={p}>
								{p}
							</MenuItem>
						))}
					</Select>
				</LabeledRow>
			)}

			{caps?.quality === 'crf' && (
				<>
					<LabeledRow label='crf'>
						<NumBox value={value.crf} onChange={(v) => onChange({ ...value, crf: v })} integer min={0} max={51} />
					</LabeledRow>
					<GearHint>// 0 = lossless, 51 = worst</GearHint>
				</>
			)}

			{canAlpha && (
				<>
					<CheckRow
						label='alpha (прозрачность)'
						checked={wantAlpha}
						onChange={(v) => onChange({ ...value, alpha: v })}
					/>
					<GearHint>
						{value.codec === 'hap'
							? '// Hap Alpha; Hap Q альфу не несёт вовсе'
							: value.codec === 'prores'
								? '// ProRes 4444 (профиль 4444 вместо HQ)'
								: '// yuva420p'}
					</GearHint>
				</>
			)}

			{/* Hap Q альфы не несёт вовсе — без этой строки «где галочка alpha?» выясняется
			    только опытным путём, на уже отрендеренном файле. */}
			{value.codec === 'hap_q' && <GearHint>// Hap Q без альфы; нужна прозрачность → codec Hap</GearHint>}

			{pixFmts.length > 0 && (
				<LabeledRow label='pix_fmt'>
					<Select
						size='small'
						value={pixFmts.includes(value.pixFmt) ? value.pixFmt : pixFmts[0]}
						onChange={(e) => onChange({ ...value, pixFmt: e.target.value })}
						sx={selSx}
					>
						{pixFmts.map((p) => (
							<MenuItem key={p} value={p}>
								{p}
							</MenuItem>
						))}
					</Select>
				</LabeledRow>
			)}
		</>
	);
}
