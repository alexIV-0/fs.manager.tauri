export function calcColumnWidth(items: { name: string }[], min = 100, max = 300) {
    if (!items.length) return min;
    const longestName = items.reduce((a, b) => (b.name.length > a.name.length ? b : a));
    const width = Math.min(max, Math.max(min, longestName.name.length * 8 + 40));
    // 8px на символ + 40px отступы
    return width;
}
