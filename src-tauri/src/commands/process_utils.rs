// Trait для скрытия консольного окна при спавне дочерних процессов на Windows.
//
// В release-сборке приложение помечено `windows_subsystem = "windows"` —
// у него нет своей консоли. Когда такой процесс спавнит console-app (ffmpeg, ffprobe,
// where, cmd и т.п.), Windows автоматически создаёт новое console window для дочернего
// процесса — оно мелькает чёрной полоской. CREATE_NO_WINDOW (0x08000000) это подавляет.
//
// В dev-сборке атрибут не применяется, приложение запущено как console-app, дочерние
// процессы наследуют существующую консоль — окно не мелькает. Поэтому проблема видна
// только в prod.
//
// На macOS/Linux флаг отсутствует, метод — no-op.

use std::process::Command;

pub trait HiddenConsole {
    fn hide_console(&mut self) -> &mut Self;
}

#[cfg(target_os = "windows")]
impl HiddenConsole for Command {
    fn hide_console(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        self.creation_flags(CREATE_NO_WINDOW)
    }
}

#[cfg(not(target_os = "windows"))]
impl HiddenConsole for Command {
    fn hide_console(&mut self) -> &mut Self {
        self
    }
}
