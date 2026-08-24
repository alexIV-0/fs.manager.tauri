// src/NODE_WIN/nodes/components/NodeEncodeSettings.tsx
//
// Попап «настройки кодирования» в шапке ноды (рядом с крестиком). Показывается только у
// нод, чьё свойство несёт блок `encode` — набор типов в `ENCODE_CONTROL_TYPES`.
//
// Почему в шапке, а не в окне превью: контейнер/кодек/CRF описывают ВЫХОД ноды, а превью
// показывает картинку — там эти поля только мешали. Значение по-прежнему лежит внутри JSON
// того же свойства (ключ `encode`), так что ни формат хранения, ни плагины не меняются.

import { memo, useCallback, useMemo } from 'react';
import { Settings2 } from 'lucide-react';
import { useNodesData } from '@xyflow/react';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useUpdateFlow } from '@/NODE_WIN/hooks/useUpdateFlow';
import { BARE_ENCODE_CONTROL_TYPE, CustomNodeData, ENCODE_CONTROL_TYPES, Property } from '@/NODE_WIN/definitions/types';
import { encodeProfile, parseEncodeSettings, type EncodeProfileId, type EncodeSettings } from '@/Utils/ffmpegCaps';
import { defaultVideoAdjustSettings } from '../properties/VideoAdjustEdit/types';
import { defaultKeyingSettings } from '../properties/KeyingEdit/types';
import { defaultOverlaySettings } from '../properties/OverlayEdit/types';
import { defaultTitleSettings } from '../properties/TitleEdit/types';
import EncodeSettingsPanel from '../properties/EncodeSettingsPanel';
import { GearPopover } from '../properties/GearPopover';

/**
 * Заготовка настроек по типу контрола — чтобы кодирование можно было задать ДО того, как
 * пользователь первый раз открыл окно настроек ноды (иначе в JSON не было бы остальных полей).
 */
const DEFAULT_SETTINGS: Record<string, () => Record<string, unknown>> = {
	videoAdjustment: defaultVideoAdjustSettings as unknown as () => Record<string, unknown>,
	keying: defaultKeyingSettings as unknown as () => Record<string, unknown>,
	overlaySettings: defaultOverlaySettings as unknown as () => Record<string, unknown>,
	titleSettings: defaultTitleSettings as unknown as () => Record<string, unknown>,
};

/**
 * Чем кодирует плагин, пока человек не открыл попап.
 *
 * Обязан совпадать с фолбэком в самом плагине (`settings.encode ?? encodeProfile(…)`) —
 * иначе попап показывает одно, а рендер делает другое, и это ровно тот баг, который
 * невозможно заметить: оба конца выглядят правильными по отдельности.
 */
const DEFAULT_PROFILE: Record<string, EncodeProfileId> = {
	videoAdjustment: 'standard',
	overlaySettings: 'standard',
	titleSettings: 'quality',
	keying: 'hapMov',
};

function NodeEncodeSettings({ textColor }: { textColor: string }) {
	const nodeId = useNodeContext();
	const node = useNodesData(nodeId) as { data: CustomNodeData } | null;
	const { updateNodeProperty } = useUpdateFlow();

	const property = useMemo(
		() => (node?.data.properties as Property[] | undefined)?.find((p) => ENCODE_CONTROL_TYPES.has(p.controlType)),
		[node?.data.properties],
	);

	const rawValue = (property?.controlProps as { value?: string } | undefined)?.value ?? '';

	const settings = useMemo<Record<string, unknown>>(() => {
		try {
			const parsed = rawValue ? JSON.parse(rawValue) : null;
			if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
		} catch {}
		return DEFAULT_SETTINGS[property?.controlType ?? '']?.() ?? {};
	}, [rawValue, property?.controlType]);

	// Нода без своего окна настроек: значение свойства — сами настройки кодирования.
	// Какой профиль считать дефолтом, объявляет `ui.json` плагина, а не карта в коде:
	// плагинов с этим свойством будет много, и держать их список здесь значит править
	// приложение ради каждого нового плагина.
	const isBare = property?.controlType === BARE_ENCODE_CONTROL_TYPE;
	const bareProfile = ((property?.controlProps as { profile?: string } | undefined)?.profile ?? 'standard') as EncodeProfileId;

	const encode = isBare
		? parseEncodeSettings(rawValue, bareProfile)
		: ((settings.encode as EncodeSettings | undefined) ??
			encodeProfile(DEFAULT_PROFILE[property?.controlType ?? ''] ?? 'standard'));

	const handleChange = useCallback(
		(next: EncodeSettings) => {
			if (!property) return;
			updateNodeProperty(nodeId, property.id, JSON.stringify(isBare ? next : { ...settings, encode: next }));
		},
		[nodeId, property, settings, isBare, updateNodeProperty],
	);

	if (!property) return null;

	return (
		<GearPopover
			tooltip={`Кодирование: ${encode.container.toUpperCase()} · ${encode.codec}${encode.alpha ? ' + alpha' : ''} · crf ${encode.crf}`}
			icon={<Settings2 size={16} strokeWidth={1.75} />}
			iconSx={{ color: textColor, mr: 0.25 }}
			caption='// настройки кодирования (выход ноды)'
		>
			<EncodeSettingsPanel value={encode} onChange={handleChange} />
		</GearPopover>
	);
}

export default memo(NodeEncodeSettings);
