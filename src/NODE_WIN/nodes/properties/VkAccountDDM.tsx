// VkAccountDDM — обёртка над SimpleDDM для поля `account` ноды постинга.
//
// Рендерится из GenericProperty для ddm, у которого options содержат '#vkAccounts'.
// SimpleDDM остаётся чисто презентационным; вся VK-логика — здесь.
//
// Два пути добавления аккаунта:
//   • «Add New Account» → vkAuthOpen (окно логина VK) → событие 'vk-auth-result'
//     (token+userId) → vkValidateToken → accountSave → выбор аккаунта.
//   • «Вставить токен вручную» → модалка: логин в обычном браузере (надёжно, без
//     троттлинга webview) → скопировать blank.html#access_token=... → вставить →
//     парсим токен → vkValidateToken → accountSave.
//
// ⚠️ Phase 1: аккаунт сохраняется как PROFILE (targetType:'profile'). Профиль/
// сообщество (+ список админ-групп) — Phase 2.

import { DDMProperty } from '@/NODE_WIN/definitions/types';
import { commands, unwrap } from '@/Utils/specta';
import { usePathStore } from '@/Store/Node/usePathStore';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import SimpleDDMProperty from './SimpleDDM';

const ADD_NEW = 'Add New Account'; // вход через окно логина VK
const ADD_PASTE = 'Вставить токен вручную'; // обход троттлинга: логин в браузере + вставка
const PLATFORM = 'vk';

// authorize-URL для ручного входа в браузере (тот же, что в vk_auth_open).
// Kate Mobile (2685278) — offline-токен не привязан к IP. Только Video (без Клипов).
const AUTH_URL =
	'https://oauth.vk.com/authorize?client_id=2685278' +
	'&scope=video,wall,groups,offline,photos,docs' +
	'&response_type=token' +
	'&redirect_uri=https://oauth.vk.com/blank.html&v=5.199';

interface VkAuthResult {
	token: string;
	userId: number;
	expiresIn: number;
}

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

// Извлекает токен из вставленного URL (blank.html#access_token=...) или сырого токена.
function parseToken(input: string): { token: string; userId: number } | null {
	const t = input.trim();
	if (!t) return null;
	const m = t.match(/access_token=([^&\s#]+)/);
	if (m) {
		const uid = t.match(/user_id=(\d+)/);
		return { token: m[1], userId: uid ? parseInt(uid[1], 10) : 0 };
	}
	// вставили сам токен (vk1.../vk2... — длинная строка без пробелов)
	if (/^\S{20,}$/.test(t)) return { token: t, userId: 0 };
	return null;
}

export default function VkAccountDDM({ property, onChange }: Props) {
	const path = usePathStore((s) => s.path);
	const [refreshKey, setRefreshKey] = useState(0);
	const unlistenRef = useRef<UnlistenFn | null>(null);

	// модалка ручной вставки токена
	const [pasteOpen, setPasteOpen] = useState(false);
	const [pasteText, setPasteText] = useState('');
	const [pasteBusy, setPasteBusy] = useState(false);
	const [pasteError, setPasteError] = useState('');

	const cleanup = useCallback(() => {
		if (unlistenRef.current) {
			unlistenRef.current();
			unlistenRef.current = null;
		}
	}, []);

	useEffect(() => cleanup, [cleanup]);

	// Сохранить аккаунт по токену (общий для webview-потока и ручной вставки).
	const saveAccount = useCallback(
		async (mainFolderName: string, token: string, userIdHint: number) => {
			let name = userIdHint ? `id${userIdHint}` : 'vk account';
			let userId = userIdHint;
			const user = unwrap(await commands.vkValidateToken(token)) as any; // бросит при невалидном токене
			const full = `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim();
			if (full) name = full;
			if (user?.id) userId = user.id;

			const account = {
				name,
				platform: PLATFORM,
				tokenSource: 'kate_mobile',
				accessToken: token,
				userId,
				targetType: 'profile',
				targetId: userId,
			};
			unwrap(await commands.accountSave(mainFolderName, PLATFORM, account as any));
			onChange(name);
			setRefreshKey((k) => k + 1);
			return name;
		},
		[onChange],
	);

	const startAddFlow = useCallback(async () => {
		const mainFolderName = mainFolderFromPath(path);
		if (!mainFolderName) {
			console.warn('[VkAccountDDM] нет главной папки (открой проект) — добавление недоступно');
			return;
		}
		cleanup();
		try {
			unlistenRef.current = await listen<VkAuthResult>('vk-auth-result', async (event) => {
				cleanup();
				const token = event.payload?.token;
				const userId = event.payload?.userId ?? 0;
				if (!token) return;
				try {
					await saveAccount(mainFolderName, token, userId);
				} catch (e) {
					console.error('[VkAccountDDM] не удалось сохранить аккаунт:', e);
				}
			});
			unwrap(await commands.vkAuthOpen(null, false));
		} catch (e) {
			console.error('[VkAccountDDM] не удалось открыть окно логина VK:', e);
			cleanup();
		}
	}, [path, cleanup, saveAccount]);

	const savePastedToken = useCallback(async () => {
		const mainFolderName = mainFolderFromPath(path);
		if (!mainFolderName) {
			setPasteError('Открой проект — нет главной папки.');
			return;
		}
		const parsed = parseToken(pasteText);
		if (!parsed) {
			setPasteError('Не нашёл токен. Вставь адрес blank.html#access_token=… или сам токен.');
			return;
		}
		setPasteBusy(true);
		setPasteError('');
		try {
			await saveAccount(mainFolderName, parsed.token, parsed.userId);
			setPasteOpen(false);
			setPasteText('');
		} catch (e) {
			setPasteError('Токен невалиден или не сохранился: ' + String(e));
		} finally {
			setPasteBusy(false);
		}
	}, [path, pasteText, saveAccount]);

	const handleChange = useCallback(
		(value: string) => {
			if (value === ADD_NEW) {
				setRefreshKey((k) => k + 1);
				startAddFlow();
				return;
			}
			if (value === ADD_PASTE) {
				setRefreshKey((k) => k + 1);
				setPasteError('');
				setPasteText('');
				setPasteOpen(true);
				return;
			}
			onChange(value);
		},
		[onChange, startAddFlow],
	);

	const handleOptionDelete = useCallback(
		async (name: string) => {
			const mainFolderName = mainFolderFromPath(path);
			if (!mainFolderName) return;
			try {
				unwrap(await commands.accountDelete(mainFolderName, PLATFORM, name));
				if (property.controlProps.value === name) onChange('');
				setRefreshKey((k) => k + 1);
			} catch (e) {
				console.error('[VkAccountDDM] не удалось удалить аккаунт:', e);
			}
		},
		[path, onChange, property.controlProps.value],
	);

	// удаляемы только реальные аккаунты, не спец-пункты
	const isDeletable = useCallback((opt: string) => opt !== ADD_NEW && opt !== ADD_PASTE, []);

	return (
		<>
			<SimpleDDMProperty
				key={refreshKey}
				property={property}
				onChange={handleChange}
				onOptionDelete={handleOptionDelete}
				isOptionDeletable={isDeletable}
			/>

			<Dialog open={pasteOpen} onClose={() => setPasteOpen(false)} fullWidth maxWidth='sm'>
				<DialogTitle>Вставить токен VK</DialogTitle>
				<DialogContent>
					<Stack gap={1.5} mt={0.5}>
						<Typography variant='body2' color='text.secondary'>
							1. Открой страницу входа VK в браузере (там логин работает без капчи/троттлинга).
							<br />
							2. Войди → попадёшь на пустую страницу <code>blank.html#access_token=…</code>.
							<br />
							3. Скопируй адрес из строки браузера и вставь сюда (можно вставить и сам токен).
						</Typography>

						<Button
							size='small'
							variant='outlined'
							onClick={() => commands.shellOpenPath(AUTH_URL).catch(() => {})}
						>
							Открыть страницу входа в браузере
						</Button>

						<TextField
							label='blank.html#access_token=…  или токен'
							value={pasteText}
							onChange={(e) => setPasteText(e.target.value)}
							multiline
							minRows={3}
							fullWidth
							autoFocus
						/>

						{pasteError && (
							<Typography variant='body2' color='error'>
								{pasteError}
							</Typography>
						)}
					</Stack>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setPasteOpen(false)} disabled={pasteBusy}>
						Отмена
					</Button>
					<Button onClick={savePastedToken} disabled={pasteBusy} variant='contained'>
						{pasteBusy ? 'Проверка…' : 'Сохранить'}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}
