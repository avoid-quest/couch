use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub op: String,
    pub owner: String,
    pub device: Option<String>,
    pub token: Option<String>,
    pub prompt: Option<String>,
    pub answer: Option<String>,
}

#[cfg(not(target_os = "linux"))]
#[derive(Default)]
pub struct Bluetooth;
#[cfg(not(target_os = "linux"))]
impl Bluetooth {
    pub async fn request(&self, _: Action) -> Result<Value, String> { Err("Bluetooth requires the native Ubuntu TV session.".into()) }
    pub fn close(&self) {}
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use bluer::{agent::{Agent, ReqError}, Address, DiscoveryFilter};
    use futures_util::StreamExt;
    use std::{sync::{Arc, Mutex}, time::{Duration, SystemTime, UNIX_EPOCH}};
    use tokio::{sync::{oneshot, OnceCell, OwnedMutexGuard}, task::JoinHandle};
    const AUDIO: uuid::Uuid = uuid::Uuid::from_u128(0x0000110b_0000_1000_8000_00805f9b34fb);
    const LIMIT: Duration = Duration::from_secs(60);
    type Answer = oneshot::Sender<String>;
    #[derive(Default)]
    struct Pending { owner: String, operation: Option<Value>, task: Option<JoinHandle<()>>, answer: Option<Answer> }
    #[derive(Default, Clone)]
    pub struct Bluetooth { session: Arc<OnceCell<bluer::Session>>, pending: Arc<Mutex<Pending>>, hardware: Arc<tokio::sync::Mutex<()>> }
    struct CancelConnect { device: bluer::Device, hardware: Option<OwnedMutexGuard<()>> }
    impl Drop for CancelConnect {
        fn drop(&mut self) {
            if let Some(hardware) = self.hardware.take() {
                let device = self.device.clone();
                tokio::spawn(async move {
                    let _hardware = hardware;
                    let _ = tokio::time::timeout(Duration::from_secs(5), device.disconnect()).await;
                });
            }
        }
    }
    async fn connect(device: &bluer::Device, audio: bool, hardware: OwnedMutexGuard<()>) -> Result<(), String> {
        // BlueZ keeps Connect running when its D-Bus caller drops the reply future.
        let mut cancel = CancelConnect { device: device.clone(), hardware: Some(hardware) };
        let result = if audio { device.connect_profile(&AUDIO).await } else { device.connect().await };
        cancel.hardware.take();
        result.map_err(|e| e.to_string())
    }
    fn millis() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() }
    fn running(pending: &Pending) -> bool { pending.operation.as_ref().is_some_and(|op| op["status"] == "running") }
    fn blocked() -> bool {
        std::fs::read_dir("/sys/class/rfkill").into_iter().flatten().flatten().any(|entry| {
            let path = entry.path();
            std::fs::read_to_string(path.join("type")).is_ok_and(|s| s.trim() == "bluetooth") && ["soft", "hard"].iter().any(|name| std::fs::read_to_string(path.join(name)).is_ok_and(|s| s.trim() == "1"))
        })
    }
    impl Bluetooth {
        async fn session(&self) -> Result<&bluer::Session, String> {
            self.session.get_or_try_init(|| async { bluer::Session::new().await.map_err(|_| "The Ubuntu Bluetooth service is unavailable. Check the Couch companion package.".to_string()) }).await
        }
        fn finish(&self, id: &str, result: Result<(), String>) {
            let mut pending = self.pending.lock().unwrap();
            if let Some(op) = pending.operation.as_mut().filter(|op| op["id"] == id && op["status"] == "running") {
                op["status"] = json!(if result.is_ok() { "finished" } else { "error" });
                op["message"] = json!(result.err()); op["prompt"] = Value::Null;
                pending.answer = None;
            }
        }
        fn retire(pending: &mut Pending) {
            if let Some(task) = pending.task.take() { task.abort(); }
            pending.answer = None;
            if let Some(op) = pending.operation.as_mut().filter(|op| op["status"] == "running") { op["status"] = json!("cancelled"); op["prompt"] = Value::Null; op["message"] = json!("Bluetooth operation cancelled."); }
        }
        pub fn close(&self) { Self::retire(&mut self.pending.lock().unwrap()); }
        fn display(&self, id: &str, address: Address, target: Address, value: String, cancel: oneshot::Receiver<()>) -> Result<(), ReqError> {
            if address != target { return Err(ReqError::Rejected); }
            let prompt = uuid::Uuid::new_v4().to_string();
            {
                let mut pending = self.pending.lock().unwrap();
                let op = pending.operation.as_mut().filter(|op| op["id"] == id && op["status"] == "running").ok_or(ReqError::Canceled)?;
                op["prompt"] = json!({"id":prompt,"kind":"display","value":value}); pending.answer = None;
            }
            let this = self.clone(); let id = id.to_string();
            tokio::spawn(async move {
                let _ = tokio::time::timeout(LIMIT, cancel).await;
                let mut pending = this.pending.lock().unwrap();
                if let Some(op) = pending.operation.as_mut().filter(|op| op["id"] == id && op["prompt"]["id"] == prompt) { op["prompt"] = Value::Null; }
            });
            Ok(())
        }
        async fn prompt(&self, id: &str, address: Address, target: Address, kind: &str, value: Option<String>) -> Result<String, ReqError> {
            if address != target { return Err(ReqError::Rejected); }
            let (tx, rx) = oneshot::channel();
            {
                let mut pending = self.pending.lock().unwrap();
                let op = pending.operation.as_mut().filter(|op| op["id"] == id && op["status"] == "running").ok_or(ReqError::Canceled)?;
                op["prompt"] = json!({"id":uuid::Uuid::new_v4().to_string(),"kind":kind,"value":value});
                pending.answer = Some(tx);
            }
            rx.await.map_err(|_| ReqError::Canceled)
        }
        fn agent(&self, id: &str, target: Address) -> Agent {
            let display_pin = self.clone(); let display_pin_id = id.to_string();
            let display_key = self.clone(); let display_key_id = id.to_string();
            let pin = self.clone(); let pin_id = id.to_string();
            let key = self.clone(); let key_id = id.to_string();
            let confirm = self.clone(); let confirm_id = id.to_string();
            let authorization = self.clone(); let authorization_id = id.to_string();
            Agent {
                display_pin_code: Some(Box::new(move |request| { let this = display_pin.clone(); let id = display_pin_id.clone(); Box::pin(async move { this.display(&id, request.device, target, request.pincode, request.cancel) }) })),
                display_passkey: Some(Box::new(move |request| { let this = display_key.clone(); let id = display_key_id.clone(); Box::pin(async move { this.display(&id, request.device, target, format!("{:06}", request.passkey), request.cancel) }) })),
                request_pin_code: Some(Box::new(move |request| { let this = pin.clone(); let id = pin_id.clone(); Box::pin(async move {
                    let answer = this.prompt(&id, request.device, target, "pin", None).await?;
                    if answer.is_empty() || answer.len() > 16 || !answer.chars().all(|c| c.is_ascii_alphanumeric()) { return Err(ReqError::Rejected); } Ok(answer)
                }) })),
                request_passkey: Some(Box::new(move |request| { let this = key.clone(); let id = key_id.clone(); Box::pin(async move {
                    let answer = this.prompt(&id, request.device, target, "passkey", None).await?;
                    answer.parse::<u32>().ok().filter(|key| *key <= 999999).ok_or(ReqError::Rejected)
                }) })),
                request_confirmation: Some(Box::new(move |request| { let this = confirm.clone(); let id = confirm_id.clone(); Box::pin(async move {
                    let answer = this.prompt(&id, request.device, target, "confirm", Some(format!("{:06}", request.passkey))).await?;
                    if answer == "yes" { Ok(()) } else { Err(ReqError::Rejected) }
                }) })),
                request_authorization: Some(Box::new(move |request| { let this = authorization.clone(); let id = authorization_id.clone(); Box::pin(async move {
                    let answer = this.prompt(&id, request.device, target, "confirm", None).await?;
                    if answer == "yes" { Ok(()) } else { Err(ReqError::Rejected) }
                }) })),
                authorize_service: Some(Box::new(move |request| Box::pin(async move { if request.device == target { Ok(()) } else { Err(ReqError::Rejected) } }))),
                ..Default::default()
            }
        }
        async fn inventory(&self) -> Result<Value, String> {
            let session = self.session().await?;
            let names = session.adapter_names().await.map_err(|e| e.to_string())?;
            let mut state = json!({"adapter":"absent","devices":[],"operation":self.pending.lock().unwrap().operation});
            if names.is_empty() { return Ok(state); }
            let adapter = session.default_adapter().await.map_err(|e| e.to_string())?;
            state["adapter"] = json!(if blocked() { "blocked" } else if adapter.is_powered().await.map_err(|e| e.to_string())? { "available" } else { "off" });
            let mut devices = vec![];
            for address in adapter.device_addresses().await.map_err(|e| e.to_string())?.into_iter().take(128) {
                let device = adapter.device(address).map_err(|e| e.to_string())?;
                devices.push(json!({"address":address.to_string(),"name":device.alias().await.unwrap_or_else(|_| address.to_string()).chars().take(160).collect::<String>(),"paired":device.is_paired().await.unwrap_or(false),"trusted":device.is_trusted().await.unwrap_or(false),"connected":device.is_connected().await.unwrap_or(false)}));
            }
            state["devices"] = json!(devices); Ok(state)
        }
        async fn perform(&self, action: &Action, id: &str) -> Result<(), String> {
            let hardware = self.hardware.clone().lock_owned().await;
            let session = self.session().await?;
            let adapter = session.default_adapter().await.map_err(|e| e.to_string())?;
            if action.op == "power" { return adapter.set_powered(true).await.map_err(|e| e.to_string()); }
            if action.op == "scan" {
                adapter.set_discovery_filter(DiscoveryFilter { discoverable: false, ..Default::default() }).await.map_err(|e| e.to_string())?;
                let events = adapter.discover_devices().await.map_err(|e| e.to_string())?;
                tokio::pin!(events);
                let end = tokio::time::sleep(Duration::from_secs(30)); tokio::pin!(end);
                loop { tokio::select! { _ = &mut end => break, event = events.next() => if event.is_none() { break; } } }
                return Ok(());
            }
            let address = action.device.as_deref().ok_or("Choose a device.")?.parse::<Address>().map_err(|_| "Invalid Bluetooth address.")?;
            let device = adapter.device(address).map_err(|e| e.to_string())?;
            match action.op.as_str() {
                "pair" => {
                    if device.is_paired().await.map_err(|e| e.to_string())? { return Err("This device is already paired. Choose Connect.".into()); }
                    let _agent = session.register_agent(self.agent(id, address)).await.map_err(|e| e.to_string())?;
                    device.pair().await.map_err(|e| e.to_string())?;
                    device.set_trusted(true).await.map_err(|e| e.to_string())?;
                    connect(&device, false, hardware).await
                },
                "connect" | "reconnect" => {
                    if !device.is_paired().await.map_err(|e| e.to_string())? { return Err("Pair this device first.".into()); }
                    connect(&device, action.op == "reconnect", hardware).await
                },
                "disconnect" => device.disconnect().await.map_err(|e| e.to_string()),
                "forget" => adapter.remove_device(address).await.map_err(|e| e.to_string()),
                _ => Err("Unknown Bluetooth action.".into())
            }
        }
        pub async fn request(&self, action: Action) -> Result<Value, String> {
            if action.owner.is_empty() || action.owner.len() > 128 { return Err("Invalid Bluetooth owner.".into()); }
            if action.op == "cancel" {
                let mut pending = self.pending.lock().unwrap();
                if pending.owner == action.owner && action.token.as_ref().is_none_or(|token| pending.operation.as_ref().is_some_and(|op| op["id"] == *token)) { Self::retire(&mut pending); }
            } else if action.op == "answer" {
                let mut pending = self.pending.lock().unwrap();
                if pending.owner != action.owner || !running(&pending) || !pending.operation.as_ref().is_some_and(|op| Some(op["id"].as_str().unwrap_or_default()) == action.token.as_deref() && Some(op["prompt"]["id"].as_str().unwrap_or_default()) == action.prompt.as_deref()) { return Err("This pairing prompt has ended.".into()); }
                let sender = pending.answer.take().ok_or("This pairing prompt has ended.")?;
                sender.send(action.answer.clone().unwrap_or_default()).map_err(|_| "This pairing prompt has ended.")?;
                if let Some(op) = pending.operation.as_mut() { op["prompt"] = Value::Null; }
            } else if action.op != "read" {
                let mut pending = self.pending.lock().unwrap();
                if running(&pending) { return Err("Stop the current Bluetooth operation first.".into()); }
                let id = match action.token.as_deref() { Some(token) => uuid::Uuid::parse_str(token).map_err(|_| "Invalid Bluetooth operation token.")?.to_string(), None => uuid::Uuid::new_v4().to_string() };
                pending.owner = action.owner.clone();
                pending.operation = Some(json!({"id":id,"device":action.device,"kind":action.op,"status":"running","endsAt":millis()+LIMIT.as_millis(),"message":null,"prompt":null}));
                let this = self.clone();
                pending.task = Some(tokio::spawn(async move {
                    let result = tokio::time::timeout(LIMIT, this.perform(&action, &id)).await.unwrap_or_else(|_| Err("Bluetooth timed out. Put the device in pairing mode and try again.".into()));
                    this.finish(&id, result);
                }));
            }
            tokio::time::timeout(Duration::from_secs(4), self.inventory()).await.map_err(|_| "Bluetooth inventory timed out.")?
        }
    }
}
#[cfg(target_os = "linux")]
pub use linux::Bluetooth;

#[cfg(all(test, target_os = "linux"))]
#[path = "bluetooth_tests.rs"]
mod tests;
