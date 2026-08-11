// Ловушка ошибок рендера — по одной на каждое окно.
//
// Зачем: непойманная ошибка в рендере размонтирует ВСЁ дерево, и окно становится
// белым без единого слова о причине. Для этой программы это дороже обычного:
//
//   • полный цикл обработки живёт в MAIN_WIN, прогон одной папки — в NODE_WIN;
//     размонтирование React'ом async-цикл НЕ останавливает, поэтому обработка
//     продолжает идти невидимо, а нажать «стоп» уже нечем;
//   • четыре окна — четыре независимых realm'а, и упавшее окно нельзя починить
//     из соседнего.
//
// Намеренно на обычном DOM и inline-стилях, без MUI и без темы приложения: если
// упало что-то в дереве компонентов, экран-откат не должен зависеть от той же
// библиотеки, которая, возможно, и упала.

import React from 'react';

interface Props {
	/** Имя окна — попадает в текст и в лог, чтобы было видно, ЧТО именно упало. */
	window: string;
	children: React.ReactNode;
}

interface State {
	error: Error | null;
	componentStack: string;
}

const wrap: React.CSSProperties = {
	position: 'fixed',
	inset: 0,
	overflow: 'auto',
	padding: '24px',
	background: '#1b1b1b',
	color: '#e6e6e6',
	font: '13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
};

const title: React.CSSProperties = {
	margin: '0 0 4px',
	font: '600 15px/1.4 system-ui, sans-serif',
	color: '#f85149',
};

const pre: React.CSSProperties = {
	margin: '12px 0 0',
	padding: '12px',
	background: '#111',
	border: '1px solid #333',
	borderRadius: '4px',
	whiteSpace: 'pre-wrap',
	wordBreak: 'break-word',
	maxHeight: '45vh',
	overflow: 'auto',
};

const button: React.CSSProperties = {
	padding: '6px 14px',
	background: '#2d2d2d',
	color: '#e6e6e6',
	border: '1px solid #444',
	borderRadius: '4px',
	cursor: 'pointer',
	font: '13px system-ui, sans-serif',
};

export class ErrorBoundary extends React.Component<Props, State> {
	state: State = { error: null, componentStack: '' };

	static getDerivedStateFromError(error: Error): Partial<State> {
		return { error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo): void {
		this.setState({ componentStack: info.componentStack ?? '' });

		// console.error — всегда: это работает даже когда IPC недоступен.
		console.error(`[ErrorBoundary:${this.props.window}]`, error, info.componentStack);

		// Плюс попытка дотянуться до окна логов, чтобы падение осело в суточном
		// архиве. Best-effort и в try/catch: если сломан как раз IPC, молчим —
		// иначе ловушка сама бросит исключение и мы вернёмся к белому экрану.
		void (async () => {
			try {
				const { commands } = await import('@/Utils/specta');
				await commands.sendLog('error', `[${this.props.window}] упал рендер: ${error?.message ?? String(error)}`);
			} catch {
				/* IPC недоступен — хватит console.error выше */
			}
		})();
	}

	private text(): string {
		const { error, componentStack } = this.state;
		return [
			`window: ${this.props.window}`,
			`error: ${error?.message ?? String(error)}`,
			'',
			error?.stack ?? '(без стека)',
			'',
			'component stack:',
			componentStack || '(пусто)',
		].join('\n');
	}

	render(): React.ReactNode {
		const { error } = this.state;
		if (!error) return this.props.children;

		return (
			<div style={wrap}>
				<h1 style={title}>Окно «{this.props.window}» упало на рендере</h1>
				<div style={{ color: '#9a9a9a', font: '13px/1.5 system-ui, sans-serif' }}>
					Интерфейс этого окна остановлен. Остальные окна работают. Если шла обработка, она
					продолжается в фоне — остановить её можно кнопкой в главном окне.
				</div>

				<div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
					<button style={button} onClick={() => window.location.reload()}>
						Перезагрузить окно
					</button>
					<button style={button} onClick={() => void navigator.clipboard?.writeText(this.text()).catch(() => {})}>
						Копировать отчёт
					</button>
				</div>

				<pre style={pre}>{this.text()}</pre>
			</div>
		);
	}
}
