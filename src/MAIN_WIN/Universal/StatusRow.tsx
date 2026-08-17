// Одна строка нижней панели: подпись раннера слева, его статус справа.
//
// Раннеров три (обработка, воркер, постинг), и строка у них должна быть одна и та же —
// иначе они расходятся молча. Так уже случилось: у обработки не было приглушения в
// простое, а у воркера и постинга было, и это читалось как «другой шрифт», хотя размер
// у всех был одинаковый (1.4rem).
//
// `active` — идёт ли прогон прямо сейчас. Приглушение в простое несёт смысл: по яркости
// видно, кто работает, не вчитываясь в текст.

import { Box, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import type { ReactNode } from 'react';

/** Стиль самого текста статуса. Тот же у всех трёх раннеров. */
export const statusTextSx = (active: boolean) => ({
	fontSize: '1.4rem',
	whiteSpace: 'pre-wrap' as const,
	wordBreak: 'break-word' as const,
	opacity: active ? 1 : 0.5,
});

interface Props {
	label: string;
	active: boolean;
	children: ReactNode;
	/** Правый край строки: кнопка перезагрузки у обработки, у остальных пусто. */
	trailing?: ReactNode;
}

export default function StatusRow({ label, active, children, trailing }: Props) {
	return (
		<Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', p: '2px 10px', minWidth: 0 }}>
			<Typography
				sx={{
					fontSize: '0.7rem',
					fontWeight: 700,
					letterSpacing: '0.5px',
					textTransform: 'uppercase',
					color: greyColor(48),
					flexShrink: 0,
				}}
			>
				{label}
			</Typography>
			<Box sx={{ minWidth: 0, overflow: 'hidden', flex: 1 }}>{children}</Box>
			{trailing}
		</Box>
	);
}
