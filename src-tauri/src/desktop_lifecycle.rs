use crate::Host;
use std::sync::atomic::Ordering;
use tauri::{Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[cfg(target_os = "macos")]
pub(crate) fn install_liquid_glass(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use window_vibrancy::{apply_liquid_glass, LiquidGlassOptions, NSGlassEffectViewStyle};

    let glass_window = window.clone();
    window.with_webview(move |webview| {
        // Keep the WebView inside the glass view so the native mpv view can
        // continue attaching beneath it in the same parent.
        let content = unsafe { &*(webview.inner() as *const objc2_app_kit::NSView) };
        let options = LiquidGlassOptions::new(NSGlassEffectViewStyle::Regular).content_view(content);
        if let Err(error) = apply_liquid_glass(&glass_window, options) {
            if !matches!(error, window_vibrancy::Error::UnsupportedPlatformVersion(_)) {
                log::warn!("Mac Liquid Glass unavailable: {error}");
            }
        } else if let Some(glass) = unsafe { content.superview() }.and_then(|view| view.downcast::<objc2_app_kit::NSGlassEffectView>().ok()) {
            // AppKit only guarantees the contentView stays above the glass.
            // window-vibrancy 0.8 adds an arbitrary subview, which can disappear
            // behind the effect after a relaunch or window restoration.
            glass.setContentView(Some(content));
        }
    })
}

fn main_window_activated(event: &tauri::WindowEvent, closed: bool, visible: bool, minimized: bool) -> bool {
    matches!(event, tauri::WindowEvent::Focused(true))
        || closed && visible && !minimized && matches!(event, tauri::WindowEvent::Resized(_))
}

pub(crate) fn on_main_window_event(app: &tauri::AppHandle, event: &tauri::WindowEvent) {
    let host = app.state::<Host>();
    let closed = host.window_closed.load(Ordering::SeqCst);
    let (visible, minimized) = if matches!(event, tauri::WindowEvent::Resized(_)) {
        app.get_webview_window("main").map(|main| (main.is_visible().unwrap_or(false), main.is_minimized().unwrap_or(true))).unwrap_or((false, true))
    } else { (false, false) };
    if main_window_activated(event, closed, visible, minimized) {
        host.window_closed.store(false, Ordering::SeqCst);
        crate::operating_mode::window_opened(app);
    }
}

#[cfg(test)]
mod activity_tests {
    use super::*;

    #[test]
    fn focus_and_taskbar_restore_count_as_window_activity() {
        assert!(main_window_activated(&tauri::WindowEvent::Focused(true), false, true, false));
        assert!(main_window_activated(&tauri::WindowEvent::Resized(PhysicalSize::new(800, 600)), true, true, false));
        assert!(!main_window_activated(&tauri::WindowEvent::Focused(false), false, true, false));
        assert!(!main_window_activated(&tauri::WindowEvent::Resized(PhysicalSize::new(800, 600)), true, true, true));
        assert!(!main_window_activated(&tauri::WindowEvent::Resized(PhysicalSize::new(800, 600)), true, false, false));
    }
}

pub(crate) fn show(app: &tauri::AppHandle) {
    app.state::<Host>().window_closed.store(false, Ordering::SeqCst);
    crate::operating_mode::window_opened(app);
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let _ = main.unminimize();
    if !crate::tv_presentation() {
        if let Err(error) = recover_window(&main) {
            log::warn!("Cannot recover Couch window: {error}");
        }
    }
    let _ = main.show();
    let _ = main.set_focus();
}

pub(crate) fn close(app: &tauri::AppHandle, api: &tauri::CloseRequestApi) {
    api.prevent_close();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        request_quit(app);
        return;
    }
    #[cfg(target_os = "linux")]
    {
        app.state::<Host>().window_closed.store(true, Ordering::SeqCst);
        if let Some(main) = app.get_webview_window("main") {
            let result = if linux_tray_usable(app) { main.hide() } else { main.minimize() };
            if let Err(error) = result {
                log::warn!("Cannot close Couch window: {error}");
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn linux_tray_available() -> bool {
    use dbus::blocking::Connection;
    use std::time::Duration;

    let Ok(connection) = Connection::new_session() else { return false };
    // A watcher can register icons without any tray host to display them.
    let host = connection
        .with_proxy("org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher", Duration::from_millis(200))
        .method_call::<(dbus::arg::Variant<bool>,), _, _, _>(
            "org.freedesktop.DBus.Properties",
            "Get",
            ("org.kde.StatusNotifierWatcher", "IsStatusNotifierHostRegistered"),
        )
        .is_ok_and(|(dbus::arg::Variant(registered),)| registered);
    // Tauri's Linux tray loads AppIndicator at runtime and panics if neither library exists.
    host && ["libayatana-appindicator3.so.1", "libappindicator3.so.1", "libayatana-appindicator3.so", "libappindicator3.so"]
        .iter()
        .any(|name| unsafe { libloading::Library::new(name) }.is_ok())
}

#[cfg(target_os = "linux")]
fn linux_tray_usable(app: &tauri::AppHandle) -> bool {
    app.tray_by_id("couch-desktop").is_some() && linux_tray_available()
}

#[cfg(target_os = "linux")]
pub(crate) fn install_linux_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, Submenu};
    use tauri::tray::TrayIconBuilder;

    let show_item = MenuItem::with_id(app, "show-couch", "Show Couch", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit-couch", "Quit Couch", true, Some("Ctrl+Q"))?;
    let application = Submenu::with_items(app, "Couch", true, &[&show_item, &quit])?;
    app.set_menu(Menu::with_items(app, &[&application])?)?;
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "show-couch" => show(app),
        "quit-couch" => request_quit(app),
        _ => {}
    });
    if linux_tray_available() {
        let tray_show = MenuItem::with_id(app, "show-couch", "Show Couch", true, None::<&str>)?;
        let tray_quit = MenuItem::with_id(app, "quit-couch", "Quit Couch", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&tray_show, &tray_quit])?;
        let mut tray = TrayIconBuilder::with_id("couch-desktop").menu(&menu);
        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }
        if let Err(error) = tray.build(app) {
            log::warn!("Linux tray unavailable; Close will minimize Couch: {error}");
        }
    }
    Ok(())
}

pub(crate) fn request_quit(app: &tauri::AppHandle) {
    let host = app.state::<Host>();
    if host.quit_pending.swap(true, Ordering::SeqCst) {
        log::info!("Quit request is already pending");
        return;
    }
    log::info!("Checking whether Quit interrupts local work");
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let reason = match crate::operating_mode::quit_interruption(&app).await {
            Ok(None) => {
                log::info!("Quit has no local interruption");
                app.state::<Host>().quit_confirmed.store(true, Ordering::SeqCst);
                app.exit(0);
                return;
            }
            Ok(Some("playback")) => "Local playback is active. Quit Couch and stop playback?".to_string(),
            Ok(Some("sharing")) => "Remote control is enabled. Quit Couch and disconnect controllers?".to_string(),
            Ok(Some(_)) => "Local playback and remote control are active. Quit Couch and stop both?".to_string(),
            Err(error) => format!("Couch cannot check local playback or sharing ({error}). Quit and stop the local host?"),
        };
        log::info!("Showing Quit confirmation");
        show(&app);
        let Some(main) = app.get_webview_window("main") else {
            app.state::<Host>()
                .quit_pending
                .store(false, Ordering::SeqCst);
            return;
        };
        let answer_app = app.clone();
        app.dialog()
            .message(reason)
            .title("Quit Couch?")
            .parent(&main)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Quit".into(),
                "Cancel".into(),
            ))
            .show(move |confirmed| {
                log::info!("Quit confirmation: {confirmed}");
                let host = answer_app.state::<Host>();
                if confirmed {
                    host.quit_confirmed.store(true, Ordering::SeqCst);
                    answer_app.exit(0);
                } else {
                    host.quit_pending.store(false, Ordering::SeqCst);
                }
            });
    });
}

fn visible_area(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor: PhysicalPosition<i32>,
    bounds: PhysicalSize<u32>,
) -> u64 {
    let left = i64::from(position.x).max(i64::from(monitor.x));
    let top = i64::from(position.y).max(i64::from(monitor.y));
    let right = (i64::from(position.x) + i64::from(size.width))
        .min(i64::from(monitor.x) + i64::from(bounds.width));
    let bottom = (i64::from(position.y) + i64::from(size.height))
        .min(i64::from(monitor.y) + i64::from(bounds.height));
    (right - left).max(0) as u64 * (bottom - top).max(0) as u64
}

pub(crate) fn recover_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let position = window.outer_position()?;
    let mut size = window.outer_size()?;
    let monitors = window.available_monitors()?;
    let Some(monitor) = window
        .current_monitor()?
        .or_else(|| monitors.first().cloned())
    else {
        return Ok(());
    };
    if !window.is_maximized()?
        && (size.width > monitor.size().width || size.height > monitor.size().height)
    {
        size = PhysicalSize::new(
            size.width.min(monitor.size().width),
            size.height.min(monitor.size().height),
        );
        window.set_size(size)?;
    }
    if monitors.iter().any(|monitor| {
        visible_area(position, size, *monitor.position(), *monitor.size()) >= 160 * 100
    }) {
        return Ok(());
    }
    window.center()
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn install_desktop_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    #[cfg(target_os = "macos")]
    {
        let menu = Menu::default(app)?;
        if let Some(application) = menu
            .items()?
            .first()
            .and_then(|item| item.as_submenu())
            .cloned()
        {
            let last = application.items()?.len() - 1;
            application.remove_at(last)?;
            application.insert(
                &MenuItem::with_id(app, "show-couch", "Show Couch", true, None::<&str>)?,
                0,
            )?;
            application.append(&MenuItem::with_id(
                app,
                "quit-couch",
                "Quit Couch",
                true,
                Some("Cmd+Q"),
            )?)?;
        }
        app.set_menu(menu)?;
    }
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "show-couch" => show(app),
        "quit-couch" => request_quit(app),
        _ => {}
    });
    let show_item = MenuItem::with_id(app, "show-couch", "Show Couch", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit-couch", "Quit Couch", true, None::<&str>)?;
    let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;
    let mut tray = TrayIconBuilder::new().tooltip("Couch").menu(&tray_menu);
    #[cfg(target_os = "macos")]
    {
        tray = tray.icon(tauri::include_image!("./icons/tray-template.png")).icon_as_template(true);
    }
    #[cfg(target_os = "windows")]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_requires_a_usable_piece_of_a_current_display() {
        let window = PhysicalSize::new(900, 700);
        let display = PhysicalSize::new(1920, 1080);
        assert_eq!(
            visible_area((-2000, 100).into(), window, (0, 0).into(), display),
            0
        );
        assert_eq!(
            visible_area((-850, 100).into(), window, (0, 0).into(), display),
            35_000
        );
        assert_eq!(
            visible_area((-890, 100).into(), window, (0, 0).into(), display),
            7_000
        );
    }
}
