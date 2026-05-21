// =========================================================================================
/*
 * Форматирует строку, заменяя шаблоны даты и времени на текущие значения
 * Форматы:
 * $YYYY - год (4 цифры)
 * $MM - месяц (2 цифры)
 * $DD - день (2 цифры)
 * $HH - часы (2 цифры)
 * $mm - минуты (2 цифры)
 * $ss - секунды (2 цифры)
 */
// =========================================================================================

interface DateParts {
    YYYY: string;
    MM: string;
    DD: string;
    HH: string;
    mm: string;
    ss: string;
}

export function getFormattedDateTime(inputString: string): string {
    const currentDate = new Date();

    // Форматируем компоненты даты с ведущими нулями
    const formatWithZero = (value: number): string => value.toString().padStart(2, '0');

    const dateParts: DateParts = {
        YYYY: currentDate.getFullYear().toString(),
        MM: formatWithZero(currentDate.getMonth() + 1),
        DD: formatWithZero(currentDate.getDate()),
        HH: formatWithZero(currentDate.getHours()),
        mm: formatWithZero(currentDate.getMinutes()),
        ss: formatWithZero(currentDate.getSeconds()),
    };

    // Заменяем шаблоны формата $XXX на соответствующие значения
    const returnStr = inputString.replace(
        /\$(YYYY|MM|DD|HH|mm|ss)/g,
        (match, pattern: keyof DateParts) => dateParts[pattern] || match
    );

    return returnStr;
}
