// Поиск и сортировка для списочных вкладок окна «Синхронизация».
//
// Одна реализация на все вкладки намеренно: списки разные («Локальные копии», «Не в
// облаке»), а вопросы к ним одни и те же — найти файл по части имени и разложить по
// размеру, дате или алфавиту. Две копии этой логики разошлись бы на первой же правке,
// как уже разошлось сравнение значков (см. `sameStorage`).
//
// Фильтр ищет и по имени, и по пути/папке: человек помнит либо «как называется», либо
// «где лежит», и заставлять его выбирать заранее незачем.

import { MenuItem, Select, Stack, TextField, Tooltip, IconButton } from '@mui/material';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search } from 'lucide-react';

export type SortKey = 'name' | 'size' | 'date';

/** Что читать у строки, чтобы её отфильтровать и отсортировать. */
export interface ListFields<T> {
	name: (row: T) => string;
	/** Где лежит — второе поле поиска. */
	where: (row: T) => string;
	size: (row: T) => number;
	/** Unix-секунды: mtime, последнее обращение — что осмысленно для этого списка. */
	date: (row: T) => number;
}

export function applyListView<T>(
	rows: T[],
	query: string,
	sort: SortKey,
	desc: boolean,
	f: ListFields<T>,
): T[] {
	const q = query.trim().toLowerCase();
	const found = q
		? rows.filter((r) => f.name(r).toLowerCase().includes(q) || f.where(r).toLowerCase().includes(q))
		: rows.slice();

	found.sort((a, b) => {
		// Алфавит — с локалью и без учёта регистра: `localeCompare` для «Ё» и «ё»
		// даёт то, что человек ожидает, а побайтовое сравнение — нет.
		const d =
			sort === 'name'
				? f.name(a).localeCompare(f.name(b), 'ru', { sensitivity: 'base' })
				: sort === 'size'
					? f.size(a) - f.size(b)
					: f.date(a) - f.date(b);
		return desc ? -d : d;
	});

	return found;
}

interface Props {
	query: string;
	onQuery: (v: string) => void;
	sort: SortKey;
	onSort: (v: SortKey) => void;
	desc: boolean;
	onDesc: (v: boolean) => void;
	/** Подпись даты у этого списка: «Изменён» или «Обращались». */
	dateLabel: string;
	/** Сколько показано из сколького — чтобы фильтр не выглядел как пустой список. */
	shown: number;
	total: number;
}

export function ListControls({ query, onQuery, sort, onSort, desc, onDesc, dateLabel, shown, total }: Props) {
	return (
		<Stack direction='row' spacing={1} sx={{ px: 2, py: '6px', alignItems: 'center' }}>
			<Search size={13} strokeWidth={1.5} opacity={0.6} />
			<TextField
				value={query}
				onChange={(e) => onQuery(e.target.value)}
				placeholder='Поиск по имени или папке'
				variant='standard'
				sx={{ flex: 1, minWidth: 0, '& input': { fontSize: 16, py: '2px' } }}
			/>

			<Select
				value={sort}
				onChange={(e) => onSort(e.target.value as SortKey)}
				variant='standard'
				sx={{ fontSize: 15, minWidth: 110 }}
			>
				<MenuItem value='name' sx={{ fontSize: 15 }}>
					По алфавиту
				</MenuItem>
				<MenuItem value='size' sx={{ fontSize: 15 }}>
					По размеру
				</MenuItem>
				<MenuItem value='date' sx={{ fontSize: 15 }}>
					{dateLabel}
				</MenuItem>
			</Select>

			<Tooltip title={desc ? 'По убыванию' : 'По возрастанию'} arrow>
				<IconButton size='small' sx={{ p: '2px' }} onClick={() => onDesc(!desc)}>
					{desc ? (
						<ArrowDownWideNarrow size={14} strokeWidth={1.5} />
					) : (
						<ArrowUpNarrowWide size={14} strokeWidth={1.5} />
					)}
				</IconButton>
			</Tooltip>

			{shown !== total && (
				<Tooltip title='Показано после фильтра' arrow>
					<span style={{ fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap' }}>
						{shown} из {total}
					</span>
				</Tooltip>
			)}
		</Stack>
	);
}
