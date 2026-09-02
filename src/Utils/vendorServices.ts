// Описания сервисов внешних вендоров — из чего строится форма заведения учётки.
//
// Контракт: `ideasAndTest/VENDOR_KEYS_CONTRACT.md` §6.2, §6.4.
//
// ⚠️ ВРЕМЕННО ЛОКАЛЬНЫЙ. По контракту каталог сервисов приезжает с сайта пятым —
// односторонним — словарём `settingsSync` (§6.4): сервисы заводятся там, мы их
// только читаем. Пока эндпоинта каталога нет, описания живут здесь, и заменить
// источник надо будет ровно в одном месте — `getVendorService`.
//
// ── Почему у сервиса СПИСОК полей, а не одно «поле ключа»
//
// Схемы аутентификации у вендоров разные, и статичный ключ в заголовке — лишь
// самая частая: бывает пара «ключ + секрет для подписи», бывает OAuth-набор
// (`client_id` + `client_secret` + refresh), бывает логин с паролем. Форма,
// умеющая только `apiKey`, ломается на втором же сервисе — поэтому набор полей
// описывается данными, и одно окно обслуживает всех.
//
// Логины и пароли от ЛИЧНЫХ КАБИНЕТОВ вендоров (пополнить кошелёк, выпустить
// ключ) сюда не относятся: программа в кабинет не ходит никогда, и хранить их
// нам незачем.

/** Одно поле секрета. `name` — ключ, под которым значение ляжет в сейф. */
export interface VendorServiceField {
	name: string;
	label: string;
	/** Длинные значения (JSON сервисного аккаунта, PEM) — многострочное поле. */
	multiline?: boolean;
	placeholder?: string;
}

export interface VendorServiceDesc {
	/** Слаг из каталога сайта. НЕИЗМЕНЯЕМ: лежит в ui.json бандлов и в чужих options.json. */
	slug: string;
	/** Человеческое имя для заголовка формы. */
	name: string;
	/** Где взять ключ — короткая подсказка в диалоге. */
	note?: string;
	fields: VendorServiceField[];
}

/**
 * Пункт дропдауна, открывающий форму заведения учётки.
 *
 * Строка одна на всех: её объявляет `ui.json` плагина, а сравнивает с ней
 * `ServiceAccountDDM`. Разъедутся — пункт перестанет открывать форму и станет
 * выглядеть как обычная метка (та же механика, что у `Add New Account` в VK).
 */
export const SERVICE_ADD_OPTION = 'Добавить учётку…';

/**
 * Пункт «сходить на сайт за ключами прямо сейчас».
 *
 * В отличие от `SERVICE_ADD_OPTION` его НЕ объявляют в `ui.json` — контрол
 * подставляет его сам. Иначе появление любой новой возможности означало бы правку
 * и пересборку всех плагинов, где есть поле учётки.
 */
export const SERVICE_REFRESH_OPTION = 'Обновить с сайта';

/** Токен динамических опций: `#services:<слаг>`. */
export const SERVICE_TAG_PREFIX = '#services:';

/**
 * Известные локально сервисы. Список намеренно короткий: выдумывать имена полей
 * за вендоров, с которыми мы ещё не работали, смысла нет — незнакомый слаг и так
 * получит рабочую форму (см. фолбэк ниже).
 */
export const LOCAL_VENDOR_SERVICES: VendorServiceDesc[] = [
	{
		slug: 'comfyui',
		name: 'ComfyUI',
		note: 'Токен нашего сервера ComfyUI. Значение идёт в заголовок Authorization целиком, вместе со словом Bearer.',
		fields: [{ name: 'authorization', label: 'Authorization', placeholder: 'Bearer …' }],
	},
];

/**
 * Описание сервиса по слагу.
 *
 * Незнакомый слаг — НЕ ошибка: отдаём форму с одним полем `apiKey`. Иначе автор
 * плагина был бы заблокирован до тех пор, пока сервис не заведут в каталоге, а
 * это ровно та ситуация, ради которой поле и заводится.
 */
export function getVendorService(slug: string): VendorServiceDesc {
	const found = LOCAL_VENDOR_SERVICES.find((s) => s.slug === slug);
	if (found) return found;
	return {
		slug,
		name: slug,
		fields: [{ name: 'apiKey', label: 'API-ключ' }],
	};
}

/** Вытаскивает слаг из списка опций свойства (`#services:eleven-labs` → `eleven-labs`). */
export function serviceSlugFromOptions(options: string[] | undefined): string {
	const tag = (options ?? []).find((o) => typeof o === 'string' && o.startsWith(SERVICE_TAG_PREFIX));
	return tag ? tag.slice(SERVICE_TAG_PREFIX.length).trim() : '';
}
