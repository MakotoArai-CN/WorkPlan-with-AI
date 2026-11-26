//! Native command execution. Settings and request authorization belong to this
//! module, never to a webview setting or a caller-supplied permission flag.
//!
//! Integration: declare `mod command_execution;` and register the four public
//! commands in `generate_handler!`. The existing dialog plugin is sufficient;
//! no setup hook or additional frontend plugin permissions are needed.

use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, MutexGuard, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const MAX_COMMAND_LENGTH: usize = 16_000;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const POLL_INTERVAL: Duration = Duration::from_millis(20);
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(1);
const SETTINGS_FILE: &str = "command-execution.json";
const DISABLED: &str =
    "COMMAND_EXECUTION_DISABLED: Command execution is disabled. Enable it in Settings.";
const UNSUPPORTED: &str =
    "COMMAND_EXECUTION_UNSUPPORTED: Command execution is unavailable on this platform.";

fn supported() -> bool {
    cfg!(any(
        windows,
        target_os = "linux",
        target_os = "macos",
        target_os = "android"
    ))
}

fn shell_name() -> Option<&'static str> {
    if cfg!(windows) {
        Some("powershell")
    } else if cfg!(target_os = "android") {
        Some("/system/bin/sh")
    } else if cfg!(any(target_os = "linux", target_os = "macos")) {
        Some("/bin/sh")
    } else {
        None
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionStatus {
    pub enabled: bool,
    pub supported: bool,
    pub platform: &'static str,
    pub shell: Option<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionResult {
    pub request_id: String,
    pub command: String,
    pub cwd: String,
    pub shell: Option<&'static str>,
    pub executed: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub cancelled: bool,
    pub output_truncated: bool,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub duration_ms: u64,
    pub error: Option<String>,
}

impl CommandExecutionResult {
    fn new(request_id: String, command: String, cwd: &Path) -> Self {
        Self {
            request_id,
            command,
            cwd: cwd.to_string_lossy().into_owned(),
            shell: shell_name(),
            executed: false,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            timed_out: false,
            cancelled: false,
            output_truncated: false,
            stdout_truncated: false,
            stderr_truncated: false,
            duration_ms: 0,
            error: None,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Settings {
    enabled: bool,
}

fn read_enabled(path: &Path) -> io::Result<bool> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::new();
    file.take(4097).read_to_end(&mut bytes)?;
    if bytes.len() > 4096 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Command execution settings are too large",
        ));
    }
    serde_json::from_slice::<Settings>(&bytes)
        .map(|settings| settings.enabled)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn write_enabled(path: &Path, enabled: bool) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("Missing settings directory"))?;
    fs::create_dir_all(parent)?;
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|error| io::Error::other(error.to_string()))?;
    let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let temporary = parent.join(format!(".command-execution-{suffix}.tmp"));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    let result = (|| {
        serde_json::to_writer(&mut file, &Settings { enabled }).map_err(io::Error::other)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        drop(file);
        replace_settings(&temporary, path)?;
        // An enable is not acknowledged until the actual destination reads back.
        if read_enabled(path)? != enabled {
            return Err(io::Error::other(
                "Command execution settings were not persisted",
            ));
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[cfg(not(windows))]
fn replace_settings(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)?;
    // Persist the directory entry as well as the file's contents.
    fs::File::open(destination.parent().unwrap())?.sync_all()
}

#[cfg(windows)]
fn replace_settings(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // SAFETY: both paths are valid, terminated UTF-16 buffers for this call.
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[derive(Default)]
struct Registry {
    path: Option<Result<PathBuf, String>>,
    enabled: bool,
    requests: HashMap<String, Arc<AtomicBool>>,
    // Kept for the lifetime of this native process. A stop IPC can arrive before
    // execute IPC, or an old dialog can report acceptance after its request ends.
    cancelled_ids: HashSet<String>,
    completed_ids: HashSet<String>,
}

impl Registry {
    fn revoke_all(&mut self) {
        self.enabled = false;
        for (id, cancelled) in &self.requests {
            cancelled.store(true, Ordering::SeqCst);
            self.cancelled_ids.insert(id.clone());
        }
    }

    fn refresh(&mut self) {
        // Never enable from an external file change during this session. Only
        // successful native Settings writes may transition OFF -> ON.
        if self.enabled {
            let persisted = self
                .path
                .as_ref()
                .and_then(|path| path.as_ref().ok())
                .and_then(|path| read_enabled(path).ok())
                .unwrap_or(false);
            if !persisted {
                self.revoke_all();
            }
        }
    }
}

#[derive(Default)]
struct ExecutionService {
    registry: Mutex<Registry>,
}

impl ExecutionService {
    fn lock(&self) -> MutexGuard<'_, Registry> {
        match self.registry.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                guard.revoke_all();
                guard
            }
        }
    }

    fn initialize(&self, path: Result<PathBuf, String>) {
        let mut registry = self.lock();
        if registry.path.is_none() {
            registry.enabled = supported()
                && path
                    .as_ref()
                    .ok()
                    .and_then(|path| read_enabled(path).ok())
                    .unwrap_or(false);
            registry.path = Some(path);
        }
    }

    fn status(&self) -> CommandExecutionStatus {
        let mut registry = self.lock();
        registry.refresh();
        CommandExecutionStatus {
            enabled: supported() && registry.enabled,
            supported: supported(),
            platform: std::env::consts::OS,
            shell: shell_name(),
        }
    }

    fn set_enabled(&self, enabled: bool) -> Result<CommandExecutionStatus, String> {
        let mut registry = self.lock();
        // Revocation happens before any I/O, and survives a persistence failure.
        if !enabled {
            registry.revoke_all();
        }
        if !supported() {
            registry.revoke_all();
            return Err(UNSUPPORTED.into());
        }
        let write = registry
            .path
            .as_ref()
            .ok_or("Command execution settings are not initialized")
            .and_then(|path| path.as_ref().map_err(String::as_str))
            .and_then(|path| {
                write_enabled(path, enabled)
                    .map_err(|_| "Cannot persist command execution settings")
            });
        if let Err(error) = write {
            let error = error.to_string();
            registry.revoke_all();
            return Err(format!(
                "COMMAND_EXECUTION_SETTINGS: {error}; command execution remains disabled"
            ));
        }
        registry.enabled = enabled;
        drop(registry);
        Ok(self.status())
    }

    fn reserve(self: &Arc<Self>, id: &str) -> Result<Reservation, String> {
        validate_request_id(id)?;
        let mut registry = self.lock();
        registry.refresh();
        if !supported() {
            return Err(UNSUPPORTED.into());
        }
        if !registry.enabled {
            return Err(DISABLED.into());
        }
        if registry.requests.contains_key(id) || registry.completed_ids.contains(id) {
            return Err(
                "COMMAND_EXECUTION_DUPLICATE: This request ID was already reserved or completed"
                    .into(),
            );
        }
        let cancelled = Arc::new(AtomicBool::new(registry.cancelled_ids.contains(id)));
        registry.requests.insert(id.to_string(), cancelled.clone());
        Ok(Reservation {
            service: self.clone(),
            id: id.to_string(),
            cancelled,
        })
    }

    fn cancel(&self, id: &str) -> Result<bool, String> {
        validate_request_id(id)?;
        let mut registry = self.lock();
        registry.cancelled_ids.insert(id.to_string());
        if let Some(cancelled) = registry.requests.get(id) {
            cancelled.store(true, Ordering::SeqCst);
        }
        // True also acknowledges an early cancellation recorded as a tombstone.
        Ok(true)
    }
}

struct Reservation {
    service: Arc<ExecutionService>,
    id: String,
    cancelled: Arc<AtomicBool>,
}

impl Reservation {
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn check_authorized(&self) -> bool {
        let mut registry = self.service.lock();
        registry.refresh();
        registry.enabled && !self.is_cancelled()
    }

    #[cfg(any(
        windows,
        target_os = "linux",
        target_os = "macos",
        target_os = "android"
    ))]
    fn spawn(&self, command: &str, cwd: &Path) -> Result<Option<platform::Process>, String> {
        let mut registry = self.service.lock();
        registry.refresh();
        // The same lock covers revalidation AND process creation. A revoke or
        // cancellation committed before this point cannot slip past the check.
        if !registry.enabled || self.is_cancelled() {
            return Ok(None);
        }
        platform::Process::spawn(command, cwd)
            .map(Some)
            .map_err(|error| format!("COMMAND_EXECUTION_SPAWN: {error}"))
    }
}

impl Drop for Reservation {
    fn drop(&mut self) {
        let mut registry = self.service.lock();
        registry.requests.remove(&self.id);
        if self.is_cancelled() {
            registry.cancelled_ids.insert(self.id.clone());
        } else {
            registry.completed_ids.insert(self.id.clone());
        }
    }
}

static SERVICE: OnceLock<Arc<ExecutionService>> = OnceLock::new();

fn service() -> Arc<ExecutionService> {
    SERVICE
        .get_or_init(|| Arc::new(ExecutionService::default()))
        .clone()
}

fn app_service(app: &tauri::AppHandle) -> Arc<ExecutionService> {
    let service = service();
    service.initialize(
        app.path()
            .app_data_dir()
            .map(|path| path.join(SETTINGS_FILE))
            .map_err(|error| error.to_string()),
    );
    service
}

fn validate_request_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 256 || id.chars().any(char::is_control) {
        return Err("COMMAND_EXECUTION_INVALID_REQUEST: requestId must contain 1 to 256 bytes without control characters".into());
    }
    Ok(())
}

fn validate_command(command: &str) -> Result<(), String> {
    // UTF-16 units match JS string length and keep Windows' escaped command line
    // below CreateProcessW's 32767-unit limit, including quote/backslash escaping.
    if command.trim().is_empty()
        || command.contains('\0')
        || command.encode_utf16().count() > MAX_COMMAND_LENGTH
    {
        return Err("COMMAND_EXECUTION_INVALID_COMMAND: command must be nonempty, contain no NUL, and be at most 16000 UTF-16 units".into());
    }
    Ok(())
}

fn resolve_cwd(cwd: Option<&str>) -> Result<PathBuf, String> {
    let path = match cwd {
        Some(value) => crate::normalize_path(value)?,
        None => {
            fs::canonicalize(crate::current_workspace_root()?).map_err(|error| error.to_string())?
        }
    };
    if !path.is_dir() {
        return Err(
            "COMMAND_EXECUTION_INVALID_CWD: Working directory must be an existing directory".into(),
        );
    }
    // Do not show a lossy path in the authorization dialog while executing in a
    // different byte sequence. The user must see the exact resolved directory.
    path.to_str()
        .ok_or("COMMAND_EXECUTION_INVALID_CWD: Working directory is not valid Unicode")?;
    Ok(path)
}

fn timeout_duration(timeout_ms: Option<u64>) -> Duration {
    Duration::from_millis(
        timeout_ms
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .clamp(1_000, 120_000),
    )
}

struct DialogText {
    title: &'static str,
    question: &'static str,
    directory: &'static str,
    command: &'static str,
    execute: &'static str,
    cancel: &'static str,
}

fn dialog_text(language: Option<&str>) -> DialogText {
    let language = language
        .unwrap_or("en")
        .to_ascii_lowercase()
        .replace('_', "-");
    let labels = if language.starts_with("zh-hant")
        || language.starts_with("zh-tw")
        || language.starts_with("zh-hk")
    {
        [
            "WorkPlan — 執行命令",
            "允許執行此命令嗎？",
            "工作目錄：",
            "命令（完整原文）：",
            "執行",
            "取消",
        ]
    } else if language == "zh" || language.starts_with("zh-") {
        [
            "WorkPlan — 执行命令",
            "允许执行此命令吗？",
            "工作目录：",
            "命令（完整原文）：",
            "执行",
            "取消",
        ]
    } else if language == "ja" || language.starts_with("ja-") {
        [
            "WorkPlan — コマンドの実行",
            "このコマンドを実行しますか？",
            "作業ディレクトリ：",
            "コマンド（原文）：",
            "実行",
            "キャンセル",
        ]
    } else if language == "ko" || language.starts_with("ko-") {
        [
            "WorkPlan — 명령 실행",
            "이 명령을 실행하시겠습니까?",
            "작업 디렉터리:",
            "명령 (전체 원문):",
            "실행",
            "취소",
        ]
    } else if language == "ru" || language.starts_with("ru-") {
        [
            "WorkPlan — Выполнение команды",
            "Выполнить эту команду?",
            "Рабочий каталог:",
            "Команда (точный текст):",
            "Выполнить",
            "Отмена",
        ]
    } else {
        [
            "WorkPlan — Execute command",
            "Execute this command?",
            "Working directory:",
            "Command (exact):",
            "Execute",
            "Cancel",
        ]
    };
    let [title, question, directory, command, execute, cancel] = labels;
    DialogText {
        title,
        question,
        directory,
        command,
        execute,
        cancel,
    }
}

fn confirmation_message(command: &str, cwd: &Path, text: &DialogText) -> String {
    format!(
        "{}\n\n{}\n{}\n\n{}\n{}",
        text.question,
        text.directory,
        cwd.display(),
        text.command,
        command
    )
}

fn await_approval(reservation: &Reservation, receiver: mpsc::Receiver<bool>) -> bool {
    loop {
        if !reservation.check_authorized() {
            return false;
        }
        match receiver.recv_timeout(POLL_INTERVAL) {
            Ok(approved) => return approved && reservation.check_authorized(),
            Err(mpsc::RecvTimeoutError::Disconnected) => return false,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

#[tauri::command]
pub fn get_command_execution_status(app: tauri::AppHandle) -> CommandExecutionStatus {
    app_service(&app).status()
}

#[tauri::command]
pub fn set_command_execution_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<CommandExecutionStatus, String> {
    app_service(&app).set_enabled(enabled)
}

#[tauri::command]
pub fn cancel_command_execution(request_id: String) -> Result<bool, String> {
    service().cancel(&request_id)
}

#[tauri::command]
pub async fn execute_command(
    app: tauri::AppHandle,
    request_id: String,
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CommandExecutionResult, String> {
    let mut result = CommandExecutionResult::new(request_id, command, Path::new(""));
    if let Err(error) = validate_command(&result.command) {
        result.error = Some(error);
        return Ok(result);
    }
    // Reserve synchronously, before scheduling work or showing a native dialog.
    // Disabled requests are rejected here, before resolving paths or prompting.
    let reservation = match app_service(&app).reserve(&result.request_id) {
        Ok(reservation) => reservation,
        Err(error) => {
            result.error = Some(error);
            return Ok(result);
        }
    };
    let cwd = match resolve_cwd(cwd.as_deref()) {
        Ok(cwd) => cwd,
        Err(error) => {
            result.error = Some(error);
            return Ok(result);
        }
    };
    result.cwd = cwd.to_string_lossy().into_owned();
    #[cfg(any(
        windows,
        target_os = "linux",
        target_os = "macos",
        target_os = "android"
    ))]
    {
        tauri::async_runtime::spawn_blocking(move || {
            if !reservation.check_authorized() {
                result.cancelled = true;
                return Ok(result);
            }
            let (sender, receiver) = mpsc::sync_channel(1);
            let text = dialog_text(crate::locale::current_language().as_deref());
            let dialog = app
                .dialog()
                .message(confirmation_message(&result.command, &cwd, &text))
                .title(text.title)
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    text.execute.into(),
                    text.cancel.into(),
                ));
            #[cfg(not(target_os = "android"))]
            let dialog = if let Some(window) = app.get_webview_window("main") {
                dialog.parent(&window)
            } else {
                dialog
            };
            dialog.show(move |approved| {
                let _ = sender.send(approved);
            });
            if !await_approval(&reservation, receiver) {
                let _ = reservation.service.cancel(&reservation.id);
                result.cancelled = true;
                return Ok(result);
            }
            let process = match reservation.spawn(&result.command, &cwd) {
                Ok(Some(process)) => process,
                Ok(None) => {
                    result.cancelled = true;
                    return Ok(result);
                }
                Err(error) => {
                    result.error = Some(error);
                    return Ok(result);
                }
            };
            Ok(run_engine(
                process,
                &reservation,
                timeout_duration(timeout_ms),
                result,
            ))
        })
        .await
        .map_err(|error| format!("COMMAND_EXECUTION_INTERNAL: {error}"))?
    }
    #[cfg(not(any(
        windows,
        target_os = "linux",
        target_os = "macos",
        target_os = "android"
    )))]
    {
        let _ = (app, reservation, cwd, timeout_ms);
        result.error = Some(UNSUPPORTED.into());
        Ok(result)
    }
}

enum PipeRead {
    Data(usize),
    Pending,
    Eof,
}

#[derive(Default)]
struct CapturedOutput {
    bytes: Vec<u8>,
    truncated: bool,
    eof: bool,
}

impl CapturedOutput {
    #[cfg(any(
        windows,
        target_os = "linux",
        target_os = "macos",
        target_os = "android"
    ))]
    fn drain(&mut self, pipe: &mut platform::Pipe) -> io::Result<()> {
        if self.eof {
            return Ok(());
        }
        let mut buffer = [0u8; 8192];
        // Always drain after reaching the capture limit, but share time with the
        // other pipe and cancellation checks even if a producer writes forever.
        for _ in 0..16 {
            match pipe.read_available(&mut buffer)? {
                PipeRead::Data(size) => {
                    let keep = size.min(MAX_OUTPUT_BYTES - self.bytes.len());
                    self.bytes.extend_from_slice(&buffer[..keep]);
                    self.truncated |= keep < size;
                }
                PipeRead::Pending => break,
                PipeRead::Eof => {
                    self.eof = true;
                    break;
                }
            }
        }
        Ok(())
    }

    fn finish(mut self) -> (String, bool) {
        let mut text = String::from_utf8_lossy(&self.bytes).into_owned();
        // Replacement characters can expand invalid UTF-8. Bound the actual
        // returned UTF-8 string too, without splitting a code point.
        if text.len() > MAX_OUTPUT_BYTES {
            let mut boundary = MAX_OUTPUT_BYTES;
            while !text.is_char_boundary(boundary) {
                boundary -= 1;
            }
            text.truncate(boundary);
            self.truncated = true;
        }
        (text, self.truncated)
    }
}

#[cfg(any(
    windows,
    target_os = "linux",
    target_os = "macos",
    target_os = "android"
))]
fn run_engine(
    mut process: platform::Process,
    reservation: &Reservation,
    timeout: Duration,
    mut result: CommandExecutionResult,
) -> CommandExecutionResult {
    // This function only accepts an already-created, owned native process.
    result.executed = true;
    let started = Instant::now();
    let mut stdout = CapturedOutput::default();
    let mut stderr = CapturedOutput::default();
    let mut stopping = None;
    loop {
        if stopping.is_none() {
            result.cancelled = reservation.is_cancelled();
            result.timed_out = !result.cancelled && started.elapsed() >= timeout;
            if result.cancelled || result.timed_out {
                if let Err(error) = process.terminate_tree() {
                    result.error = Some(error.to_string());
                }
                stopping = Some(Instant::now());
            }
        }
        for (output, pipe) in [
            (&mut stdout, &mut process.stdout),
            (&mut stderr, &mut process.stderr),
        ] {
            if let Err(error) = output.drain(pipe) {
                output.eof = true;
                output.truncated = true;
                result
                    .error
                    .get_or_insert_with(|| format!("Cannot read command output: {error}"));
            }
        }
        match process.try_wait() {
            Ok(Some(code)) => {
                result.exit_code = Some(code);
                if stopping.is_none() {
                    // Background descendants must not outlive the shell or hold
                    // the pipes open after its exit. Clean up the entire tree.
                    if let Err(error) = process.terminate_tree() {
                        result.error = Some(error.to_string());
                    }
                    stopping = Some(Instant::now());
                }
            }
            Ok(None) => {}
            Err(error) => {
                result
                    .error
                    .get_or_insert_with(|| format!("Cannot wait for command: {error}"));
                let _ = process.terminate_tree();
                stopping.get_or_insert_with(Instant::now);
            }
        }
        if result.exit_code.is_some() && stdout.eof && stderr.eof {
            break;
        }
        if stopping.is_some_and(|stop: Instant| stop.elapsed() >= CLEANUP_TIMEOUT) {
            stdout.truncated |= !stdout.eof;
            stderr.truncated |= !stderr.eof;
            break;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    (result.stdout, result.stdout_truncated) = stdout.finish();
    (result.stderr, result.stderr_truncated) = stderr.finish();
    result.output_truncated = result.stdout_truncated || result.stderr_truncated;
    result.duration_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
    result
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "android"))]
mod platform {
    use super::PipeRead;
    use std::{
        io::{self, Read},
        os::{
            fd::AsRawFd,
            unix::process::{CommandExt, ExitStatusExt},
        },
        path::Path,
        process::{Child, Command, Stdio},
    };

    pub(super) struct Pipe(Box<dyn Read + Send>);

    impl Pipe {
        fn new(pipe: impl Read + AsRawFd + Send + 'static) -> io::Result<Self> {
            let fd = pipe.as_raw_fd();
            // SAFETY: this is an owned, live pipe descriptor. Only its file
            // status flags are changed, before any reads occur.
            let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(Box::new(pipe)))
        }

        pub(super) fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<PipeRead> {
            match self.0.read(buffer) {
                Ok(0) => Ok(PipeRead::Eof),
                Ok(size) => Ok(PipeRead::Data(size)),
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                    ) =>
                {
                    Ok(PipeRead::Pending)
                }
                Err(error) => Err(error),
            }
        }
    }

    pub(super) struct Process {
        child: Option<Child>,
        group: i32,
        pub(super) stdout: Pipe,
        pub(super) stderr: Pipe,
    }

    impl Process {
        pub(super) fn spawn(command: &str, cwd: &Path) -> io::Result<Self> {
            let mut child = Command::new(super::shell_name().unwrap())
                .args(["-c", command])
                .current_dir(cwd)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                // Implemented in the child's pre-exec path by std: descendants
                // inherit this group on Linux, macOS and Android, under the app UID.
                .process_group(0)
                .spawn()?;
            let group = child.id() as i32;
            let pipes = (|| {
                Ok((
                    Pipe::new(
                        child
                            .stdout
                            .take()
                            .ok_or_else(|| io::Error::other("Missing stdout pipe"))?,
                    )?,
                    Pipe::new(
                        child
                            .stderr
                            .take()
                            .ok_or_else(|| io::Error::other("Missing stderr pipe"))?,
                    )?,
                ))
            })();
            match pipes {
                Ok((stdout, stderr)) => Ok(Self {
                    child: Some(child),
                    group,
                    stdout,
                    stderr,
                }),
                Err(error) => {
                    // SAFETY: group is the positive PID of the child we created.
                    unsafe {
                        libc::kill(-group, libc::SIGKILL);
                    }
                    let _ = child.kill();
                    reap(child);
                    Err(error)
                }
            }
        }

        pub(super) fn try_wait(&mut self) -> io::Result<Option<i32>> {
            self.child.as_mut().unwrap().try_wait().map(|status| {
                status.map(|status| {
                    status
                        .code()
                        .unwrap_or_else(|| 128 + status.signal().unwrap_or(0))
                })
            })
        }

        pub(super) fn terminate_tree(&mut self) -> io::Result<()> {
            // SAFETY: the child was started in its own process group. Negative
            // PID addresses that group; we never target group 0 or the app group.
            if unsafe { libc::kill(-self.group, libc::SIGKILL) } == 0 {
                return Ok(());
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ESRCH) {
                Ok(())
            } else {
                let _ = self.child.as_mut().unwrap().kill();
                Err(error)
            }
        }
    }

    fn reap(mut child: Child) {
        // No pipe reader is joined or left blocked. Reaping a killed process is
        // separate from the bounded command response (e.g. uninterruptible I/O).
        if !matches!(child.try_wait(), Ok(Some(_))) {
            let _ = std::thread::Builder::new()
                .name("workplan-command-reaper".into())
                .spawn(move || {
                    let _ = child.wait();
                });
        }
    }

    impl Drop for Process {
        fn drop(&mut self) {
            let _ = self.terminate_tree();
            if let Some(child) = self.child.take() {
                reap(child);
            }
        }
    }
}

#[cfg(all(
    test,
    any(
        windows,
        target_os = "linux",
        target_os = "macos",
        target_os = "android"
    )
))]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
            let root = std::env::temp_dir().join(format!("workplan-command-test-{suffix}"));
            fs::create_dir(&root).unwrap();
            Self {
                root: fs::canonicalize(root).unwrap(),
            }
        }

        fn settings(&self) -> PathBuf {
            self.root.join(SETTINGS_FILE)
        }

        fn service(&self, enabled: bool) -> Arc<ExecutionService> {
            let service = Arc::new(ExecutionService::default());
            service.initialize(Ok(self.settings()));
            if enabled {
                service.set_enabled(true).unwrap();
            }
            service
        }

        fn execute(&self, command: &str) -> CommandExecutionResult {
            let service = self.service(true);
            let reservation = service.reserve("fixture-command").unwrap();
            let process = reservation.spawn(command, &self.root).unwrap().unwrap();
            run_engine(
                process,
                &reservation,
                Duration::from_secs(10),
                CommandExecutionResult::new("fixture-command".into(), command.into(), &self.root),
            )
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            // Recursive cleanup is restricted to the canonical isolated fixture
            // under the system temp directory. No workspace/user files are used.
            let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
            let root = fs::canonicalize(&self.root).unwrap();
            assert!(root.starts_with(&temp) && root != temp);
            assert!(root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("workplan-command-test-"));
            fs::remove_dir_all(root).unwrap();
        }
    }

    fn script(windows: &str, unix: &str) -> String {
        if cfg!(windows) {
            windows.into()
        } else {
            unix.into()
        }
    }

    fn wait_for_file(path: &Path) {
        let deadline = Instant::now() + Duration::from_secs(8);
        while !path.is_file() {
            assert!(
                Instant::now() < deadline,
                "command did not create {}",
                path.display()
            );
            std::thread::sleep(POLL_INTERVAL);
        }
    }

    #[test]
    fn settings_default_off_and_disabled_requests_cannot_reach_approval() {
        let fixture = Fixture::new();
        let service = fixture.service(false);
        assert!(!service.status().enabled);
        assert!(service.status().supported);
        assert!(!fixture.settings().exists());
        assert!(service
            .reserve("disabled")
            .err()
            .unwrap()
            .starts_with("COMMAND_EXECUTION_DISABLED:"));
        assert!(service.lock().requests.is_empty());
    }

    #[test]
    fn settings_persist_separately_and_reload_native_state() {
        let fixture = Fixture::new();
        let service = fixture.service(true);
        assert!(service.status().enabled);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(fixture.settings()).unwrap())
                .unwrap(),
            serde_json::json!({"enabled": true})
        );
        assert!(fixture.service(false).status().enabled);
        assert!(!service.set_enabled(false).unwrap().enabled);
        assert!(!fixture.service(false).status().enabled);
        assert!(fs::read_dir(&fixture.root)
            .unwrap()
            .all(|entry| entry.unwrap().file_name() == SETTINGS_FILE));
    }

    #[test]
    fn malformed_missing_and_unreadable_settings_fail_closed() {
        let fixture = Fixture::new();
        for bytes in [
            b"{".as_slice(),
            b"{}",
            b"{\"enabled\":\"true\"}",
            b"{\"enabled\":true,\"other\":1}",
        ] {
            fs::write(fixture.settings(), bytes).unwrap();
            assert!(!fixture.service(false).status().enabled);
        }
        fs::write(fixture.settings(), vec![b' '; 4097]).unwrap();
        assert!(!fixture.service(false).status().enabled);
        fs::remove_file(fixture.settings()).unwrap();
        fs::create_dir(fixture.settings()).unwrap();
        assert!(!fixture.service(false).status().enabled);
        let unavailable = Arc::new(ExecutionService::default());
        unavailable.initialize(Err("fixture app data path unavailable".into()));
        assert!(!unavailable.status().enabled);
        assert!(unavailable.set_enabled(true).is_err());
    }

    #[test]
    fn persistence_failure_disables_and_revokes_even_if_enabling() {
        let fixture = Fixture::new();
        let service = fixture.service(true);
        let reservation = service.reserve("write-failure").unwrap();
        fs::remove_file(fixture.settings()).unwrap();
        fs::create_dir(fixture.settings()).unwrap();
        assert!(service.set_enabled(true).is_err());
        assert!(!service.status().enabled);
        assert!(reservation.is_cancelled());
        assert!(reservation
            .spawn("exit 0", &fixture.root)
            .unwrap()
            .is_none());
    }

    #[test]
    fn disable_failure_still_revokes_and_does_not_reenable_in_memory() {
        let fixture = Fixture::new();
        let service = fixture.service(true);
        let reservation = service.reserve("disable-failure").unwrap();
        fs::remove_file(fixture.settings()).unwrap();
        fs::create_dir(fixture.settings()).unwrap();
        assert!(service.set_enabled(false).is_err());
        assert!(!service.status().enabled);
        assert!(reservation.is_cancelled());
    }

    #[test]
    fn read_failure_after_enable_revokes_before_spawn() {
        let fixture = Fixture::new();
        let service = fixture.service(true);
        let reservation = service.reserve("read-failure").unwrap();
        fs::write(fixture.settings(), b"broken").unwrap();
        assert!(reservation
            .spawn("exit 0", &fixture.root)
            .unwrap()
            .is_none());
        assert!(reservation.is_cancelled());
        assert!(!service.status().enabled);
    }

    #[test]
    fn duplicates_are_reserved_before_approval() {
        let fixture = Fixture::new();
        let service = fixture.service(true);
        let reservation = service.reserve("same-id").unwrap();
        assert!(service
            .reserve("same-id")
            .err()
            .unwrap()
            .starts_with("COMMAND_EXECUTION_DUPLICATE:"));
        assert_eq!(service.lock().requests.len(), 1);
        drop(reservation);
        assert!(service.lock().requests.is_empty());
        assert!(service
            .reserve("same-id")
            .err()
            .unwrap()
            .starts_with("COMMAND_EXECUTION_DUPLICATE:"));
    }

    #[test]
    fn early_cancellation_survives_late_native_initialization_and_reuse() {
        let fixture = Fixture::new();
        let service = Arc::new(ExecutionService::default());
        assert!(service.cancel("cancel-before-execute").unwrap());
        service.initialize(Ok(fixture.settings()));
        service.set_enabled(true).unwrap();
        for _ in 0..2 {
            let reservation = service.reserve("cancel-before-execute").unwrap();
            assert!(reservation.is_cancelled());
            assert!(reservation
                .spawn("exit 0", &fixture.root)
                .unwrap()
                .is_none());
        }
    }

    #[test]
    fn cancellation_stops_waiting_for_dialog_and_late_acceptance_cannot_spawn() {
        let fixture = Fixture::new();
        let service = fixture.service(true);
        let reservation = service.reserve("pending-dialog").unwrap();
        let (sender, receiver) = mpsc::sync_channel(1);
        let waiter = std::thread::spawn(move || {
            assert!(!await_approval(&reservation, receiver));
            reservation
        });
        service.cancel("pending-dialog").unwrap();
        let reservation = waiter.join().unwrap();
        let _ = sender.send(true);
        assert!(reservation
            .spawn("exit 0", &fixture.root)
            .unwrap()
            .is_none());
        assert!(reservation.is_cancelled());
    }

    #[test]
    fn disable_then_reenable_does_not_revive_pending_approval() {
        let fixture = Fixture::new();
        let service = fixture.service(true);
        let reservation = service.reserve("revoked-dialog").unwrap();
        service.set_enabled(false).unwrap();
        service.set_enabled(true).unwrap();
        let (sender, receiver) = mpsc::sync_channel(1);
        sender.send(true).unwrap();
        assert!(!await_approval(&reservation, receiver));
        assert!(reservation
            .spawn("exit 0", &fixture.root)
            .unwrap()
            .is_none());
        drop(reservation);
        assert!(service.reserve("revoked-dialog").unwrap().is_cancelled());
    }

    #[test]
    fn accepted_approval_is_rechecked_atomically_before_spawn() {
        let fixture = Fixture::new();
        let service = fixture.service(true);
        let reservation = service.reserve("accepted-then-cancelled").unwrap();
        let (sender, receiver) = mpsc::sync_channel(1);
        sender.send(true).unwrap();
        assert!(await_approval(&reservation, receiver));
        service.cancel("accepted-then-cancelled").unwrap();
        assert!(reservation
            .spawn("exit 0", &fixture.root)
            .unwrap()
            .is_none());
    }

    #[test]
    fn native_rejection_and_missing_dialog_response_do_not_authorize() {
        let fixture = Fixture::new();
        let service = fixture.service(true);
        let reservation = service.reserve("rejected").unwrap();
        let (sender, receiver) = mpsc::sync_channel(1);
        sender.send(false).unwrap();
        assert!(!await_approval(&reservation, receiver));
        let (sender, receiver) = mpsc::sync_channel(1);
        drop(sender);
        assert!(!await_approval(&reservation, receiver));
    }

    #[test]
    fn exact_command_and_resolved_directory_are_preserved_in_confirmation() {
        let fixture = Fixture::new();
        let cwd = resolve_cwd(Some(fixture.root.to_str().unwrap())).unwrap();
        assert_eq!(cwd, fixture.root);
        let command = "  echo \"quoted\" & '$value' \\path\r\n  echo second\n";
        let message = confirmation_message(command, &cwd, &dialog_text(Some("en")));
        assert!(message.contains(cwd.to_str().unwrap()));
        assert!(message.ends_with(command));
        assert!(resolve_cwd(Some(fixture.root.join("missing").to_str().unwrap())).is_err());
        fs::write(fixture.root.join("file.txt"), "fixture").unwrap();
        assert!(resolve_cwd(Some(fixture.root.join("file.txt").to_str().unwrap())).is_err());
    }

    #[test]
    fn command_and_timeout_limits_match_ipc_contract() {
        assert!(validate_command("").is_err());
        assert!(validate_command(" \r\n ").is_err());
        assert!(validate_command("echo\0x").is_err());
        assert!(validate_command(&"x".repeat(16000)).is_ok());
        assert!(validate_command(&"x".repeat(16001)).is_err());
        assert!(validate_command(&"😀".repeat(8000)).is_ok());
        assert!(validate_command(&"😀".repeat(8001)).is_err());
        assert!(validate_request_id("").is_err());
        assert!(validate_request_id("line\nbreak").is_err());
        assert!(validate_request_id(&"x".repeat(257)).is_err());
        assert_eq!(timeout_duration(None), Duration::from_secs(60));
        assert_eq!(timeout_duration(Some(0)), Duration::from_secs(1));
        assert_eq!(timeout_duration(Some(u64::MAX)), Duration::from_secs(120));
    }

    #[test]
    fn actual_commands_capture_both_streams_quotes_and_nonzero_exit() {
        let fixture = Fixture::new();
        let command = script(
            r#"[Console]::Out.Write('hello "quoted" \ path'); [Console]::Error.Write('problem'); exit 7"#,
            r#"printf '%s' 'hello "quoted" \ path'; printf '%s' 'problem' >&2; exit 7"#,
        );
        let result = fixture.execute(&command);
        assert_eq!(result.command, command);
        assert_eq!(result.stdout, "hello \"quoted\" \\ path");
        assert_eq!(result.stderr, "problem");
        assert_eq!(result.exit_code, Some(7));
        assert!(result.executed);
        assert!(!result.timed_out && !result.cancelled && !result.output_truncated);
        assert!(result.error.is_none(), "{:?}", result.error);
        let json = serde_json::to_value(result).unwrap();
        for key in [
            "requestId",
            "executed",
            "exitCode",
            "timedOut",
            "cancelled",
            "outputTruncated",
            "stdoutTruncated",
            "stderrTruncated",
        ] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
    }

    #[test]
    fn actual_commands_run_in_the_requested_temporary_directory() {
        let fixture = Fixture::new();
        let result = fixture.execute(&script(
            "[Console]::Out.Write((Get-Location).ProviderPath); [IO.File]::WriteAllText('marker.txt','fixture')",
            "pwd; printf fixture > marker.txt",
        ));
        assert_eq!(result.exit_code, Some(0), "{result:?}");
        assert_eq!(
            fs::canonicalize(result.stdout.trim()).unwrap(),
            fixture.root
        );
        assert_eq!(
            fs::read(fixture.root.join("marker.txt")).unwrap(),
            b"fixture"
        );
    }

    #[test]
    fn actual_unicode_stdout_and_stderr_are_utf8_including_chinese_and_emoji() {
        let fixture = Fixture::new();
        let command = script(
            "using namespace System\nparam()\n[Console]::Out.Write('中文 日本語 😀'); [Console]::Error.Write('错误 エラー 🚀')",
            "printf '%s' '中文 日本語 😀'; printf '%s' '错误 エラー 🚀' >&2",
        );
        let result = fixture.execute(&command);
        assert!(result.executed, "{result:?}");
        assert_eq!(result.exit_code, Some(0), "{result:?}");
        assert_eq!(result.stdout, "中文 日本語 😀");
        assert_eq!(result.stderr, "错误 エラー 🚀");
        assert!(!result.output_truncated);
    }

    #[test]
    fn unstarted_result_never_claims_execution_and_dialog_languages_are_available() {
        let fixture = Fixture::new();
        let result =
            CommandExecutionResult::new("unstarted".into(), "exit 0".into(), &fixture.root);
        assert!(!result.executed);
        assert_eq!(result.exit_code, None);
        for language in ["en", "zh", "zh-Hant", "ja", "ko", "ru"] {
            let text = dialog_text(Some(language));
            assert!(!text.title.is_empty() && !text.execute.is_empty() && !text.cancel.is_empty());
            let message = confirmation_message("  exit 0\n", &fixture.root, &text);
            assert!(message.ends_with("  exit 0\n"));
        }
        assert_eq!(dialog_text(Some("ja-JP")).execute, "実行");
        assert_eq!(dialog_text(Some("zh_TW.UTF-8")).execute, "執行");
        assert_eq!(dialog_text(None).execute, "Execute");
    }

    #[test]
    fn actual_command_timeout_returns_promptly_and_explicitly() {
        let fixture = Fixture::new();
        let service = fixture.service(true);
        let reservation = service.reserve("timeout").unwrap();
        let command = script("Start-Sleep -Seconds 30", "sleep 30");
        let process = reservation.spawn(&command, &fixture.root).unwrap().unwrap();
        let started = Instant::now();
        let result = run_engine(
            process,
            &reservation,
            timeout_duration(Some(1_000)),
            CommandExecutionResult::new("timeout".into(), command, &fixture.root),
        );
        assert!(result.timed_out && !result.cancelled, "{result:?}");
        assert!(started.elapsed() < Duration::from_secs(5), "{result:?}");
        assert!(result.exit_code.is_some(), "{result:?}");
    }

    #[test]
    fn actual_large_stdout_and_stderr_are_bounded_and_keep_draining() {
        let fixture = Fixture::new();
        let unix = format!("i=0; while [ \"$i\" -lt 2000 ]; do printf '%s' '{}'; printf '%s' '{}' >&2; i=$((i+1)); done; printf drained > drained.txt", "o".repeat(128), "e".repeat(128));
        let result = fixture.execute(&script(
            "[Console]::Out.Write(('o' * 256000)); [Console]::Error.Write(('e' * 256000)); [IO.File]::WriteAllText('drained.txt','drained')",
            &unix,
        ));
        assert_eq!(result.exit_code, Some(0), "{result:?}");
        assert_eq!(result.stdout.len(), MAX_OUTPUT_BYTES);
        assert_eq!(result.stderr.len(), MAX_OUTPUT_BYTES);
        assert!(result.stdout.bytes().all(|byte| byte == b'o'));
        assert!(result.stderr.bytes().all(|byte| byte == b'e'));
        assert!(result.output_truncated && result.stdout_truncated && result.stderr_truncated);
        assert!(!result.timed_out && !result.cancelled);
        assert_eq!(
            fs::read(fixture.root.join("drained.txt")).unwrap(),
            b"drained"
        );
    }

    #[test]
    fn invalid_utf8_cannot_expand_the_returned_output_beyond_the_limit() {
        let capture = CapturedOutput {
            bytes: vec![0xff; MAX_OUTPUT_BYTES],
            eof: true,
            truncated: false,
        };
        let (text, truncated) = capture.finish();
        assert!(text.len() <= MAX_OUTPUT_BYTES);
        assert!(truncated);
    }

    fn child_command(fixture: &Fixture, wait: bool) -> String {
        #[cfg(windows)]
        {
            fs::write(
                fixture.root.join("child.ps1"),
                "Start-Sleep -Seconds 30; [IO.File]::WriteAllText('child-survived.txt','bad')",
            )
            .unwrap();
            format!("$p = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-NonInteractive','-File','child.ps1') -NoNewWindow -PassThru; [IO.File]::WriteAllText('child.pid', [string]$p.Id); {}", if wait { "Start-Sleep -Seconds 30" } else { "[Console]::Out.Write('done'); exit 0" })
        }
        #[cfg(not(windows))]
        {
            let _ = fixture;
            format!(
                "(sleep 30; printf bad > child-survived.txt) & echo $! > child.pid; {}",
                if wait { "wait" } else { "printf done; exit 0" }
            )
        }
    }

    #[cfg(windows)]
    fn assert_child_exited(fixture: &Fixture) {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::{
            Foundation::WAIT_OBJECT_0,
            System::Threading::{OpenProcess, WaitForSingleObject},
        };
        let pid = fs::read_to_string(fixture.root.join("child.pid"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        // SYNCHRONIZE only: inspect the isolated child created by this test.
        let handle = unsafe { OpenProcess(0x00100000, 0, pid) };
        if !handle.is_null() {
            let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
            assert_eq!(
                unsafe { WaitForSingleObject(handle.as_raw_handle(), 1000) },
                WAIT_OBJECT_0,
                "command left a live child process"
            );
        }
        assert!(!fixture.root.join("child-survived.txt").exists());
    }

    #[test]
    fn actual_cancellation_terminates_the_child_tree() {
        let fixture = Fixture::new();
        let service = fixture.service(true);
        let reservation = service.reserve("running-cancel").unwrap();
        let command = child_command(&fixture, true);
        let process = reservation.spawn(&command, &fixture.root).unwrap().unwrap();
        let result = CommandExecutionResult::new("running-cancel".into(), command, &fixture.root);
        let runner = std::thread::spawn(move || {
            run_engine(process, &reservation, Duration::from_secs(15), result)
        });
        wait_for_file(&fixture.root.join("child.pid"));
        let cancelled_at = Instant::now();
        service.cancel("running-cancel").unwrap();
        let result = runner.join().unwrap();
        assert!(result.cancelled && !result.timed_out, "{result:?}");
        assert!(cancelled_at.elapsed() < Duration::from_secs(4));
        assert!(service.lock().requests.is_empty());
        #[cfg(windows)]
        assert_child_exited(&fixture);
    }

    #[test]
    fn actual_disable_cancels_running_command_and_pending_confirmation() {
        let fixture = Fixture::new();
        let service = fixture.service(true);
        let running = service.reserve("running-disable").unwrap();
        let pending = service.reserve("pending-disable").unwrap();
        let command = script(
            "[IO.File]::WriteAllText('started.txt','started'); Start-Sleep -Seconds 30",
            "printf started > started.txt; sleep 30",
        );
        let process = running.spawn(&command, &fixture.root).unwrap().unwrap();
        let result = CommandExecutionResult::new("running-disable".into(), command, &fixture.root);
        let runner = std::thread::spawn(move || {
            run_engine(process, &running, Duration::from_secs(15), result)
        });
        wait_for_file(&fixture.root.join("started.txt"));
        assert!(!service.set_enabled(false).unwrap().enabled);
        let result = runner.join().unwrap();
        assert!(result.cancelled && !result.timed_out, "{result:?}");
        assert!(pending.is_cancelled());
        assert!(pending.spawn("exit 0", &fixture.root).unwrap().is_none());
    }

    #[test]
    fn normal_shell_exit_cleans_up_descendants_holding_output_pipes() {
        let fixture = Fixture::new();
        let command = child_command(&fixture, false);
        let started = Instant::now();
        let result = fixture.execute(&command);
        assert_eq!(result.exit_code, Some(0), "{result:?}");
        assert_eq!(result.stdout, "done");
        assert!(!result.timed_out && !result.cancelled, "{result:?}");
        assert!(
            started.elapsed() < Duration::from_secs(6),
            "descendant held output pipes open"
        );
        #[cfg(windows)]
        assert_child_exited(&fixture);
    }
}

#[cfg(windows)]
mod platform {
    use super::PipeRead;
    use std::{
        ffi::OsStr,
        io,
        mem::{size_of, zeroed},
        os::windows::{
            ffi::OsStrExt,
            io::{AsRawHandle, FromRawHandle, OwnedHandle},
        },
        path::{Path, PathBuf},
        ptr::{null, null_mut},
    };
    use windows_sys::Win32::{
        Foundation::{
            SetHandleInformation, ERROR_BROKEN_PIPE, ERROR_NO_DATA, GENERIC_READ, HANDLE,
            HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, WAIT_FAILED, WAIT_OBJECT_0,
        },
        Security::SECURITY_ATTRIBUTES,
        Storage::FileSystem::{
            CreateFileW, ReadFile, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
        },
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Pipes::{CreatePipe, PeekNamedPipe},
            SystemInformation::GetSystemDirectoryW,
            Threading::{
                CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
                InitializeProcThreadAttributeList, ResumeThread, TerminateProcess,
                UpdateProcThreadAttribute, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
                EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST, STARTF_USESTDHANDLES, STARTUPINFOEXW,
            },
        },
    };

    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(Some(0)).collect()
    }

    fn raw(handle: &OwnedHandle) -> HANDLE {
        handle.as_raw_handle()
    }

    unsafe fn owned(handle: HANDLE) -> io::Result<OwnedHandle> {
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            Err(io::Error::last_os_error())
        } else {
            // SAFETY: the caller passes a newly created, uniquely owned handle.
            Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
        }
    }

    pub(super) struct Pipe(OwnedHandle);

    impl Pipe {
        fn new() -> io::Result<(Self, OwnedHandle)> {
            let mut read = null_mut();
            let mut write = null_mut();
            let attributes = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: null_mut(),
                bInheritHandle: 1,
            };
            // SAFETY: valid out parameters and attributes for anonymous pipes.
            if unsafe { CreatePipe(&mut read, &mut write, &attributes, 0) } == 0 {
                return Err(io::Error::last_os_error());
            }
            let read = unsafe { owned(read)? };
            let write = unsafe { owned(write)? };
            if unsafe { SetHandleInformation(raw(&read), HANDLE_FLAG_INHERIT, 0) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok((Self(read), write))
        }

        pub(super) fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<PipeRead> {
            let mut available = 0;
            // SAFETY: the live read handle is owned by this pipe. Peek makes the
            // subsequent read bounded by available bytes, so it cannot hang.
            if unsafe {
                PeekNamedPipe(
                    raw(&self.0),
                    null_mut(),
                    0,
                    null_mut(),
                    &mut available,
                    null_mut(),
                )
            } == 0
            {
                let error = io::Error::last_os_error();
                return if matches!(
                    error.raw_os_error().map(|code| code as u32),
                    Some(ERROR_BROKEN_PIPE | ERROR_NO_DATA)
                ) {
                    Ok(PipeRead::Eof)
                } else {
                    Err(error)
                };
            }
            if available == 0 {
                return Ok(PipeRead::Pending);
            }
            let mut read = 0;
            let count = available.min(buffer.len() as u32);
            if unsafe {
                ReadFile(
                    raw(&self.0),
                    buffer.as_mut_ptr(),
                    count,
                    &mut read,
                    null_mut(),
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(if read == 0 {
                PipeRead::Eof
            } else {
                PipeRead::Data(read as usize)
            })
        }
    }

    struct AttributeList {
        // usize gives the native attribute list the required pointer alignment.
        storage: Vec<usize>,
        initialized: bool,
    }

    impl AttributeList {
        fn new(handles: &mut [HANDLE]) -> io::Result<Self> {
            let mut bytes = 0;
            // SAFETY: the first call obtains the size; no list is used yet.
            unsafe {
                InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut bytes);
            }
            if bytes == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut list = Self {
                storage: vec![0; bytes.div_ceil(size_of::<usize>())],
                initialized: false,
            };
            if unsafe { InitializeProcThreadAttributeList(list.as_mut_ptr(), 1, 0, &mut bytes) }
                == 0
            {
                return Err(io::Error::last_os_error());
            }
            list.initialized = true;
            if unsafe {
                UpdateProcThreadAttribute(
                    list.as_mut_ptr(),
                    0,
                    PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                    handles.as_ptr().cast(),
                    size_of_val(handles),
                    null_mut(),
                    null(),
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(list)
        }

        fn as_mut_ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
            self.storage.as_mut_ptr().cast()
        }
    }

    impl Drop for AttributeList {
        fn drop(&mut self) {
            // SAFETY: this storage owns an initialized attribute list. Handles
            // referenced by the list are independently owned by the spawn scope.
            if self.initialized {
                unsafe {
                    DeleteProcThreadAttributeList(self.as_mut_ptr());
                }
            }
        }
    }

    fn powershell_path() -> io::Result<PathBuf> {
        // Do not search PATH or cwd for an executable named powershell. Use the
        // standard Windows installation, with no runas/UAC/token manipulation.
        let mut directory = vec![0u16; 32768];
        let count =
            unsafe { GetSystemDirectoryW(directory.as_mut_ptr(), directory.len() as u32) } as usize;
        if count == 0 || count >= directory.len() {
            return Err(io::Error::last_os_error());
        }
        use std::os::windows::ffi::OsStringExt;
        Ok(
            PathBuf::from(std::ffi::OsString::from_wide(&directory[..count]))
                .join("WindowsPowerShell/v1.0/powershell.exe"),
        )
    }

    fn quote(value: &OsStr) -> Vec<u16> {
        // Windows argv quoting: double backslashes only before a quote and the
        // final delimiter. The resulting -Command argument is the exact input.
        let mut output = vec![b'"' as u16];
        let mut slashes = 0;
        for unit in value.encode_wide() {
            if unit == b'\\' as u16 {
                slashes += 1;
                continue;
            }
            if unit == b'"' as u16 {
                output.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2 + 1));
            } else {
                output.extend(std::iter::repeat_n(b'\\' as u16, slashes));
            }
            slashes = 0;
            output.push(unit);
        }
        output.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
        output.push(b'"' as u16);
        output
    }

    fn powershell_script(command: &str) -> String {
        // Redirected Windows PowerShell otherwise uses the legacy system code
        // page and can irreversibly lose Unicode. Configure both console output
        // and native-pipeline input for UTF-8. Parse the ORIGINAL command as its
        // own script block so `using`, `param`, comments, and line breaks retain
        // their meaning; single-quote doubling preserves every input character.
        // The native confirmation always shows that original command verbatim.
        format!(
            "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; & ([scriptblock]::Create('{}'))",
            command.replace('\'', "''")
        )
    }

    pub(super) struct Process {
        process: OwnedHandle,
        job: OwnedHandle,
        pub(super) stdout: Pipe,
        pub(super) stderr: Pipe,
    }

    impl Process {
        pub(super) fn spawn(command: &str, cwd: &Path) -> io::Result<Self> {
            let executable = powershell_path()?;
            let application = wide(executable.as_os_str());
            let directory = wide(cwd.as_os_str());
            let mut command_line = quote(executable.as_os_str());
            command_line.extend(" -NoLogo -NoProfile -NonInteractive -Command ".encode_utf16());
            command_line.extend(quote(OsStr::new(&powershell_script(command))));
            command_line.push(0);
            if command_line.len() > 32767 {
                return Err(io::Error::other("Windows command line is too long"));
            }
            let (stdout, stdout_write) = Pipe::new()?;
            let (stderr, stderr_write) = Pipe::new()?;
            let attributes = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: null_mut(),
                bInheritHandle: 1,
            };
            let stdin = unsafe {
                owned(CreateFileW(
                    wide(OsStr::new("NUL")).as_ptr(),
                    GENERIC_READ,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    &attributes,
                    OPEN_EXISTING,
                    0,
                    null_mut(),
                ))?
            };
            let job = unsafe { owned(CreateJobObjectW(null(), null()))? };
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if unsafe {
                SetInformationJobObject(
                    raw(&job),
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of_val(&limits) as u32,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            let mut handles = [raw(&stdin), raw(&stdout_write), raw(&stderr_write)];
            let mut attribute_list = AttributeList::new(&mut handles)?;
            let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
            startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = raw(&stdin);
            startup.StartupInfo.hStdOutput = raw(&stdout_write);
            startup.StartupInfo.hStdError = raw(&stderr_write);
            startup.lpAttributeList = attribute_list.as_mut_ptr();
            let mut information: PROCESS_INFORMATION = unsafe { zeroed() };
            // Create SUSPENDED so no command (or grandchild) runs before job
            // assignment. The handle whitelist prevents leaking unrelated pipes
            // or app handles into the shell. No console window is created.
            if unsafe {
                CreateProcessW(
                    application.as_ptr(),
                    command_line.as_mut_ptr(),
                    null(),
                    null(),
                    1,
                    CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
                    null(),
                    directory.as_ptr(),
                    &startup.StartupInfo,
                    &mut information,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            let process = unsafe { owned(information.hProcess)? };
            let thread = unsafe { owned(information.hThread)? };
            if unsafe { AssignProcessToJobObject(raw(&job), raw(&process)) } == 0 {
                let error = io::Error::last_os_error();
                unsafe {
                    TerminateProcess(raw(&process), 1);
                    WaitForSingleObject(raw(&process), 1000);
                }
                return Err(error);
            }
            let child = Self {
                process,
                job,
                stdout,
                stderr,
            };
            if unsafe { ResumeThread(raw(&thread)) } == u32::MAX {
                return Err(io::Error::last_os_error());
            }
            Ok(child)
        }

        pub(super) fn try_wait(&mut self) -> io::Result<Option<i32>> {
            match unsafe { WaitForSingleObject(raw(&self.process), 0) } {
                WAIT_OBJECT_0 => {
                    let mut code = 0;
                    if unsafe { GetExitCodeProcess(raw(&self.process), &mut code) } == 0 {
                        Err(io::Error::last_os_error())
                    } else {
                        Ok(Some(code as i32))
                    }
                }
                WAIT_FAILED => Err(io::Error::last_os_error()),
                _ => Ok(None),
            }
        }

        pub(super) fn terminate_tree(&mut self) -> io::Result<()> {
            if unsafe { TerminateJobObject(raw(&self.job), 1) } == 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        }
    }

    impl Drop for Process {
        fn drop(&mut self) {
            let _ = self.terminate_tree();
            // Closing the last job handle is a second cleanup guarantee, even
            // during unwinding. It also kills descendants after normal exit.
        }
    }
}
