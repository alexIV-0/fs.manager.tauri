import { IconButton, Stack } from '@mui/material';
import { Trash2 } from 'lucide-react';
import MyToolTip from './CustomTooltip';
import EditableTooltip from './EditableTooltip';
import ExposeToSiteToggle from './ExposeToSiteToggle';
import DefaultSettingsGear from './DefaultSettingsGear';
import { EXPOSABLE_CONTROL_TYPES, GEAR_CONTROL_TYPES, Property } from '@/NODE_WIN/definitions/types';
import { greyColor, redColor } from '@/Store/Color/grayColor';

interface TooltipOrDeleteProps {
	isDynamic: boolean;
	tooltip?: string;
	onDelete: () => void;
	/** Свойство — нужно для галочки «на сайт» и шестерёнки дефолтных настроек. */
	property?: Property;
}

/**
 * Трейлинг-контролы строки свойства (правый край), слева направо:
 *   [шестерёнка дефолтных настроек?] [галочка «на сайт»?] [tooltip] [корзина?]
 *
 * - шестерёнка — только для controlType из GEAR_CONTROL_TYPES (числовые контролы);
 * - галочка «на сайт» — для ЛЮБОГО динамического свойства (рядом с корзиной) ИЛИ
 *   для простого статического контрола из EXPOSABLE_CONTROL_TYPES (рядом с tooltip),
 *   но НИКОГДА для `link` (коннект, а не значение);
 * - tooltip: у статического свойства — только чтение (текст пишет автор плагина
 *   в ui.json), у динамического — свой редактируемый (`EditableTooltip`);
 * - корзина — только у динамического свойства (isDynamic=true).
 *
 * Раньше динамическое свойство получало корзину ВМЕСТО tooltip, и своей
 * подсказки у него быть не могло. Теперь показываются оба.
 *
 * property необязателен: без него показывается только tooltip/корзина — как было раньше.
 */
export default function TooltipOrDelete({ isDynamic, tooltip = '', onDelete, property }: TooltipOrDeleteProps) {
	const controlType = property?.controlType ?? '';
	const showGear = !!property && GEAR_CONTROL_TYPES.has(controlType);
	// Линк — это коннект, а не значение: на сайте у него нечего править, поэтому
	// галочку «на сайт» он не получает даже будучи динамическим (решение 2026-06).
	const showExpose = !!property && controlType !== 'link' && (isDynamic || EXPOSABLE_CONTROL_TYPES.has(controlType));

	return (
		<Stack direction='row' alignItems='center' sx={{ ml: 'auto' }} className='nodrag'>
			{showGear && <DefaultSettingsGear property={property!} />}
			{showExpose && <ExposeToSiteToggle property={property!} />}

			{isDynamic && property ? <EditableTooltip property={property} /> : <MyToolTip tooltip={tooltip} />}

			{isDynamic && (
				<IconButton
					disableRipple
					onClick={onDelete}
					className='nodrag'
					sx={{
						width: 30,
						padding: 0,
						color: greyColor(50),
						'&:hover': { color: redColor(50, 70) },
					}}
				>
					<Trash2 size={22} strokeWidth={1} />
				</IconButton>
			)}
		</Stack>
	);
}
