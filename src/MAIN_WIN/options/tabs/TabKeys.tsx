// Учётки внешних сервисов — что лежит в сейфе этой машины.
//
// Контракт: `ideasAndTest/VENDOR_KEYS_CONTRACT.md` §6.
//
// Зачем отдельный экран: завести учётку можно прямо в ноде, но увидеть, ЧТО вообще
// лежит в сейфе, оттуда нельзя — надо открыть нужный флоу и найти нужное поле. А
// вопросы «сколько у меня ключей», «этот с сайта или мой», «не протух ли» возникают
// вне всякого флоу.
//
// Секретов здесь нет и быть не может: `vault_list` отдаёт только метаданные, а
// подсказка `••••4f21` существует ровно для того, чтобы узнать ключ глазами, не
// доставая его.

import { Alert, Box, Button, Chip, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { VaultAccountMeta } from '@/bindings';
import { greyColor } from '@/Store/Color/grayColor';
import { commands, unwrap } from '@/Utils/specta';

/** `expiresAt` в человеческий вид. `null` — у локальных учёток срока нет вовсе. */
function expiryText(a: VaultAccountMeta): string {
	if (a.expiresAt == null) return 'бессрочно';
	if (a.expired) return 'срок вышел';
	const left = a.expiresAt * 1000 - Date.now();
	const hours = Math.floor(left / 3_600_000);
	if (hours >= 1) return `ещё ${hours} ч`;
	const minutes = Math.max(1, Math.floor(left / 60_000));
	return `ещё ${minutes} мин`;
}

export default function TabKeys() {
	const [rows, setRows] = useState<VaultAccountMeta[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			setRows(unwrap(await commands.vaultList(null)));
		} catch (e) {
			setMessage({ kind: 'error', text: `Сейф не прочитался: ${String(e)}` });
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const slugs = useMemo(() => [...new Set(rows.map((r) => r.slug))], [rows]);

	const refreshFromSite = useCallback(async () => {
		if (slugs.length === 0) return;
		setBusy(true);
		setMessage(null);
		try {
			// Задачу не называем: здесь обновляется всё, что знаем, а не собирается
			// конкретный прогон. Сайт присылает все доступные машине учётки сервиса —
			// выбирать за ноду он не станет, и это правильно.
			const report = unwrap(await commands.vaultSyncFromSite(slugs, null));
			const parts: string[] = [];
			if (report.issued.length) parts.push(`обновлено ${report.issued.length}`);
			if (report.fresh.length) parts.push(`актуально ${report.fresh.length}`);
			if (report.unavailable.length) parts.push(`недоступно: ${report.unavailable.join(', ')}`);
			// Отозванные показываем отдельно: их копии мы только что стёрли, и если
			// метка была выбрана в ноде, флоу перестанет стартовать — это надо увидеть.
			if (report.revoked.length)
				parts.push(`отозвано: ${report.revoked.map((r) => `${r.slug}/${r.label}`).join(', ')}`);
			setMessage({ kind: 'info', text: parts.length ? parts.join('; ') : 'сайт не прислал ничего нового' });
			await load();
		} catch (e) {
			setMessage({ kind: 'error', text: `Не получилось: ${String(e)}` });
		} finally {
			setBusy(false);
		}
	}, [slugs, load]);

	const remove = useCallback(
		async (a: VaultAccountMeta) => {
			try {
				unwrap(await commands.vaultDelete(a.slug, a.label));
				await load();
			} catch (e) {
				setMessage({ kind: 'error', text: `Не удалось удалить: ${String(e)}` });
			}
		},
		[load],
	);

	return (
		<Stack gap={1.5} sx={{ p: 2, height: '100%', overflow: 'auto' }}>
			<Stack direction='row' alignItems='center' gap={1}>
				<KeyRound size={18} color={greyColor(60)} />
				<Typography variant='subtitle1' color={greyColor(80)}>
					Учётки внешних сервисов
				</Typography>
				<Box flex={1} />
				<Button
					size='small'
					variant='outlined'
					startIcon={busy ? <CircularProgress size={14} /> : <RefreshCw size={14} />}
					onClick={refreshFromSite}
					disabled={busy || slugs.length === 0}
				>
					Обновить с сайта
				</Button>
			</Stack>

			<Typography variant='caption' color={greyColor(45)}>
				Локальные ключи лежат в хранилище учётных данных ОС; выданные сайтом — только в памяти
				программы и после перезапуска запрашиваются заново. Здесь в любом случае только метки. Кнопка обновляет
				сервисы, которые уже есть в списке: каталог с сайта пока не приезжает, поэтому новый сервис
				появляется здесь после того, как его выберут в ноде.
			</Typography>

			{message && (
				<Alert severity={message.kind === 'error' ? 'error' : 'info'} onClose={() => setMessage(null)}>
					{message.text}
				</Alert>
			)}

			{loading ? (
				<CircularProgress size={20} />
			) : rows.length === 0 ? (
				<Typography variant='body2' color={greyColor(45)}>
					Сейф пуст. Учётка заводится в ноде: поле Account → «Добавить учётку…».
				</Typography>
			) : (
				<Stack gap={0.5}>
					{rows.map((a) => (
						<Stack
							key={`${a.slug}/${a.label}`}
							direction='row'
							alignItems='center'
							gap={1}
							sx={{
								px: 1,
								py: 0.75,
								borderRadius: 1,
								border: `1px solid ${greyColor(20)}`,
								'&:hover .row-del': { opacity: 1 },
							}}
						>
							<Typography sx={{ width: 160, color: greyColor(55), fontSize: '0.85rem' }} noWrap>
								{a.slug}
							</Typography>
							<Typography sx={{ flex: 1, color: greyColor(85), fontSize: '0.9rem' }} noWrap>
								{a.label}
							</Typography>

							<Tooltip
								title={
									a.source === 'site'
										? 'Выдана сайтом: у копии есть срок, отзыв доезжает пульсом'
										: 'Заведена на этой машине, на сайт не уезжает'
								}
							>
								<Chip
									size='small'
									label={a.source === 'site' ? 'сайт' : 'локально'}
									sx={{ height: 18, fontSize: 10 }}
									color={a.source === 'site' ? 'primary' : 'default'}
									variant='outlined'
								/>
							</Tooltip>

							{a.loaded === false && (
								<Tooltip title='Ключи с сайта живут в памяти программы: после перезапуска их надо запросить заново'>
									<Chip size='small' label='не загружен' sx={{ height: 18, fontSize: 10 }} color='warning' variant='outlined' />
								</Tooltip>
							)}

							{a.stale && (
								<Tooltip title='На сайте меняли секреты — версия не подтверждается, ключ перезапросится'>
									<Chip size='small' label='несвежая' sx={{ height: 18, fontSize: 10 }} variant='outlined' />
								</Tooltip>
							)}

							<Typography sx={{ width: 110, color: a.expired ? '#ff6b6b' : greyColor(40), fontSize: 11 }}>
								{expiryText(a)}
							</Typography>

							<Tooltip title={a.baseUrl || 'Адрес знает сама нода'}>
								<Typography sx={{ width: 90, color: greyColor(35), fontSize: 11 }} noWrap>
									{a.hasSecret ? a.hint : 'без ключа'}
								</Typography>
							</Tooltip>

							<IconButton
								className='row-del'
								size='small'
								onClick={() => remove(a)}
								sx={{ opacity: 0, p: '2px', color: greyColor(45), '&:hover': { color: '#ff6b6b' } }}
							>
								<Trash2 size={14} />
							</IconButton>
						</Stack>
					))}
				</Stack>
			)}
		</Stack>
	);
}
