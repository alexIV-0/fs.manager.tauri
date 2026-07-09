// autoTGcollect — конфиг-нода сбора медиа из Telegram в папку IN проекта.
//
// Нода без входов/выходов: только задаёт правила (бот сбора, чат-источник, что
// собираем, имя) и пишет их в options/tgSearch.json при сохранении флоу
// (syncTgSearchSidecar). Сам сбор выполняет core-раннер (src/PROCESSING/tgCollect/),
// читая tgSearch.json — НЕ этот плагин.
//
// Processing-функции у ноды нет: без связей в графе она не попадает в очередь
// обработки (createProcessQueue её пропустит). Файл существует только потому, что
// загрузчик плагинов требует непустой "main" — это заглушка с onLoad.
export { onLoad } from '../_template/pluginSender';
