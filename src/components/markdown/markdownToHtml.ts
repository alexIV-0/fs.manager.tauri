/**
 * markdown → HTML. Первая половина WYSIWYG-слоя.
 *
 * Документ в редактор загружается через HTML, а не через свой разбор mdast, и это
 * осознанно: строчный HTML в markdown приходит НЕПАРНЫМ (`<span class="fg-blue">`,
 * текст и `</span>` — три отдельных узла mdast), и собирать из них марки пришлось
 * бы вручную, конечным автоматом со стеком. `rehype-raw` уже делает ровно это и
 * отдаёт нормальное дерево, а правила `parseHTML` расширений Tiptap разбирают его
 * без нашего участия.
 *
 * Конвейер тот же, что в просмотрщике (`MarkdownView`), включая санитайз: текст
 * приходит из файла, который мог править сайт.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { toHtml } from 'hast-util-to-html';
import { descriptionSanitizeSchema } from './markdownFormat';
import { prepareHtml } from './tiptapExtensions';

const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkRehype, { allowDangerousHtml: true })
	.use(rehypeRaw)
	.use(rehypeSanitize, descriptionSanitizeSchema);

/** Чистый HTML описания — тот же результат, что рисует просмотрщик. */
export function markdownToHtml(md: string): string {
	const tree = processor.runSync(processor.parse(md));
	return toHtml(tree as never);
}

/** То же, но подготовленное под схему редактора (см. `prepareHtml`). */
export function markdownToEditorHtml(md: string): string {
	return prepareHtml(markdownToHtml(md));
}
