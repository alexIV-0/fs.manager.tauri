// TgAccountDDM — обёртка над SimpleDDM для поля `account` Telegram-нод (постинг и сбор).
//
// Рендерится из GenericProperty для ddm с '#tgAccounts'. Один бот на главную папку
// (platform 'telegram') используется И для постинга (autoPostTG), И для сбора
// (autoTGcollect) — разные роли одного бота, общий каталог accounts/<mainFolder>/telegram.json.
//
// «Аккаунт» в Telegram = бот с токеном @BotFather (см. TELEGRAM_AUTOPOST_PLAN.md).
// Авторизация проще VK: ни OAuth, ни WebView — токен вставляется строкой, валидируется
// через getMe (Rust tg_validate_token), сохраняется в telegram.json.

import { DDMProperty } from '@/NODE_WIN/definitions/types';
import { commands, unwrap } from '@/Utils/specta';
import { usePathStore } from '@/Store/Node/usePathStore';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useState } from 'react';
import SimpleDDMProperty from './SimpleDDM';

const ADD_BOT = 'Add Bot'; // вставка токена бота @BotFather

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

export default function TgAccountDDM({ property, onChange }: Props) {
	const path = usePathStore((s) => s.path);

	// Один бот на главную папку (platform 'telegram') — общий для постинга и сбора.
	const platform = 'telegram';

	const [refreshKey, setRefreshKey] = useState(0);

	const [open, setOpen] = useState(false);
	const [tokenText, setTokenText] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const saveBot = useCallback(async () => {
		const mainFolderName = mainFolderFromPath(path);
		if (!mainFolderName) {
			setError('Открой проект — нет главной папки.');
			return;
		}
		const token = tokenText.trim();
		if (!/^\d+:[\w-]{20,}$/.test(token)) {
			setError('Похоже, это не токен бота. Формат: 123456789:AA... (от @BotFather).');
			return;
		}
		setBusy(true);
		setError('');
		try {
			const me = unwrap(await commands.tgValidateToken(token)) as any; // бросит при невалидном токене
			const username: string = me?.username ?? '';
			const name = username || me?.first_name || `bot${me?.id ?? ''}`;

			const account = {
				name,
				platform,
				tokenSource: 'botfather',
				accessToken: token,
				botId: me?.id ?? 0,
				botUsername: username,
				channels: [],
			};
			unwrap(await commands.accountSave(mainFolderName, platform, account as any));
			onChange(name);
			setRefreshKey((k) => k + 1);
			setOpen(false);
			setTokenText('');
		} catch (e) {
			setError('Токен невалиден или не сохранился: ' + String(e));
		} finally {
			setBusy(false);
		}
	}, [path, platform, tokenText, onChange]);

	const handleChange = useCallback(
		(value: string) => {
			if (value === ADD_BOT) {
				setRefreshKey((k) => k + 1);
				setError('');
				setTokenText('');
				setOpen(true);
				return;
			}
			onChange(value);
		},
		[onChange],
	);

	const handleOptionDelete = useCallback(
		async (name: string) => {
			const mainFolderName = mainFolderFromPath(path);
			if (!mainFolderName) return;
			try {
				unwrap(await commands.accountDelete(mainFolderName, platform, name));
				if (property.controlProps.value === name) onChange('');
				setRefreshKey((k) => k + 1);
			} catch (e) {
				console.error('[TgAccountDDM] не удалось удалить бота:', e);
			}
		},
		[path, platform, onChange, property.controlProps.value],
	);

	const isDeletable = useCallback((opt: string) => opt !== ADD_BOT, []);

	return (
		<>
			<SimpleDDMProperty
				key={refreshKey}
				property={property}
				onChange={handleChange}
				onOptionDelete={handleOptionDelete}
				isOptionDeletable={isDeletable}
			/>

			<Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth='sm'>
				<DialogTitle>Добавить бота Telegram</DialogTitle>
				<DialogContent>
					<Stack gap={1.5} mt={0.5}>
						<Typography variant='body2' color='text.secondary'>
							1. В Telegram открой <code>@BotFather</code> → <code>/newbot</code> (или возьми готового).
							<br />
							2. Скопируй токен вида <code>123456789:AA...</code> и вставь сюда.
							<br />
							3. Для <b>постинга</b> — добавь бота админом канала с правом «Публиковать сообщения».
							Для <b>сбора</b> — админом супергруппы (или отключи privacy mode), чтобы он видел медиа.
						</Typography>

						<TextField
							label='Bot token (123456789:AA...)'
							value={tokenText}
							onChange={(e) => setTokenText(e.target.value)}
							fullWidth
							autoFocus
						/>

						{error && (
							<Typography variant='body2' color='error'>
								{error}
							</Typography>
						)}
					</Stack>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setOpen(false)} disabled={busy}>
						Отмена
					</Button>
					<Button onClick={saveBot} disabled={busy} variant='contained'>
						{busy ? 'Проверка…' : 'Сохранить'}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}
