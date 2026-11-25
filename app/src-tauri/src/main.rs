//! HDM (Houssein Download Manager) desktop shell (Tauri 2).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod i18n;
mod integration;
mod ollama;
mod security;
#[cfg(target_os = "linux")]
mod sound;
mod tray;
mod windows;

use prism_core::events::{BatchInfo, CaptureInfo, CaptureSource, CoreEvent, VideoCapture};
use prism_core::manager::{Core, CoreOptions, NewItem};
use prism_core::settings::Settings;
use serde::Serialize;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_notification::NotificationExt;

pub(crate) static QUITTING: AtomicBool = AtomicBool::new(false);
/// Started with `--background` / `--minimized` (autostart at login passes `--background`).
pub(crate) static STARTED_IN_BACKGROUND: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HdmIntent {
    New { url: Option<String> },
    Capture { info: CaptureInfo },
    Video { info: VideoCapture },
    Torrent { source: String },
    Model { source: String },
    Batch { info: BatchInfo },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentEnvelope {
    pub seq: u64,
    #[serde(flatten)]
    pub intent: HdmIntent,
}

#[derive(Default)]
pub struct PendingIntents {
    next_seq: AtomicU64,
    queue: Mutex<Vec<IntentEnvelope>>,
}

impl PendingIntents {
    pub fn push(&self, intent: HdmIntent) -> IntentEnvelope {
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed) + 1;
        let env = IntentEnvelope { seq, intent };
        let mut q = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        if q.len() >= 64 {
            q.remove(0);
        }
        q.push(env.clone());
        env
    }

    pub fn drain(&self) -> Vec<IntentEnvelope> {
        let mut q = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        std::mem::take(&mut *q)
    }
}

pub fn push_ui_intent(app: &AppHandle, intent: HdmIntent) {
    let env = app.state::<PendingIntents>().push(intent);
    let _ = app.emit("hdm-intent", &env);
    windows::show_main(app);
}

fn main() {
    limit_malloc_arenas();
    let args: Vec<String> = std::env::args().collect();
    let background = args
        .iter()
        .any(|a| a == "--background" || a == "--minimized");
    STARTED_IN_BACKGROUND.store(background, Ordering::Relaxed);
    let _log_guard = init_logging();
    match prism_core::platform::desktop_session() {
        Some(session) => tracing::info!(%session, "HDM {} starting", prism_core::APP_VERSION),
        None => tracing::info!("HDM {} starting", prism_core::APP_VERSION),
    }
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!(
            "panic: {info}\n{}",
            std::backtrace::Backtrace::force_capture()
        );
        default_hook(info);
    }));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let background = argv.iter().any(|a| a == "--background");
            handle_args(app, &argv);
            if !background && open_targets(&argv).is_empty() {
                windows::show_main(app);
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin({
            use tauri_plugin_window_state::StateFlags;
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE - StateFlags::DECORATIONS)
                .map_label(windows::state_label)
                .with_filter(|label| label == "main")
                .build()
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let core = tauri::async_runtime::block_on(Core::start(CoreOptions::default()))
                .map_err(|e| format!("HDM failed to start: {e:#}"))?;
            app.manage(core.clone());
            app.manage(PendingIntents::default());
            tray::create(&handle)?;
            #[cfg(target_os = "macos")]
            mac_menu(&handle)?;
            spawn_event_forwarder(handle.clone(), core.clone());

            let settings = core.settings();
            if let Some(main) = app.get_webview_window("main") {
                apply_window_material(&main, &settings);
                windows::restore_main(&handle, &main);
                let show = settings.general.hide_tray_icon
                    || (!background && !settings.general.start_minimized);
                if show && windows::SHOW_ON_CREATE {
                    let _ = main.show();
                }
                if show {
                    let w = main.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                        if !w.is_visible().unwrap_or(true) {
                            let _ = w.show();
                        }
                    });
                } else {
                    windows::update_dock(&handle, false);
                    windows::release_main_later(&handle);
                }
            }
            std::thread::spawn(|| {
                integration::record_app_path();
                if let Err(e) = integration::register() {
                    tracing::warn!("native messaging registration failed: {e}");
                }
            });
            let h = handle.clone();
            std::thread::spawn(move || integration::refresh_extension_copies(&h));
            handle_args(&handle, &std::env::args().collect::<Vec<_>>());
            core.arm_wake_timers();
            if settings.video.auto_update {
                let c = core.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = c.ensure_tools().await {
                        tracing::warn!("video tools not ready: {e:#}");
                    }
                    let _ = c.update_ytdlp().await;
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && let WindowEvent::CloseRequested { api, .. } = event
                && !QUITTING.load(Ordering::SeqCst)
            {
                api.prevent_close();
                if window.state::<Core>().settings().general.close_to_tray {
                    let _ = window.hide();
                    windows::update_dock(window.app_handle(), false);
                    windows::release_main_later(window.app_handle());
                } else {
                    let app = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move { quit(&app).await });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::update_settings,
            commands::toggle_speed_limiter,
            commands::add_url,
            commands::get_capture,
            commands::confirm_capture,
            commands::cancel_capture,
            commands::reprobe_capture,
            commands::zip_contents,
            commands::extract_zip_file,
            commands::cancel_zip_file,
            commands::batch_from_pattern,
            commands::batch_from_text,
            commands::get_batch,
            commands::confirm_batch,
            commands::cancel_batch,
            commands::get_video,
            commands::open_video_url,
            commands::probe_video,
            commands::confirm_video,
            commands::cancel_video,
            commands::add_stream,
            commands::inspect_torrent,
            commands::read_torrent_file,
            commands::add_torrent,
            commands::recheck_torrent,
            commands::set_torrent_options,
            commands::hf_context,
            commands::hf_repo,
            commands::hf_search,
            commands::hf_present,
            commands::hf_add,
            commands::media_inspect,
            commands::media_plan,
            commands::media_start,
            commands::media_cancel,
            commands::media_jobs,
            commands::media_clear,
            commands::open_file,
            commands::reveal_path,
            commands::start_items,
            commands::pause_items,
            commands::pause_all,
            commands::resume_all,
            commands::delete_items,
            commands::restore_items,
            commands::empty_trash,
            commands::remove_completed,
            commands::redownload,
            commands::update_item,
            commands::item_details,
            commands::open_item,
            commands::reveal_item,
            commands::start_file_drag,
            commands::open_path,
            commands::assign_to_queue,
            commands::move_in_queue,
            commands::upsert_queue,
            commands::delete_queue,
            commands::start_queue,
            commands::stop_queue,
            commands::next_schedule_runs,
            commands::cancel_post_action,
            commands::upsert_category,
            commands::delete_category,
            commands::grabber_projects,
            commands::start_grabber,
            commands::stop_grabber,
            commands::delete_grabber_project,
            commands::download_grabbed,
            commands::export_list,
            commands::import_list,
            commands::export_settings,
            commands::import_settings,
            commands::export_diagnostics,
            commands::tool_status,
            commands::ensure_tools,
            commands::update_ytdlp,
            commands::integration_status,
            commands::repair_integration,
            commands::extension_dir,
            commands::extension_folder,
            commands::open_browser,
            commands::open_extension_store,
            commands::play_sound,
            commands::drain_ui_intents,
            commands::show_main,
            commands::main_window_starts_visible,
            commands::app_run_id,
            commands::set_ui_language,
            commands::remove_deleted_files,
            commands::set_autostart,
            commands::quit_app,
            commands::free_space,
            commands::data_dir,
            commands::clipboard_read,
            commands::clipboard_write,
            commands::hdm_confirm_capture,
            commands::verify_item_sha256,
            commands::clear_missing_completed,
            commands::run_speed_test,
            commands::hf_browse,
            ollama::ollama_search,
            ollama::ollama_model_tags,
            ollama::ollama_inspect_manifest,
            ollama::ollama_local_status,
            ollama::ollama_download,
            ollama::ollama_import_gguf,
            ollama::ollama_delete_local_model,
            ollama::system_hardware_info,
            ollama::list_local_gguf_models,
            ollama::delete_local_gguf,
            security::scan_download_url,
            security::scan_downloaded_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building HDM");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { api, code, .. } = &event
            && code.is_none()
            && !QUITTING.load(Ordering::SeqCst)
        {
            api.prevent_exit();
        }
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = &event {
            windows::show_main(app);
        }
        let _ = (app, event);
    });
}

#[cfg(target_os = "macos")]
fn mac_menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let menu = Menu::default(app)?;
    if let Some(first) = menu.items()?.into_iter().next()
        && let Some(sub) = first.as_submenu()
    {
        let show = MenuItem::with_id(app, "show-main", "Show HDM", true, Some("CmdOrCtrl+0"))?;
        sub.insert(&show, 1)?;
        sub.insert(&PredefinedMenuItem::separator(app)?, 2)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == "show-main" {
            windows::show_main(app);
        }
    });
    Ok(())
}

/// Graceful exit: checkpoint every download, then quit.
pub async fn quit(app: &AppHandle) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(core) = app.try_state::<Core>() {
        core.shutdown().await;
    }
    app.exit(0);
}

/// Apply settings that live in the shell (autostart, tray state).
pub fn apply_shell_settings(app: &AppHandle, settings: &Settings) {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    let enabled = al.is_enabled().unwrap_or(false);
    if settings.general.launch_at_startup != enabled {
        let _ = if settings.general.launch_at_startup {
            al.enable()
        } else {
            al.disable()
        };
    }
    if let Some(main) = app.get_webview_window("main") {
        apply_window_material(&main, settings);
    }
    windows::update_dock(app, windows::main_is_open(app));
    tray::refresh(app);
    tray::sync_visibility(app, settings.general.hide_tray_icon);
}

pub(crate) fn apply_window_material(window: &tauri::WebviewWindow, _settings: &Settings) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            use windows_sys::Win32::Graphics::Dwm::{
                DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DwmSetWindowAttribute,
            };
            let pref = DWMWCP_ROUND;
            unsafe {
                DwmSetWindowAttribute(
                    hwnd.0 as _,
                    DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                    &pref as *const _ as *const core::ffi::c_void,
                    std::mem::size_of_val(&pref) as u32,
                );
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = window;
}

/// URLs / files passed on the command line (file associations, magnet handler, "Open with").
fn open_targets(argv: &[String]) -> Vec<String> {
    argv.iter()
        .skip(1)
        .filter(|a| !a.starts_with("--"))
        .filter(|a| {
            a.starts_with("magnet:")
                || a.contains("://")
                || a.to_ascii_lowercase().ends_with(".torrent")
        })
        .map(|a| local_path(a).unwrap_or_else(|| a.clone()))
        .collect()
}

/// Linux desktops may hand a file over as a `file://` URL (the launcher's `Exec=hdm %U`).
fn local_path(arg: &str) -> Option<String> {
    if !arg.starts_with("file://") {
        return None;
    }
    let path = tauri::Url::parse(arg).ok()?.to_file_path().ok()?;
    Some(path.to_string_lossy().into_owned())
}

fn handle_args(app: &AppHandle, argv: &[String]) {
    let core = app.state::<Core>().inner().clone();
    for target in open_targets(argv) {
        let is_torrent_file = target.to_ascii_lowercase().ends_with(".torrent")
            && std::path::Path::new(&target).exists();
        if is_torrent_file || target.starts_with("magnet:") {
            push_ui_intent(app, HdmIntent::Torrent { source: target });
        } else {
            core.capture(
                NewItem {
                    url: target,
                    ..Default::default()
                },
                CaptureSource::Manual,
            );
        }
    }
}

fn limit_malloc_arenas() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    unsafe {
        libc::mallopt(libc::M_ARENA_MAX, 2);
    }
}

fn release_free_memory() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    std::thread::spawn(|| unsafe {
        libc::malloc_trim(0);
    });
}

fn spawn_event_forwarder(app: AppHandle, core: Core) {
    let mut rx = core.subscribe();
    tauri::async_runtime::spawn(async move {
        let mut was_active = None::<bool>;
        let mut last_tooltip = std::time::Instant::now();
        loop {
            let event = match rx.recv().await {
                Ok(e) => e,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("the windows missed {n} events; sending them the list again");
                    let _ = app.emit("core", &CoreEvent::ItemsAdded(core.bootstrap().items));
                    continue;
                }
                Err(_) => break,
            };
            side_effects(&app, &core, &event, &mut was_active, &mut last_tooltip);
            let _ = app.emit("core", &event);
        }
    });
}

/// A file of a Hugging Face model downloading in its queue (one notification when the queue finishes).
fn in_model_queue(item: &prism_core::model::DownloadItem) -> bool {
    item.queue_id.as_deref() == Some(prism_core::huggingface::QUEUE_ID)
}

fn side_effects(
    app: &AppHandle,
    core: &Core,
    event: &CoreEvent,
    was_active: &mut Option<bool>,
    last_tooltip: &mut std::time::Instant,
) {
    let settings = core.settings();
    let notify = |title: &str, body: &str| {
        if settings.general.notifications {
            let title = i18n::tr(title, &[]);
            let _ = app.notification().builder().title(title).body(body).show();
        }
    };
    match event {
        CoreEvent::CaptureRequested(info) => {
            push_ui_intent(app, HdmIntent::Capture { info: info.clone() });
        }
        CoreEvent::BatchRequested(info) => {
            push_ui_intent(app, HdmIntent::Batch { info: info.clone() });
        }
        CoreEvent::VideoRequested(info) => {
            push_ui_intent(app, HdmIntent::Video { info: info.clone() });
        }
        CoreEvent::Completed(item) => {
            if !in_model_queue(item) {
                notify("Download complete", &item.file_name);
            }
        }
        CoreEvent::Failed(item) => {
            notify(
                "Download failed",
                &format!(
                    "{}\n{}",
                    item.file_name,
                    item.error.clone().unwrap_or_default()
                ),
            );
        }
        CoreEvent::QueueFinished { name, .. } => notify(
            "Queue finished",
            &i18n::tr("{name} has no more downloads.", &[("name", name)]),
        ),
        CoreEvent::Notify { title, body } => notify(title, body),
        CoreEvent::LeftToBrowser { host } => notify(
            "Downloading in the browser",
            &i18n::tr(
                "{host} lets only a web browser download this file, so the browser is downloading it.",
                &[("host", host)],
            ),
        ),
        CoreEvent::OpenTorrent { source } => {
            push_ui_intent(
                app,
                HdmIntent::Torrent {
                    source: source.clone(),
                },
            );
        }
        CoreEvent::OpenModel { source } => {
            push_ui_intent(
                app,
                HdmIntent::Model {
                    source: source.clone(),
                },
            );
        }
        CoreEvent::MediaJob(job) => {
            use prism_core::media::{JobState, MediaOp};
            let took = job.finished_at.zip(job.started_at).map(|(b, a)| b - a);
            let looking = app
                .webview_windows()
                .values()
                .any(|w| w.is_focused().unwrap_or(false));
            if took.is_some_and(|ms| ms >= 10_000) && !looking {
                let output = job
                    .output
                    .as_ref()
                    .and_then(|p| p.file_name())
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| job.name.clone());
                match (job.state, &job.op) {
                    (JobState::Done, MediaOp::Shrink { .. }) => {
                        notify("Smaller file ready", &output)
                    }
                    (JobState::Done, MediaOp::Zip) => notify("ZIP file ready", &output),
                    (JobState::Done, _) => notify("Conversion finished", &output),
                    (JobState::Failed, _) => notify("Conversion failed", &job.name),
                    _ => {}
                }
            }
        }
        #[cfg(target_os = "linux")]
        CoreEvent::PlaySound { kind } if settings.sounds.enabled => sound::play(
            kind,
            &settings.sounds.complete_sound,
            settings.sounds.volume,
        ),
        CoreEvent::ShowMain => windows::show_main(app),
        CoreEvent::ExitRequested => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { quit(&app).await });
        }
        CoreEvent::ClipboardUrls(urls) if settings.clipboard.monitor => {
            if !settings.clipboard.ask {
                match core.add_copied_links(urls) {
                    Ok(items) if !items.is_empty() => {
                        let mut names: Vec<&str> =
                            items.iter().take(3).map(|i| i.file_name.as_str()).collect();
                        if items.len() > 3 {
                            names.push("…");
                        }
                        notify("Added to the list", &names.join("\n"));
                    }
                    Ok(_) => {}
                    Err(e) => tracing::error!("could not add the copied links: {e:#}"),
                }
            } else if urls.len() == 1 {
                core.capture(
                    NewItem {
                        url: urls[0].clone(),
                        ..Default::default()
                    },
                    CaptureSource::Clipboard,
                );
            } else {
                let entries = urls
                    .iter()
                    .map(|u| prism_core::events::BatchEntry {
                        url: u.clone(),
                        ..Default::default()
                    })
                    .collect();
                core.open_batch("Links from clipboard".into(), None, entries);
            }
        }
        CoreEvent::Progress(list) => {
            let active = list.len();
            let speed: u64 = list.iter().map(|p| p.speed).sum();
            let is_active = active > 0;
            if *was_active != Some(is_active) || last_tooltip.elapsed().as_secs() >= 1 {
                if *was_active == Some(true) && !is_active {
                    release_free_memory();
                }
                tray::update(app, active, speed, *was_active != Some(is_active));
                *was_active = Some(is_active);
                *last_tooltip = std::time::Instant::now();
            }
        }
        _ => {}
    }
    if matches!(
        event,
        CoreEvent::Completed(_) | CoreEvent::Failed(_) | CoreEvent::ItemUpdated(_)
    ) {
        let active = core.active_count();
        if active == 0 && *was_active == Some(true) {
            release_free_memory();
            tray::update(app, 0, 0, true);
            *was_active = Some(false);
        }
    }
}

fn init_logging() -> Option<tracing_appender::non_blocking::WorkerGuard> {
    use tracing_subscriber::{EnvFilter, fmt, prelude::*};
    let dir = prism_core::paths::logs_dir();
    std::fs::create_dir_all(&dir).ok()?;
    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("hdm")
        .filename_suffix("log")
        .max_log_files(7)
        .build(&dir)
        .ok()?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let filter = EnvFilter::try_from_env("HDM_LOG").unwrap_or_else(|_| {
        EnvFilter::new(
            "info,prism_core=info,prism_engine=info,hyper=warn,reqwest=warn,librqbit=warn",
        )
    });
    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(writer).with_ansi(false))
        .with(cfg!(debug_assertions).then(|| fmt::layer().with_writer(std::io::stderr)))
        .init();
    Some(guard)
}

#[cfg(test)]
mod tests {
    use super::open_targets;

    fn args(list: &[&str]) -> Vec<String> {
        std::iter::once("hdm")
            .chain(list.iter().copied())
            .map(String::from)
            .collect()
    }

    #[test]
    fn links_and_torrent_files_from_the_command_line() {
        assert_eq!(
            open_targets(&args(&[
                "--background",
                "magnet:?xt=urn:btih:abc",
                "https://example.com/a.zip",
                "notes.txt"
            ])),
            ["magnet:?xt=urn:btih:abc", "https://example.com/a.zip"]
        );
        assert_eq!(
            open_targets(&args(&["Linux ISO.torrent"])),
            ["Linux ISO.torrent"]
        );
    }

    #[test]
    fn a_file_url_becomes_a_path() {
        let (url, path) = if cfg!(windows) {
            (
                "file:///C:/Users/me/Linux%20ISO.torrent",
                r"C:\Users\me\Linux ISO.torrent",
            )
        } else {
            (
                "file:///home/me/Linux%20ISO.torrent",
                "/home/me/Linux ISO.torrent",
            )
        };
        assert_eq!(open_targets(&args(&[url])), [path]);
    }
}
