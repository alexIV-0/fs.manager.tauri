// Бэк-компат алиас: `joinPath` теперь — это `join` из канонического @/Utils/path.
// Раньше тут была отдельная реализация join (дублировала @/PluginAPI/path) — убрана,
// чтобы логика не разъезжалась. Новый код лучше импортировать `join` из '@/Utils/path'.
export { join as joinPath } from '@/Utils/path';
