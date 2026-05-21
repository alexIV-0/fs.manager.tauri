// Безопасное экранирование для shell
export function escapeShellArg(arg: string): string {
    if (process.platform === 'win32') {
        // Windows: экранируем двойные кавычки и оборачиваем в кавычки
        return `"${arg.replace(/"/g, '""').replace(/%/g, '%%')}"`;
    }
    // Unix: используем одинарные кавычки (они блокируют ВСЕ интерпретации)
    // Экранируем только сами одинарные кавычки
    return `'${arg.replace(/'/g, "'\\''")}'`;
}
