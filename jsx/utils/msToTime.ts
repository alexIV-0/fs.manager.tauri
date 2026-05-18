export function msToTime(duration: number) {
    // var milliseconds, seconds, minutes, hours;
    var milliseconds = Math.floor((duration % 1000) / 100);
    var seconds = Math.floor((duration / 1000) % 60);
    var minutes = Math.floor((duration / (1000 * 60)) % 60);
    var hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

    function addZero(_numm: number) {
        return ('0' + _numm).slice(-2);
    }

    return addZero(hours) + ':' + addZero(minutes) + ':' + addZero(seconds);
}
