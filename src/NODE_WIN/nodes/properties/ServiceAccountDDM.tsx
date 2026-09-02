// ServiceAccountDDM — поле выбора УЧЁТКИ внешнего сервиса (ключ вендора).
//
// Рендерится из GenericProperty для ddm, у которого в options есть `#services:<слаг>`.
// Контракт: `ideasAndTest/VENDOR_KEYS_CONTRACT.md` §6.2.
//
// ── Что здесь важно и почему
//
// В значении свойства лежит МЕТКА учётки, а не секрет. Метка уезжает в
// `options.json` проекта, а тот синхронизируется на сайт и едет в задаче на чужую
// машину — секрет там оказаться не должен ни при каких обстоятельствах. Сам ключ
// живёт в сейфе (`vault_*`) и достаётся только в момент вызова вендора.
//
// Форма заведения одна на все сервисы: поля берутся из описания сервиса
// (`src/Utils/vendorServices.ts`), а не пишутся под каждого вендора отдельно.
// Двадцать сервисов не должны означать двадцать окон.

import { DDMProperty } from '@/NODE_WIN/definitions/types';
import { commands, unwrap } from '@/Utils/specta';
import {
	SERVICE_ADD_OPTION,
	SERVICE_REFRESH_OPTION,
	getVendorService,
	serviceSlugFromOptions,
} from '@/Utils/vendorServices';
import {
	Alert,
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	Snackbar,
	Stack,
	TextField,
	Tooltip,
	Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import SimpleDDMProperty from './SimpleDDM';

interface Props {
	property: DDMProperty;
	onChange: (value: string) => void;
}

/** Метаданные учётки, которые нужны этому контролу. Секрета среди них нет. */
interface AccountMeta {
	label: string;
	source: string;
	hint: string;
	expired?: boolean;
	stale?: boolean;
}

export default function ServiceAccountDDM({ property, onChange }: Props) {
	const slug = useMemo(
		() => serviceSlugFromOptions(property.controlProps.options),
		[property.controlProps.options],
	);
	const service = useMemo(() => getVendorService(slug), [slug]);

	// Пересборка списка после записи/удаления/обновления: SimpleDDM резолвит опции на
	// маунте, поэтому меняем key, а не уговариваем его перечитать.
	const [refreshKey, setRefreshKey] = useState(0);

	// Метаданные нужны только для пометок в списке (откуда учётка, не протухла ли).
	// Отдельным запросом, а не из резолва опций: тот отдаёт голые строки, потому что
	// строка пункта — это значение свойства, и дописывать в неё пометку нельзя.
	const [metas, setMetas] = useState<AccountMeta[]>([]);

	const [open, setOpen] = useState(false);
	const [label, setLabel] = useState('');
	const [values, setValues] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [toast, setToast] = useState('');

	useEffect(() => {
		if (!slug) return;
		let alive = true;
		commands
			.vaultList(slug)
			.then((r) => {
				if (alive) setMetas(unwrap(r) as AccountMeta[]);
			})
			.catch((e) => console.warn('[ServiceAccountDDM] список учёток не прочитался:', e));
		return () => {
			alive = false;
		};
	}, [slug, refreshKey]);

	// Пункт «обновить с сайта» подставляем сами — см. SERVICE_REFRESH_OPTION.
	const effectiveProperty = useMemo(
		() => ({
			...property,
			controlProps: {
				...property.controlProps,
				options: [...(property.controlProps.options ?? []), SERVICE_REFRESH_OPTION],
			},
		}),
		[property],
	);

	const openDialog = useCallback(() => {
		setLabel('');
		setValues({});
		setError('');
		setOpen(true);
	}, []);

	const refreshFromSite = useCallback(async () => {
		if (!slug) return;
		const selected = property.controlProps.value;
		// Метку передаём, если она выбрана: у сервиса может быть и `main`, и `test`,
		// и сайт намеренно не выбирает за ноду — вернёт `ambiguous`.
		const accounts = typeof selected === 'string' && selected.trim() ? { [slug]: selected.trim() } : {};
		try {
			const report = unwrap(await commands.vaultSyncFromSite([slug], accounts, null));
			setRefreshKey((k) => k + 1);
			const parts: string[] = [];
			if (report.issued.length) parts.push(`получено ${report.issued.length}`);
			if (report.fresh.length) parts.push(`актуально ${report.fresh.length}`);
			if (report.unavailable.length) parts.push(`недоступно ${report.unavailable.join(', ')}`);
			if (report.ambiguous.length) parts.push(`учёток несколько — выбери метку (${report.ambiguous.join(', ')})`);
			setToast(parts.length ? parts.join('; ') : 'сайт не прислал ничего по этому сервису');
		} catch (e) {
			// Частая и совершенно нормальная причина — сервис просто не заведён на сайте
			// или сайт недоступен. Текст показываем как есть: по нему и понятно, что чинить.
			setToast(`Не получилось: ${String(e)}`);
		}
	}, [slug, property.controlProps.value]);

	const handleChange = useCallback(
		(value: string) => {
			if (value === SERVICE_ADD_OPTION) {
				// Спец-пункт не должен остаться выбранным значением свойства.
				setRefreshKey((k) => k + 1);
				openDialog();
				return;
			}
			if (value === SERVICE_REFRESH_OPTION) {
				setRefreshKey((k) => k + 1);
				void refreshFromSite();
				return;
			}
			onChange(value);
		},
		[onChange, openDialog, refreshFromSite],
	);

	const save = useCallback(async () => {
		if (!slug) {
			setError('У поля не указан сервис: в options нужен токен вида #services:<слаг>.');
			return;
		}
		const name = label.trim();
		if (!name) {
			setError('Укажи метку — под этим именем учётка будет видна в ноде.');
			return;
		}
		const filled: Record<string, string> = {};
		for (const f of service.fields) {
			const v = (values[f.name] ?? '').trim();
			if (!v) {
				setError(`Поле «${f.label}» не заполнено.`);
				return;
			}
			filled[f.name] = v;
		}

		setBusy(true);
		setError('');
		try {
			// source не передаём: учётка, заведённая руками на этой машине, — локальная.
			// На сайт она не уезжает, срока у неё нет (§6 контракта).
			unwrap(await commands.vaultSave(slug, name, filled, null, null, null));
			setOpen(false);
			onChange(name);
			setRefreshKey((k) => k + 1);
		} catch (e) {
			setError('Не удалось сохранить: ' + String(e));
		} finally {
			setBusy(false);
		}
	}, [slug, label, values, service.fields, onChange]);

	const handleOptionDelete = useCallback(
		async (name: string) => {
			if (!slug) return;
			try {
				unwrap(await commands.vaultDelete(slug, name));
				if (property.controlProps.value === name) onChange('');
				setRefreshKey((k) => k + 1);
			} catch (e) {
				console.error('[ServiceAccountDDM] не удалось удалить учётку:', e);
			}
		},
		[slug, onChange, property.controlProps.value],
	);

	// Удаляемы только настоящие учётки, не спец-пункты.
	const isDeletable = useCallback(
		(opt: string) => opt !== SERVICE_ADD_OPTION && opt !== SERVICE_REFRESH_OPTION,
		[],
	);

	// Откуда учётка и в каком она состоянии. Без этого две метки в списке выглядят
	// одинаково, хотя одна лежит только здесь, а вторая приехала с сайта и может быть
	// отозвана.
	const optionAdornment = useCallback(
		(opt: string) => {
			const meta = metas.find((m) => m.label === opt);
			if (!meta) return null;
			const chips: Array<{ text: string; color: string; title: string }> = [];
			if (meta.source === 'site') {
				chips.push({ text: 'сайт', color: 'rgba(120,180,255,0.75)', title: 'Ключ выдан сайтом, у копии есть срок' });
			} else {
				chips.push({ text: 'локально', color: 'rgba(255,255,255,0.35)', title: 'Заведена на этой машине, на сайт не уезжает' });
			}
			if (meta.expired) {
				chips.push({ text: 'истёк', color: '#ff6b6b', title: 'Срок копии вышел — нужен новый запрос к сайту' });
			}
			return (
				<Stack direction='row' gap={0.5} sx={{ pointerEvents: 'none' }}>
					{chips.map((c) => (
						<Tooltip key={c.text} title={c.title}>
							<Typography sx={{ fontSize: 10, color: c.color, lineHeight: '18px' }}>{c.text}</Typography>
						</Tooltip>
					))}
					{meta.hint && (
						<Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', lineHeight: '18px' }}>
							{meta.hint}
						</Typography>
					)}
				</Stack>
			);
		},
		[metas],
	);

	return (
		<>
			<SimpleDDMProperty
				key={refreshKey}
				property={effectiveProperty}
				onChange={handleChange}
				onOptionDelete={handleOptionDelete}
				isOptionDeletable={isDeletable}
				optionAdornment={optionAdornment}
			/>

			<Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth='sm'>
				<DialogTitle>Учётка: {service.name}</DialogTitle>
				<DialogContent>
					<Stack gap={1.5} mt={0.5}>
						{service.note && (
							<Typography variant='body2' color='text.secondary'>
								{service.note}
							</Typography>
						)}

						<TextField
							label='Метка'
							helperText='Как учётка называется в ноде. В проект уезжает только она, ключ — никогда.'
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							fullWidth
							autoFocus
						/>

						{service.fields.map((f) => (
							<TextField
								key={f.name}
								label={f.label}
								placeholder={f.placeholder}
								value={values[f.name] ?? ''}
								onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
								multiline={f.multiline}
								minRows={f.multiline ? 3 : undefined}
								fullWidth
							/>
						))}

						<Typography variant='caption' color='text.secondary'>
							Значения уходят в хранилище учётных данных ОС (Keychain / Credential Manager) и на
							сайт не отправляются. Метка, совпавшая с существующей, перезапишет её.
						</Typography>

						{error && <Alert severity='error'>{error}</Alert>}
					</Stack>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setOpen(false)} disabled={busy}>
						Отмена
					</Button>
					<Button variant='contained' onClick={save} disabled={busy}>
						Сохранить
					</Button>
				</DialogActions>
			</Dialog>

			<Snackbar
				open={!!toast}
				autoHideDuration={6000}
				onClose={() => setToast('')}
				message={toast}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
			/>
		</>
	);
}
