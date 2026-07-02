// YoutubeAccountDDM — обёртка над SimpleDDM для поля `account` (канал) ноды autoPostYT.
//
// Рендерится из GenericProperty для ddm, у которого options содержат '#youtubeAccounts'.
// Модель B (BYO credentials): пользователь заводит СВОЙ Google Cloud проект (см. гайд
// ideasAndTest/YT_SETUP_2_USER.md), вводит client_id/client_secret и логинится своим Google —
// мы получаем и храним refresh_token канала.
//
// Поток «Добавить канал»:
//   диалог (имя канала + client_id + client_secret) → youtubeAuthStart (системный браузер +
//   loopback + PKCE, возвращает refresh/access-токены напрямую) → accountSave → выбор канала.
//   (В отличие от VK, событие слушать не нужно — команда async и сама возвращает результат.)

import { DDMProperty } from '@/NODE_WIN/definitions/types';
import { commands, unwrap } from '@/Utils/specta';
import { usePathStore } from '@/Store/Node/usePathStore';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useState } from 'react';
import SimpleDDMProperty from './SimpleDDM';

const ADD_NEW = 'Добавить канал'; // совпадает с пунктом в plugins-dev/autoPostYT/ui.json
const PLATFORM = 'youtube';

interface Props {
	property: DDMProperty;
	onChange: (value: string) => void;
}

// path = "…/mainFolder/projectName" → mainFolderName = предпоследний сегмент
function mainFolderFromPath(path: string | undefined): string {
	if (!path) return '';
	const parts = path.split(/[\\/]+/).filter(Boolean);
	return parts.length >= 2 ? parts[parts.length - 2] : '';
}

export default function YoutubeAccountDDM({ property, onChange }: Props) {
	const path = usePathStore((s) => s.path);
	const [refreshKey, setRefreshKey] = useState(0);

	// диалог добавления канала
	const [addOpen, setAddOpen] = useState(false);
	const [name, setName] = useState('');
	const [clientId, setClientId] = useState('');
	const [clientSecret, setClientSecret] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const startAuth = useCallback(async () => {
		const mainFolderName = mainFolderFromPath(path);
		if (!mainFolderName) {
			setError('Открой проект — нет главной папки.');
			return;
		}
		const nm = name.trim();
		const cid = clientId.trim();
		const secret = clientSecret.trim();
		if (!nm || !cid || !secret) {
			setError('Заполни имя канала, Client ID и Client Secret.');
			return;
		}
		setBusy(true);
		setError('');
		try {
			// Откроется системный браузер — пользователь входит и выбирает канал.
			const rec = unwrap(await commands.youtubeAuthStart(cid, secret)) as any;
			const refreshToken = rec?.refreshToken;
			if (!refreshToken) {
				setError('Не получен refresh-токен. Проверь client_id/secret и попробуй снова.');
				return;
			}
			const account = {
				name: nm,
				platform: PLATFORM,
				clientId: cid,
				clientSecret: secret,
				refreshToken,
				accessToken: rec?.accessToken ?? '',
				accessTokenExpiry: rec?.accessTokenExpiry ?? 0,
			};
			unwrap(await commands.accountSave(mainFolderName, PLATFORM, account as any));
			onChange(nm);
			setRefreshKey((k) => k + 1);
			setAddOpen(false);
			setName('');
			setClientId('');
			setClientSecret('');
		} catch (e) {
			setError('Не удалось авторизоваться: ' + String(e));
		} finally {
			setBusy(false);
		}
	}, [path, name, clientId, clientSecret, onChange]);

	const handleChange = useCallback(
		(value: string) => {
			if (value === ADD_NEW) {
				setRefreshKey((k) => k + 1); // сбросить выбор ddm обратно
				setError('');
				setAddOpen(true);
				return;
			}
			onChange(value);
		},
		[onChange],
	);

	const handleOptionDelete = useCallback(
		async (optName: string) => {
			const mainFolderName = mainFolderFromPath(path);
			if (!mainFolderName) return;
			try {
				unwrap(await commands.accountDelete(mainFolderName, PLATFORM, optName));
				if (property.controlProps.value === optName) onChange('');
				setRefreshKey((k) => k + 1);
			} catch (e) {
				console.error('[YoutubeAccountDDM] не удалось удалить канал:', e);
			}
		},
		[path, onChange, property.controlProps.value],
	);

	// удаляемы только реальные каналы, не спец-пункт
	const isDeletable = useCallback((opt: string) => opt !== ADD_NEW, []);

	return (
		<>
			<SimpleDDMProperty
				key={refreshKey}
				property={property}
				onChange={handleChange}
				onOptionDelete={handleOptionDelete}
				isOptionDeletable={isDeletable}
			/>

			<Dialog open={addOpen} onClose={() => !busy && setAddOpen(false)} fullWidth maxWidth='sm'>
				<DialogTitle>Добавить YouTube-канал</DialogTitle>
				<DialogContent>
					<Stack gap={1.5} mt={0.5}>
						<Typography variant='body2' color='text.secondary'>
							Нужны Client ID и Client Secret из твоего Google Cloud проекта (тип OAuth-клиента
							Desktop app). Как их получить — см. гайд <code>YT_SETUP_2_USER.md</code>. После нажатия
							«Войти» откроется браузер — выбери нужный канал и разреши доступ.
						</Typography>

						<TextField
							label='Имя канала (как показывать в списке)'
							value={name}
							onChange={(e) => setName(e.target.value)}
							fullWidth
							autoFocus
						/>
						<TextField
							label='Client ID'
							value={clientId}
							onChange={(e) => setClientId(e.target.value)}
							fullWidth
						/>
						<TextField
							label='Client Secret'
							value={clientSecret}
							onChange={(e) => setClientSecret(e.target.value)}
							fullWidth
						/>

						{busy && (
							<Typography variant='body2' color='text.secondary'>
								Открыт браузер — войди в Google и выбери канал…
							</Typography>
						)}
						{error && (
							<Typography variant='body2' color='error'>
								{error}
							</Typography>
						)}
					</Stack>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setAddOpen(false)} disabled={busy}>
						Отмена
					</Button>
					<Button onClick={startAuth} disabled={busy} variant='contained'>
						{busy ? 'Ожидание входа…' : 'Войти'}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}
