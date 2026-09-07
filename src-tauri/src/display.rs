use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::mpsc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, PhysicalPosition};

#[derive(Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Action {
    Read,
    Preview { output: String },
    Confirm { token: String },
    Cancel { token: String },
}
pub struct Request {
    pub id: String,
    pub action: Action,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    id: String,
    name: String,
    connected: bool,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    refresh: Option<f64>,
}
impl Output {
    fn usable(&self) -> bool {
        self.connected && self.width > 0 && self.height > 0
    }
}

fn inventory() -> Result<Vec<Output>, String> {
    if std::env::var("XDG_SESSION_TYPE").as_deref() != Ok("x11") {
        return Err("Display selection requires the Ubuntu X11 appliance session.".into());
    }
    let result = std::process::Command::new("/usr/bin/timeout")
        .args(["2", "/usr/bin/xrandr", "--props"])
        .env("LC_ALL", "C")
        .output()
        .map_err(|_| "Cannot read X11 outputs.")?;
    if !result.status.success() {
        return Err("X11 did not report its outputs within two seconds.".into());
    }
    let text = String::from_utf8(result.stdout).map_err(|_| "Invalid X11 output report.")?;
    Ok(parse(&text))
}

fn parse(text: &str) -> Vec<Output> {
    let mut outputs: Vec<Output> = vec![];
    let mut edid = false;
    for line in text.lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        if !line.starts_with(char::is_whitespace)
            && fields.len() > 1
            && ["connected", "disconnected"].contains(&fields[1])
        {
            edid = false;
            let geometry = fields.iter().find_map(|field| {
                let normalized = field.replace('-', "+-");
                let split: Vec<_> = normalized.split(['x', '+']).collect();
                if split.len() != 4 {
                    return None;
                }
                Some((
                    split[0].parse::<u32>().ok()?,
                    split[1].parse::<u32>().ok()?,
                    split[2].parse::<i32>().ok()?,
                    split[3].parse::<i32>().ok()?,
                ))
            });
            let (width, height, x, y) = geometry.unwrap_or_default();
            outputs.push(Output {
                id: format!("connector:{}", fields[0]),
                name: fields[0].into(),
                connected: fields[1] == "connected",
                width,
                height,
                x,
                y,
                refresh: None,
            });
        } else if let Some(output) = outputs.last_mut() {
            if fields.first() == Some(&"EDID:") {
                edid = true;
                continue;
            }
            if edid
                && fields.len() == 1
                && fields[0].len() == 32
                && fields[0].bytes().all(|b| b.is_ascii_hexdigit())
            {
                if !output.id.starts_with("edid:") {
                    output.id = "edid:".into();
                }
                if output.id.len() < 4096 {
                    output.id.push_str(fields[0]);
                }
                continue;
            }
            edid = false;
            if let Some(rate) = fields.iter().find(|field| field.contains('*')) {
                output.refresh = rate.trim_end_matches(['*', '+']).parse().ok();
            }
        }
    }
    // Connector plus EDID remains stable when an identical display is unplugged.
    for output in &mut outputs {
        if output.id.starts_with("edid:") {
            output.id = format!("{}:{}", output.id, output.name);
        }
    }
    outputs
}

fn move_window(app: &AppHandle, output: &Output) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("The TV window is unavailable.")?;
    window
        .set_fullscreen(false)
        .map_err(|_| "Cannot leave fullscreen.")?;
    window
        .set_position(PhysicalPosition::new(output.x, output.y))
        .map_err(|_| "Cannot move the TV window.")?;
    window
        .set_fullscreen(true)
        .map_err(|_| "Cannot restore fullscreen.")?;
    window
        .set_focus()
        .map_err(|_| "Cannot focus the TV window.")?;
    Ok(())
}
fn current(app: &AppHandle, outputs: &[Output]) -> Option<String> {
    let monitor = app.get_webview_window("main")?.current_monitor().ok()??;
    let matches: Vec<_> = outputs
        .iter()
        .filter(|output| {
            output.usable()
                && output.x == monitor.position().x
                && output.y == monitor.position().y
                && output.width == monitor.size().width
                && output.height == monitor.size().height
        })
        .collect();
    if matches.len() == 1 {
        Some(matches[0].id.clone())
    } else {
        None
    }
}
fn fallback(outputs: &[Output], preferred: Option<&str>) -> Option<Output> {
    outputs
        .iter()
        .find(|output| output.usable() && Some(output.id.as_str()) == preferred)
        .or_else(|| {
            outputs.iter().find(|output| {
                output.usable()
                    && (output.name.starts_with("eDP") || output.name.starts_with("LVDS"))
            })
        })
        .or_else(|| outputs.iter().find(|output| output.usable()))
        .cloned()
}
struct Preview {
    token: String,
    target: String,
    previous: Option<String>,
    deadline: Instant,
    expires_at: u128,
}

pub fn run(app: AppHandle, path: PathBuf, requests: mpsc::Receiver<Request>) {
    let mut saved = std::fs::read_to_string(&path)
        .ok()
        .filter(|id| id.len() <= 4200);
    let mut preview: Option<Preview> = None;
    let mut last_outputs = String::new();
    let mut notice: Option<String> = None;
    let mut cached_outputs: Vec<Output> = vec![];
    loop {
        let request = match requests.recv_timeout(Duration::from_secs(1)) {
            Ok(request) => Some(request),
            Err(mpsc::RecvTimeoutError::Timeout) => None,
            Err(_) => break,
        };
        let outputs = match inventory() {
            Ok(outputs) => outputs,
            Err(mut error) => {
                // The rollback deadline does not depend on xrandr remaining healthy.
                if preview
                    .as_ref()
                    .is_some_and(|p| p.deadline <= Instant::now())
                {
                    let previous = preview.take().and_then(|p| p.previous);
                    let monitors = app.available_monitors().unwrap_or_default();
                    let usable: Vec<_> = cached_outputs
                        .iter()
                        .filter(|output| {
                            monitors.iter().any(|monitor| {
                                monitor.position().x == output.x && monitor.position().y == output.y
                            })
                        })
                        .cloned()
                        .collect();
                    let recovered = fallback(&usable, previous.as_deref())
                        .ok_or_else(|| {
                            "No recovery screen could be observed. Restore a display through SSH."
                                .to_string()
                        })
                        .and_then(|output| move_window(&app, &output));
                    let message = recovered.err().unwrap_or_else(|| {
                        "The preview expired and an available screen was restored.".into()
                    });
                    error = format!("{error} {message}");
                    notice = Some(error.clone());
                }
                if let Some(request) = request {
                    app.state::<crate::Host>().report_message(serde_json::json!({"type":"display", "requestId":request.id, "error":error}));
                }
                continue;
            }
        };
        cached_outputs = outputs.clone();
        let signature = serde_json::to_string(&outputs).unwrap_or_default();
        let expired = preview.as_ref().is_some_and(|p| {
            p.deadline <= Instant::now() || !outputs.iter().any(|o| o.id == p.target && o.usable())
        });
        if expired {
            let previous = preview.take().and_then(|p| p.previous);
            notice = Some(match fallback(&outputs, previous.as_deref()) {
                Some(output) => move_window(&app, &output).err().unwrap_or_else(|| "Preview ended. Restored the previous usable output.".into()),
                None => "Preview ended, but no enabled output is available. Restore a display through SSH.".into(),
            });
        }
        if signature != last_outputs && preview.is_none() && !expired {
            let preferred = saved.as_deref().or_else(|| {
                outputs
                    .iter()
                    .find(|o| {
                        o.usable() && !o.name.starts_with("eDP") && !o.name.starts_with("LVDS")
                    })
                    .map(|o| o.id.as_str())
            });
            if let Some(output) = fallback(&outputs, preferred) {
                notice = match move_window(&app, &output) {
                    Err(error) => Some(error),
                    Ok(()) if saved.as_ref().is_some_and(|id| id != &output.id) => Some("The saved screen is disconnected or disabled. Requested an available recovery screen; the saved choice is retained.".into()),
                    Ok(()) => None,
                };
            } else {
                notice =
                    Some("No enabled output is available. Restore a display through SSH.".into());
            }
        }
        last_outputs = signature;
        let Some(request) = request else {
            continue;
        };
        let confirming = matches!(&request.action, Action::Confirm { .. });
        let result: Result<(), String> = (|| {
            match request.action {
                Action::Read => {}
                Action::Preview { output } => {
                    if preview.is_some() {
                        return Err("Finish the current display preview first.".into());
                    }
                    let target = outputs
                        .iter()
                        .find(|o| o.id == output && o.usable())
                        .ok_or("That screen is disconnected or disabled.")?;
                    if outputs.iter().any(|o| {
                        o.id != target.id && o.usable() && o.x == target.x && o.y == target.y
                    }) {
                        return Err("These screens are mirrored. Arrange them separately in the Ubuntu session before selecting one.".into());
                    }
                    let previous = current(&app, &outputs);
                    // Arm rollback before window changes, including a partial native failure.
                    preview = Some(Preview {
                        token: uuid::Uuid::new_v4().to_string(),
                        target: output,
                        previous,
                        deadline: Instant::now() + Duration::from_secs(20),
                        expires_at: SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis()
                            + 20_000,
                    });
                    move_window(&app, target)?;
                    notice = None;
                }
                Action::Confirm { token } | Action::Cancel { token } => {
                    let pending = preview
                        .as_ref()
                        .filter(|p| p.token == token)
                        .ok_or("This preview has ended. Choose a screen to try again.")?;
                    if confirming {
                        if current(&app, &outputs).as_ref() != Some(&pending.target)
                            || !app
                                .get_webview_window("main")
                                .is_some_and(|window| window.is_fullscreen().unwrap_or(false))
                        {
                            return Err("The TV window has not reached that screen. Wait or cancel the preview.".into());
                        }
                        let temporary = path.with_extension("tmp");
                        std::fs::write(&temporary, &pending.target)
                            .and_then(|_| std::fs::rename(&temporary, &path))
                            .map_err(|_| "Could not save the display. The preview will revert.")?;
                        saved = Some(pending.target.clone());
                        preview = None;
                        notice = None;
                    } else {
                        let previous = pending.previous.clone();
                        let output = fallback(&outputs, previous.as_deref())
                            .ok_or("No recovery screen is available.")?;
                        move_window(&app, &output)?;
                        preview = None;
                        notice = Some("Restored the previous usable output.".into());
                    }
                }
            }
            Ok(())
        })();
        let host = app.state::<crate::Host>();
        match result {
            Err(error) => host.report_message(serde_json::json!({"type":"display", "requestId":request.id, "error":error})),
            Ok(()) => host.report_message(serde_json::json!({"type":"display", "requestId":request.id, "state":{"outputs":outputs,"saved":saved,"current":current(&app, &outputs),"notice":notice,"preview":preview.as_ref().map(|p| serde_json::json!({"token":p.token,"expiresAt":p.expires_at}))}})),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const REPORT: &str = "Screen 0: minimum 8 x 8, current 3286 x 1080, maximum 32767 x 32767\neDP-1 connected primary 1366x768+0+0 (normal left inverted right x axis y axis)\n\tEDID:\n\t\t00ffffffffffff001234567890abcdef\n   1366x768     60.00*+  59.90\nHDMI-1 connected 1920x1080+1366+0 (normal left inverted right x axis y axis)\n\tEDID:\n\t\tabcdef123456789000ffffffffffff00\n   1920x1080    60.00  59.94*+\nDP-1 disconnected (normal left inverted right x axis y axis)\nHDMI-2 connected (normal left inverted right x axis y axis)\n   1920x1080    60.00+\n";

    #[test]
    fn inventory_distinguishes_enabled_disabled_and_disconnected_outputs() {
        let outputs = parse(REPORT);
        assert_eq!(outputs.len(), 4);
        assert_eq!(outputs[0].id, "edid:00ffffffffffff001234567890abcdef:eDP-1");
        assert_eq!(outputs[1].width, 1920);
        assert_eq!(outputs[1].x, 1366);
        assert_eq!(outputs[1].refresh, Some(59.94));
        assert!(!outputs[2].connected);
        assert!(outputs[3].connected);
        assert!(!outputs[3].usable());
        assert_eq!(outputs[3].refresh, None);
    }

    #[test]
    fn identity_survives_order_mode_and_identical_screen_changes() {
        let original = parse(REPORT);
        let changed = parse(
            &REPORT
                .replace("1920x1080+1366+0", "1280x720+0+768")
                .replace(
                    "00ffffffffffff001234567890abcdef",
                    "abcdef123456789000ffffffffffff00",
                ),
        );
        assert_eq!(original[1].id, changed[1].id);
        let isolated = parse(
            "HDMI-1 connected 1920x1080+0+0\n\tEDID:\n\t\tabcdef123456789000ffffffffffff00\n",
        );
        assert_eq!(original[1].id, isolated[0].id);
        assert_eq!(parse("HDMI-1 connected 800x600-800-600\n")[0].x, -800);
    }

    #[test]
    fn fallback_uses_previous_then_panel_then_enabled_output() {
        let mut outputs = parse(REPORT);
        assert_eq!(
            fallback(&outputs, Some(&outputs[1].id)).unwrap().name,
            "HDMI-1"
        );
        assert_eq!(fallback(&outputs, Some("missing")).unwrap().name, "eDP-1");
        outputs[0].connected = false;
        assert_eq!(fallback(&outputs, Some("missing")).unwrap().name, "HDMI-1");
        outputs[1].width = 0;
        assert!(fallback(&outputs, Some("missing")).is_none());
    }
}
