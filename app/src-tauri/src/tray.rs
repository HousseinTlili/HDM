//! System tray icon with a quick menu and live state (idle / downloading).

use crate::i18n::tr;
use prism_core::manager::Core;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

pub const TRAY_ID: &str = "hdm-tray";

/// Windows and Linux put the icon in the tray, macOS in the menu bar.
const HIDE_LABEL: &str = if cfg!(target_os = "macos") {
    "Hide menu bar icon"
} else {
    "Hide tray icon"
};

#[cfg(not(target_os = "macos"))]
static ICON_IDLE: &[u8] = include_bytes!("../icons/tray/tray-idle.png");
#[cfg(not(target_os = "macos"))]
static ICON_ACTIVE: &[u8] = include_bytes!("../icons/tray/tray-downloading.png");
#[cfg(target_os = "macos")]
static ICON_IDLE: &[u8] = include_bytes!("../icons/tray/tray-idle-template.png");
#[cfg(target_os = "macos")]
static ICON_ACTIVE: &[u8] = include_bytes!("../icons/tray/tray-downloading-template.png");
#[cfg(windows)]
static ICON_IDLE_LIGHT: &[u8] = include_bytes!("../icons/tray/tray-idle-light.png");
#[cfg(windows)]
static ICON_ACTIVE_LIGHT: &[u8] = include_bytes!("../icons/tray/tray-downloading-light.png");

/// Whether the icon shows downloads in progress (the last `update` that changed it).
static ACTIVE: AtomicBool = AtomicBool::new(false);

fn icon_bytes(active: bool) -> &'static [u8] {
    #[cfg(windows)]
    if taskbar::LIGHT.load(Ordering::Relaxed) {
        return if active {
            ICON_ACTIVE_LIGHT
        } else {
            ICON_IDLE_LIGHT
        };
    }
    if active { ICON_ACTIVE } else { ICON_IDLE }
}

fn set_icon(tray: &TrayIcon, active: bool) {
    if let Ok(img) = Image::from_bytes(icon_bytes(active)) {
        let _ = tray.set_icon(Some(img));
        let _ = tray.set_icon_as_template(cfg!(target_os = "macos"));
    }
}

/// Windows: whether the taskbar is light, watched so the icon follows changes immediately.
#[cfg(windows)]
mod taskbar {
    use std::sync::atomic::{AtomicBool, Ordering};
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_NOTIFY, KEY_READ};

    pub static LIGHT: AtomicBool = AtomicBool::new(false);
    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

    fn read(key: &RegKey) -> bool {
        key.get_value::<u32, _>("SystemUsesLightTheme")
            .is_ok_and(|v| v == 1)
    }

    pub fn watch(changed: impl Fn() + Send + 'static) {
        let Ok(key) =
            RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(KEY, KEY_READ | KEY_NOTIFY)
        else {
            return;
        };
        let light = read(&key);
        LIGHT.store(light, Ordering::Relaxed);
        tracing::info!("taskbar: {}", if light { "light" } else { "dark" });
        let spawned = std::thread::Builder::new()
            .name("taskbar-theme".into())
            .spawn(move || {
                use windows_sys::Win32::System::Registry::{
                    REG_NOTIFY_CHANGE_LAST_SET, RegNotifyChangeKeyValue,
                };
                loop {
                    let r = unsafe {
                        RegNotifyChangeKeyValue(
                            key.raw_handle() as _,
                            0,
                            REG_NOTIFY_CHANGE_LAST_SET,
                            std::ptr::null_mut(),
                            0,
                        )
                    };
                    if r != 0 {
                        tracing::warn!("taskbar theme: watching stopped ({r})");
                        return;
                    }
                    let light = read(&key);
                    if LIGHT.swap(light, Ordering::Relaxed) != light {
                        tracing::info!("taskbar: now {}", if light { "light" } else { "dark" });
                        changed();
                    }
                }
            });
        if let Err(e) = spawned {
            tracing::warn!("taskbar theme: {e}");
        }
    }
}

pub struct TrayState {
    pub limiter: CheckMenuItem<Wry>,
    items: Vec<(MenuItem<Wry>, &'static str)>,
}

pub fn create(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, tr(text, &[]), true, None::<&str>);
    let show = item("show", "Open HDM")?;
    let add = item("add", "New Download…")?;
    let pause = item("pause_all", "Pause all")?;
    let resume = item("resume_all", "Resume all")?;
    let limiter_on = app
        .state::<Core>()
        .settings()
        .downloads
        .speed_limiter_enabled;
    let limiter = CheckMenuItem::with_id(
        app,
        "limiter",
        tr("Speed limiter", &[]),
        true,
        limiter_on,
        None::<&str>,
    )?;
    let hide = item("hide_tray", HIDE_LABEL)?;
    let quit = item("quit", "Quit HDM")?;
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &add,
            &sep()?,
            &pause,
            &resume,
            &limiter,
            &sep()?,
            &hide,
            &quit,
        ],
    )?;
    app.manage(TrayState {
        limiter: limiter.clone(),
        items: vec![
            (show.clone(), "Open HDM"),
            (add.clone(), "New Download…"),
            (pause.clone(), "Pause all"),
            (resume.clone(), "Resume all"),
            (hide.clone(), HIDE_LABEL),
            (quit.clone(), "Quit HDM"),
        ],
    });

    #[cfg(windows)]
    {
        let app = app.clone();
        taskbar::watch(move || {
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                set_icon(&tray, ACTIVE.load(Ordering::Relaxed));
            }
        });
    }

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(icon_bytes(false))?)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("HDM")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let app = app.clone();
            match event.id().as_ref() {
                "show" => crate::windows::show_main(&app),
                "add" => {
                    crate::push_ui_intent(&app, crate::HdmIntent::New { url: None });
                }
                "pause_all" => app.state::<Core>().pause_all(),
                "resume_all" => app.state::<Core>().resume_all(),
                "limiter" => {
                    let _ = app.state::<Core>().toggle_speed_limiter();
                    refresh(&app);
                }
                "hide_tray" => {
                    let _ = app.state::<Core>().update_settings(&serde_json::json!({
                        "general": { "hideTrayIcon": true }
                    }));
                    if !crate::windows::main_is_open(&app) {
                        crate::windows::show_main(&app);
                    }
                    sync_visibility(&app, true);
                }
                "quit" => {
                    tauri::async_runtime::spawn(async move { crate::quit(&app).await });
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::windows::show_main(tray.app_handle());
            }
        })
        .build(app)?;
    if app.state::<Core>().settings().general.hide_tray_icon {
        sync_visibility(app, true);
    }
    Ok(tray)
}

pub fn sync_visibility(app: &AppHandle, hidden: bool) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(!hidden);
    }
}

pub fn refresh(app: &AppHandle) {
    let on = app
        .state::<Core>()
        .settings()
        .downloads
        .speed_limiter_enabled;
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.limiter.set_checked(on);
    }
}

pub fn relabel(app: &AppHandle) {
    if let Some(state) = app.try_state::<TrayState>() {
        for (item, text) in &state.items {
            let _ = item.set_text(tr(text, &[]));
        }
        let _ = state.limiter.set_text(tr("Speed limiter", &[]));
    }
}

pub fn update(app: &AppHandle, active: usize, speed: u64, icon_changed: bool) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let tooltip = if active == 0 {
        tr("HDM — idle", &[])
    } else {
        tr(
            "HDM — {count} downloading · {speed}",
            &[
                ("count", &active.to_string()),
                ("speed", &human_speed(speed)),
            ],
        )
    };
    let _ = tray.set_tooltip(Some(tooltip));
    if !icon_changed {
        return;
    }
    ACTIVE.store(active != 0, Ordering::Relaxed);
    set_icon(&tray, active != 0);
}

fn human_speed(bps: u64) -> String {
    const UNITS: [&str; 4] = ["B/s", "KB/s", "MB/s", "GB/s"];
    let mut v = bps as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{v:.0} {}", UNITS[i])
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}
