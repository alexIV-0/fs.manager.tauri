/**
 * Блок-схема из фенса ```mermaid — локальный превью.
 *
 * В файл описания мы пишем только текст диаграммы (контракт §5: «рисует
 * просмотрщик, не мы»), и до этого компонента схема в программе показывалась
 * простым блоком кода — увидеть её можно было лишь на сайте, после публикации.
 *
 * Пакет тянется динамическим `import` внутри эффекта: он весит несколько
 * мегабайт, а диаграмма есть далеко не в каждом описании — так mermaid не
 * попадает в основной бандл окна и грузится только когда встретился фенс.
 *
 * `securityLevel: 'strict'` обязателен: текст диаграммы приходит из файла,
 * который мог править сайт, доверенным он не является.
 *
 * Не разобралось — показываем исходный текст блоком кода. Никогда не ошибкой и
 * не пустотой: это правило контракта, одинаковое для нас и для сайта.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';

export function MermaidBlock({ chart }: { chart: string }) {
	const host = useRef<HTMLDivElement | null>(null);
	const [failed, setFailed] = useState(false);
	// useId отдаёт `:r1:` — двоеточия ломают и селекторы, и id внутри SVG.
	const domId = `md-mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

	useEffect(() => {
		let alive = true;
		setFailed(false);

		void (async () => {
			try {
				const mermaid = (await import('mermaid')).default;
				if (!alive) return;

				mermaid.initialize({
					startOnLoad: false,
					securityLevel: 'strict',
					theme: 'dark',
					fontFamily: 'inherit',
					themeVariables: {
						background: greyColor(10),
						primaryColor: greyColor(20),
						primaryBorderColor: '#89b4fa',
						primaryTextColor: greyColor(85),
						secondaryColor: greyColor(24),
						tertiaryColor: greyColor(28),
						lineColor: greyColor(55),
						textColor: greyColor(80),
					},
				});

				const { svg } = await mermaid.render(domId, chart);
				if (!alive || !host.current) return;
				host.current.innerHTML = svg;
			} catch {
				if (alive) setFailed(true);
			}
		})();

		return () => {
			alive = false;
		};
	}, [chart, domId]);

	if (failed) {
		return (
			<pre>
				<code className='language-mermaid'>{chart}</code>
			</pre>
		);
	}

	// Схема шире колонки прокручивается внутри себя, как таблица.
	return <Box ref={host} className='md-mermaid' sx={{ overflowX: 'auto', maxWidth: '100%', margin: '12px 0' }} />;
}

export default MermaidBlock;
