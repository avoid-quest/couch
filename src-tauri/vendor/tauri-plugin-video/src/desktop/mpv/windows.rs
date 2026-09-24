use std::sync::mpsc;

use libmpv2::{Mpv, MpvInitializer};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use windows::{
    core::w,
    Win32::{
        Foundation::HWND,
        UI::{
            HiDpi::GetDpiForWindow,
            WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, SetWindowPos, HWND_TOP, SWP_NOACTIVATE,
                SWP_NOOWNERZORDER, SWP_SHOWWINDOW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
                WS_DISABLED, WS_EX_NOACTIVATE,
            },
        },
    },
};

use crate::{Error, Result};

// An HWND is created, positioned and destroyed on Tauri's UI thread. The caller
// waits without a timeout so a queued ownership change cannot run after a retry.
fn ui<R: Runtime, T: Send + 'static>(
    window: &WebviewWindow<R>,
    operation: impl FnOnce(WebviewWindow<R>) -> Result<T> + Send + 'static,
) -> Result<T> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let owned = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = sender.send(operation(owned));
        })
        .map_err(|error| Error::Pipeline(error.to_string()))?;
    receiver
        .recv()
        .map_err(|error| Error::Pipeline(error.to_string()))?
}

pub(super) struct Surface<R: Runtime> {
    window: WebviewWindow<R>,
    child: usize,
}

impl<R: Runtime> Surface<R> {
    pub fn new(app: &AppHandle<R>) -> Result<Self> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| Error::Pipeline("Main window is unavailable".into()))?;
        let child = ui(&window, |window| {
            window
                .as_ref()
                .set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)))
                .map_err(|error| Error::Pipeline(error.to_string()))?;
            let parent = window
                .hwnd()
                .map_err(|error| Error::Pipeline(error.to_string()))?;
            let child = unsafe {
                CreateWindowExW(
                    WS_EX_NOACTIVATE,
                    w!("STATIC"),
                    w!("Couch video"),
                    WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | WS_DISABLED,
                    0,
                    0,
                    1,
                    1,
                    Some(parent),
                    None,
                    None,
                    None,
                )
            }
            .map_err(|error| Error::Pipeline(format!("Could not create video HWND: {error}")))?;
            Ok(child.0 as usize)
        })?;
        Ok(Self { window, child })
    }

    pub fn configure(&self, init: &MpvInitializer) -> libmpv2::Result<()> {
        init.set_option("wid", i64::from(self.child as u32))?;
        init.set_option("vo", "gpu")?;
        init.set_option("gpu-api", "d3d11")?;
        init.set_option("gpu-context", "d3d11")
    }

    pub fn attach(&mut self, _: &Mpv) -> Result<()> {
        Ok(())
    }

    pub fn layout(&self, x: f64, y: f64, width: f64, height: f64) -> Result<()> {
        if ![x, y, width, height].iter().all(|value| value.is_finite()) {
            return Err(Error::InvalidRequest("Non-finite video rectangle".into()));
        }
        let child = self.child;
        ui(&self.window, move |window| {
            let parent = window
                .hwnd()
                .map_err(|error| Error::Pipeline(error.to_string()))?;
            let scale = f64::from(unsafe { GetDpiForWindow(parent) }).max(96.0) / 96.0;
            unsafe {
                SetWindowPos(
                    HWND(child as _),
                    Some(HWND_TOP),
                    (x * scale).round() as i32,
                    (y * scale).round() as i32,
                    (width.max(1.0) * scale).round() as i32,
                    (height.max(1.0) * scale).round() as i32,
                    SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
                )
            }
            .map_err(|error| Error::Pipeline(format!("Could not place video HWND: {error}")))
        })
    }

    pub fn status(&self, mpv: &Mpv) -> Result<(u64, i32)> {
        Ok((
            mpv.get_property::<i64>("estimated-frame-number")
                .unwrap_or(-1)
                .saturating_add(1) as u64,
            0,
        ))
    }

    pub fn backend(&self) -> &'static str {
        "windows-d3d11"
    }

    pub fn destroy(&mut self) -> Result<()> {
        if self.child == 0 {
            return Ok(());
        }
        let child = self.child;
        ui(&self.window, move |_| {
            unsafe { DestroyWindow(HWND(child as _)) }
                .map_err(|error| Error::Pipeline(format!("Could not destroy video HWND: {error}")))
        })?;
        self.child = 0;
        Ok(())
    }
}

impl<R: Runtime> Drop for Surface<R> {
    fn drop(&mut self) {
        if let Err(error) = self.destroy() {
            tracing::error!("Windows video HWND cleanup failed: {error}");
        }
    }
}
