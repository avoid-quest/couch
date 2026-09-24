use std::{ffi::c_void, sync::mpsc};

use libmpv2::{Mpv, MpvInitializer};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::{Error, Result};

unsafe extern "C" {
    fn couch_video_create(webview: *mut c_void, mpv: *mut c_void) -> *mut c_void;
    fn couch_video_layout(view: *mut c_void, x: f64, y: f64, width: f64, height: f64);
    fn couch_video_status(view: *mut c_void, frames: *mut u64, error: *mut i32);
    fn couch_video_destroy(view: *mut c_void);
}

fn on_main<R: Runtime, T: Send + 'static>(
    window: &WebviewWindow<R>,
    operation: impl FnOnce() -> T + Send + 'static,
) -> Result<T> {
    let (sender, receiver) = mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let _ = sender.send(operation());
        })
        .map_err(|error| Error::Pipeline(format!("Mac UI dispatcher stopped: {error}")))?;
    receiver
        .recv()
        .map_err(|error| Error::Pipeline(format!("Mac UI dispatcher stopped: {error}")))
}

pub(super) struct Surface<R: Runtime> {
    window: WebviewWindow<R>,
    view: usize,
}

impl<R: Runtime> Surface<R> {
    pub fn new(app: &AppHandle<R>) -> Result<Self> {
        Ok(Self {
            window: app
                .get_webview_window("main")
                .ok_or_else(|| Error::Pipeline("Main window is unavailable".into()))?,
            view: 0,
        })
    }

    pub fn configure(&self, init: &MpvInitializer) -> libmpv2::Result<()> {
        init.set_option("vo", "libmpv")
    }

    pub fn attach(&mut self, mpv: &Mpv) -> Result<()> {
        let handle = mpv.ctx.as_ptr() as usize;
        let (sender, receiver) = mpsc::sync_channel(1);
        self.window
            .with_webview(move |web| {
                let view = unsafe { couch_video_create(web.inner(), handle as *mut c_void) };
                let _ = sender.send(view as usize);
            })
            .map_err(|error| Error::Pipeline(error.to_string()))?;
        self.view = receiver
            .recv()
            .map_err(|error| Error::Pipeline(error.to_string()))?;
        if self.view == 0 {
            return Err(Error::Pipeline(
                "Could not create Mac video renderer".into(),
            ));
        }
        Ok(())
    }

    pub fn layout(&self, x: f64, y: f64, width: f64, height: f64) -> Result<()> {
        let view = self.view;
        on_main(&self.window, move || unsafe {
            couch_video_layout(view as *mut c_void, x, y, width, height)
        })
    }

    pub fn status(&self, _: &Mpv) -> Result<(u64, i32)> {
        let view = self.view;
        on_main(&self.window, move || {
            let (mut frames, mut error) = (0, 0);
            unsafe { couch_video_status(view as *mut c_void, &mut frames, &mut error) };
            (frames, error)
        })
    }

    pub fn backend(&self) -> &'static str {
        "macos-opengl"
    }

    pub fn destroy(&mut self) -> Result<()> {
        if self.view == 0 {
            return Ok(());
        }
        let view = self.view;
        on_main(&self.window, move || unsafe {
            couch_video_destroy(view as *mut c_void)
        })?;
        self.view = 0;
        Ok(())
    }
}
