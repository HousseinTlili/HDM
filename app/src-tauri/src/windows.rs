//! Single-window management for the HDM desktop shell.

use prism_core::manager::Core;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
#[cfg(windows)]
use tauri::PhysicalPosition;
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder};

pub fn state_label(label: &str) -> &str {
    label
}

/// Windows (WebView2) keeps the window hidden until the first paint so no white frame shows.
/// macOS and Linux show immediately to avoid blank hidden WebKit surfaces.
pub const SHOW_ON_CREATE: bool = cfg!(any(target_os = "macos", target_os = "linux"));

#[cfg(not(target_os = "macos"))]
const RELEASE_HIDDEN_MAIN_AFTER: Duration = Duration::from_secs(60);

pub static MAIN_WANTED: AtomicBool = AtomicBool::new(false);
static CREATING_MAIN: AtomicBool = AtomicBool::new(false);
#[cfg(not(target_os = "macos"))]
static TRAY_TRIP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn show_main(app: &AppHandle) {
    MAIN_WANTED.store(true, Ordering::SeqCst);
    update_dock(app, true);
    #[cfg(not(target_os = "macos"))]
    TRAY_TRIP.fetch_add(1, Ordering::SeqCst);
    if CREATING_MAIN.load(Ordering::SeqCst) {
        return;
    }
    match app.get_webview_window("main") {
        Some(w) if cfg!(target_os = "linux") && !w.is_visible().unwrap_or(true) => {
            let _ = w.destroy();
            create_main(app);
        }
        Some(w) => {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        None => create_main(app),
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl Rect {
    fn overlap(&self, other: &Rect) -> u64 {
        let w =
            (self.x + self.width as i32).min(other.x + other.width as i32) - self.x.max(other.x);
        let h =
            (self.y + self.height as i32).min(other.y + other.height as i32) - self.y.max(other.y);
        if w > 0 && h > 0 {
            w as u64 * h as u64
        } else {
            0
        }
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn fit_into_work_area(window: Rect, work: Rect) -> Rect {
    let width = window.width.min(work.width);
    let height = window.height.min(work.height);
    let right = work.x + (work.width - width) as i32;
    let bottom = work.y + (work.height - height) as i32;
    Rect {
        x: window.x.clamp(work.x, right.max(work.x)),
        y: window.y.clamp(work.y, bottom.max(work.y)),
        width,
        height,
    }
}

#[cfg(windows)]
static MAIN_RECT: Mutex<Option<Rect>> = Mutex::new(None);

pub fn restore_main(app: &AppHandle, main: &WebviewWindow) {
    #[cfg(windows)]
    {
        if main.is_maximized().unwrap_or(false) || main.is_fullscreen().unwrap_or(false) {
            return;
        }
        let remembered = MAIN_RECT.lock().unwrap_or_else(|e| e.into_inner()).take();
        let Some(saved) = remembered.or_else(|| saved_main_rect(app)) else {
            return;
        };
        let (left, top) = match (main.outer_position(), main.inner_position()) {
            (Ok(outer), Ok(inner)) => (inner.x - outer.x, inner.y - outer.y),
            _ => (0, 0),
        };
        let content = Rect {
            x: saved.x + left,
            y: saved.y + top,
            ..saved
        };
        let Some(work) = main.available_monitors().ok().and_then(|monitors| {
            monitors
                .iter()
                .map(|m| {
                    let a = m.work_area();
                    Rect {
                        x: a.position.x,
                        y: a.position.y,
                        width: a.size.width,
                        height: a.size.height,
                    }
                })
                .max_by_key(|work| content.overlap(work))
                .filter(|work| content.overlap(work) > 0)
        }) else {
            return;
        };
        let fitted = fit_into_work_area(content, work);
        let _ = main.set_position(PhysicalPosition::new(fitted.x - left, fitted.y - top));
        let _ = main.set_size(tauri::PhysicalSize::new(fitted.width, fitted.height));
    }
    #[cfg(not(windows))]
    let _ = (app, main);
}

#[cfg(not(target_os = "macos"))]
fn remember_main(window: &WebviewWindow) {
    #[cfg(windows)]
    {
        if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
            return;
        }
        if let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) {
            *MAIN_RECT.lock().unwrap_or_else(|e| e.into_inner()) = Some(Rect {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            });
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

#[cfg(windows)]
fn saved_main_rect(app: &AppHandle) -> Option<Rect> {
    let path = app
        .path()
        .app_config_dir()
        .ok()?
        .join(tauri_plugin_window_state::DEFAULT_FILENAME);
    let state: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    let main = state.get("main")?;
    if main.get("maximized").and_then(|v| v.as_bool()) == Some(true) {
        return None;
    }
    let number = |key: &str| main.get(key).and_then(|v| v.as_i64());
    let (width, height) = (number("width")?, number("height")?);
    if width <= 0 || height <= 0 {
        return None;
    }
    Some(Rect {
        x: i32::try_from(number("x")?).ok()?,
        y: i32::try_from(number("y")?).ok()?,
        width: u32::try_from(width).ok()?,
        height: u32::try_from(height).ok()?,
    })
}

fn create_main(app: &AppHandle) {
    if CREATING_MAIN.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        for _ in 0..60 {
            if app.get_webview_window("main").is_none() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let built = (|| -> tauri::Result<WebviewWindow> {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|c| c.label == "main")
                .cloned()
                .ok_or(tauri::Error::WindowNotFound)?;
            WebviewWindowBuilder::from_config(&app, &config)?.build()
        })();
        CREATING_MAIN.store(false, Ordering::SeqCst);
        match built {
            Ok(window) => {
                tracing::info!("opened the main window again");
                crate::apply_window_material(&window, &app.state::<Core>().settings());
                restore_main(&app, &window);
                if SHOW_ON_CREATE {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                std::thread::sleep(Duration::from_millis(1500));
                if !window.is_visible().unwrap_or(true) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            Err(e) => tracing::error!("could not open the main window: {e}"),
        }
    });
}

#[cfg(target_os = "macos")]
static DOCK_HIDDEN: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

pub fn update_dock(app: &AppHandle, main_open: bool) {
    #[cfg(target_os = "macos")]
    {
        let hide = !main_open && app.state::<Core>().settings().general.hide_dock_icon;
        if hide {
            DOCK_HIDDEN.store(1, Ordering::SeqCst);
            let _ = app.set_dock_visibility(false);
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1200));
                if DOCK_HIDDEN.load(Ordering::SeqCst) == 1 && !main_is_open(&app) {
                    let _ = app.set_dock_visibility(false);
                }
            });
        } else if DOCK_HIDDEN.swap(0, Ordering::SeqCst) == 1 {
            let _ = app.set_dock_visibility(true);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, main_open);
}

pub fn main_is_open(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .is_some_and(|w| w.is_visible().unwrap_or(false))
}

pub fn release_main_later(app: &AppHandle) {
    #[cfg(not(target_os = "macos"))]
    {
        let trip = TRAY_TRIP.fetch_add(1, Ordering::SeqCst) + 1;
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(RELEASE_HIDDEN_MAIN_AFTER);
            if TRAY_TRIP.load(Ordering::SeqCst) != trip || CREATING_MAIN.load(Ordering::SeqCst) {
                return;
            }
            if let Some(w) = app.get_webview_window("main")
                && !w.is_visible().unwrap_or(true)
            {
                tracing::info!("closed the hidden main window to free its memory");
                remember_main(&w);
                let _ = w.destroy();
            }
        });
    }
    #[cfg(target_os = "macos")]
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::{Rect, fit_into_work_area, state_label};

    const WORK: Rect = Rect {
        x: 0,
        y: 0,
        width: 2560,
        height: 1392,
    };

    #[test]
    fn a_window_that_fits_is_left_alone() {
        let window = Rect {
            x: 100,
            y: 100,
            width: 1320,
            height: 1000,
        };
        assert_eq!(fit_into_work_area(window, WORK), window);
    }

    #[test]
    fn a_window_that_grew_is_pulled_back_inside() {
        let grown = Rect {
            x: 290,
            y: 149,
            width: 1980,
            height: 1703,
        };
        assert_eq!(
            fit_into_work_area(grown, WORK),
            Rect {
                x: 290,
                y: 0,
                width: 1980,
                height: 1392
            }
        );
        let low = Rect {
            x: 100,
            y: 900,
            width: 1320,
            height: 1000,
        };
        assert_eq!(fit_into_work_area(low, WORK).y, 392);
        let wide = Rect {
            x: -500,
            y: -40,
            width: 3000,
            height: 700,
        };
        assert_eq!(
            fit_into_work_area(wide, WORK),
            Rect {
                x: 0,
                y: 0,
                width: 2560,
                height: 700
            }
        );
    }

    #[test]
    fn main_state_label_is_preserved() {
        assert_eq!(state_label("main"), "main");
    }

    #[test]
    fn the_monitor_a_window_is_mostly_on_wins() {
        let left = Rect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let window = Rect {
            x: -100,
            y: 50,
            width: 1300,
            height: 800,
        };
        assert!(window.overlap(&WORK) > window.overlap(&left));
        assert_eq!(window.overlap(&Rect { x: 5000, ..WORK }), 0);
    }
}
