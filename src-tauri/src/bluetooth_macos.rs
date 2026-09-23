use super::Action;
use objc2::{define_class, msg_send, rc::Retained, runtime::AnyObject, AnyThread, DefinedClass};
use objc2_core_bluetooth::{CBManager, CBManagerAuthorization};
use objc2_foundation::{NSDate, NSObject, NSObjectProtocol, NSRunLoop, NSString};
use objc2_io_bluetooth::{
    BluetoothPINCode, IOBluetoothDevice, IOBluetoothDeviceInquiry,
    IOBluetoothDeviceInquiryDelegate, IOBluetoothDevicePair, IOBluetoothDevicePairDelegate,
    IOBluetoothHostController,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const LIMIT: Duration = Duration::from_secs(60);
const DISCONNECT_RETRY_AFTER: Duration = Duration::from_secs(1);
const SETTINGS: &str = "Check in System Settings on the playback host.";

fn canonical_address(address: &NSString) -> String {
    address.to_string().replace('-', ":").to_ascii_uppercase()
}

#[derive(Default)]
struct Pending {
    owner: String,
    operation: Option<Value>,
    found: BTreeSet<String>,
    response: Option<String>,
    result: Option<i32>,
}

fn running(pending: &Pending, id: &str) -> bool {
    pending
        .operation
        .as_ref()
        .is_some_and(|op| op["id"] == id && op["status"] == "running")
}

fn retire(pending: &mut Pending, status: &str, message: &str) {
    if let Some(op) = pending
        .operation
        .as_mut()
        .filter(|op| op["status"] == "running")
    {
        op["status"] = json!(status);
        op["message"] = json!(message);
        op["prompt"] = Value::Null;
    }
    pending.response = None;
}

fn prompt(pending: &mut Pending, id: &str, kind: &str, value: Option<String>) {
    if running(pending, id) {
        pending.response = None;
        pending.operation.as_mut().unwrap()["prompt"] =
            json!({"id":uuid::Uuid::new_v4().to_string(),"kind":kind,"value":value});
    }
}

fn answer(pending: &mut Pending, action: &Action) -> Result<(), String> {
    let current = pending.operation.as_ref();
    if pending.owner != action.owner
        || !current.is_some_and(|op| {
            op["status"] == "running"
                && op["id"].as_str() == action.token.as_deref()
                && op["prompt"]["id"].as_str() == action.prompt.as_deref()
        })
        || pending.response.is_some()
    {
        return Err("This pairing prompt has ended.".into());
    }
    let kind = current.unwrap()["prompt"]["kind"]
        .as_str()
        .unwrap_or_default();
    let value = action.answer.as_deref().unwrap_or_default();
    if kind == "pin"
        && (value.is_empty()
            || value.len() > 16
            || !value.bytes().all(|byte| byte.is_ascii_alphanumeric()))
        || kind == "confirm" && value != "yes"
    {
        return Err("Invalid pairing answer.".into());
    }
    if kind != "pin" && kind != "confirm" {
        return Err("This pairing prompt has ended.".into());
    }
    pending.response = Some(value.to_string());
    Ok(())
}

struct DelegateIvars {
    pending: Arc<Mutex<Pending>>,
    id: String,
}

define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = AnyThread]
    #[ivars = DelegateIvars]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    #[allow(non_snake_case)] // Match the generated Objective-C delegate selectors.
    unsafe impl IOBluetoothDeviceInquiryDelegate for Delegate {
        #[unsafe(method(deviceInquiryDeviceFound:device:))]
        unsafe fn deviceInquiryDeviceFound_device(
            &self,
            _: Option<&IOBluetoothDeviceInquiry>,
            device: Option<&IOBluetoothDevice>,
        ) {
            if let Some(address) = device.and_then(|device| unsafe { device.addressString() }) {
                let mut pending = self.ivars().pending.lock().unwrap();
                if running(&pending, &self.ivars().id) {
                    pending.found.insert(canonical_address(&address));
                }
            }
        }
        #[unsafe(method(deviceInquiryComplete:error:aborted:))]
        unsafe fn deviceInquiryComplete_error_aborted(
            &self,
            _: Option<&IOBluetoothDeviceInquiry>,
            error: i32,
            aborted: bool,
        ) {
            let mut pending = self.ivars().pending.lock().unwrap();
            if running(&pending, &self.ivars().id) {
                pending
                    .result
                    .get_or_insert(if aborted { -1 } else { error });
            }
        }
    }

    #[allow(non_snake_case)]
    unsafe impl IOBluetoothDevicePairDelegate for Delegate {
        #[unsafe(method(devicePairingPINCodeRequest:))]
        unsafe fn devicePairingPINCodeRequest(&self, _: Option<&AnyObject>) {
            prompt(
                &mut self.ivars().pending.lock().unwrap(),
                &self.ivars().id,
                "pin",
                None,
            );
        }
        #[unsafe(method(devicePairingUserConfirmationRequest:numericValue:))]
        unsafe fn devicePairingUserConfirmationRequest_numericValue(
            &self,
            _: Option<&AnyObject>,
            value: u32,
        ) {
            prompt(
                &mut self.ivars().pending.lock().unwrap(),
                &self.ivars().id,
                "confirm",
                Some(format!("{value:06}")),
            );
        }
        #[unsafe(method(devicePairingUserPasskeyNotification:passkey:))]
        unsafe fn devicePairingUserPasskeyNotification_passkey(
            &self,
            _: Option<&AnyObject>,
            value: u32,
        ) {
            prompt(
                &mut self.ivars().pending.lock().unwrap(),
                &self.ivars().id,
                "display",
                Some(format!("{value:06}")),
            );
        }
        #[unsafe(method(devicePairingFinished:error:))]
        unsafe fn devicePairingFinished_error(&self, _: Option<&AnyObject>, error: i32) {
            let mut pending = self.ivars().pending.lock().unwrap();
            if running(&pending, &self.ivars().id) {
                pending.result.get_or_insert(error);
            }
        }
    }
);

impl Delegate {
    fn new(pending: Arc<Mutex<Pending>>, id: String) -> Retained<Self> {
        let this = Self::alloc().set_ivars(DelegateIvars { pending, id });
        unsafe { msg_send![super(this), init] }
    }
}

#[derive(Default, Clone)]
pub struct Bluetooth {
    pending: Arc<Mutex<Pending>>,
    hardware: Arc<Mutex<()>>,
}

impl Bluetooth {
    pub fn close(&self) {
        retire(
            &mut self.pending.lock().unwrap(),
            "cancelled",
            "Bluetooth operation cancelled.",
        );
    }

    fn inventory(&self) -> Result<Value, String> {
        objc2::rc::autoreleasepool(|_| {
            let authorization = unsafe { CBManager::authorization_class() };
            if authorization == CBManagerAuthorization::Denied
                || authorization == CBManagerAuthorization::Restricted
            {
                return Err(
                    "Allow Couch to use Bluetooth in System Settings on the playback host.".into(),
                );
            }
            let operation = self.pending.lock().unwrap().operation.clone();
            let Some(controller) = (unsafe { IOBluetoothHostController::defaultController() })
            else {
                return Ok(json!({"adapter":"absent","devices":[],"operation":operation}));
            };
            // The generated binding encodes this C enum as unsigned, but macOS returns signed int.
            let power: i32 = unsafe { msg_send![&*controller, powerState] };
            let scanning = operation
                .as_ref()
                .is_some_and(|op| op["kind"] == "scan" && op["status"] == "running");
            let found = self.pending.lock().unwrap().found.clone();
            let mut addresses = found;
            if let Some(paired) = unsafe { IOBluetoothDevice::pairedDevices() } {
                for item in paired.iter() {
                    if let Some(device) = item.downcast_ref::<IOBluetoothDevice>() {
                        if let Some(address) = unsafe { device.addressString() } {
                            addresses.insert(canonical_address(&address));
                        }
                    }
                }
            }
            let devices: Vec<Value> = addresses
                .into_iter()
                .take(128)
                .filter_map(|address| {
                    let device = unsafe {
                        IOBluetoothDevice::deviceWithAddressString(Some(&NSString::from_str(&address)))
                    }?;
                    let paired = unsafe { device.isPaired() };
                    let connected = unsafe { device.isConnected() };
                    let name = if scanning && !paired {
                        address.clone()
                    } else {
                        unsafe { device.nameOrAddress() }
                            .map(|name| name.to_string().chars().take(160).collect())
                            .unwrap_or_else(|| address.clone())
                    };
                    Some(json!({"address":address,"name":name,"paired":paired,"connected":connected}))
                })
                .collect();
            Ok(
                json!({"adapter":if power == 1 { "available" } else { "off" },"devices":devices,"operation":operation}),
            )
        })
    }

    async fn state(&self) -> Result<Value, String> {
        let this = self.clone();
        tokio::time::timeout(
            Duration::from_secs(4),
            tokio::task::spawn_blocking(move || this.inventory()),
        )
        .await
        .map_err(|_| "Bluetooth inventory timed out.".to_string())?
        .map_err(|error| error.to_string())?
    }

    fn finish(&self, id: &str, result: Result<(), String>) {
        let mut pending = self.pending.lock().unwrap();
        if running(&pending, id) {
            let op = pending.operation.as_mut().unwrap();
            op["status"] = json!(if result.is_ok() { "finished" } else { "error" });
            op["message"] = json!(result.err());
            op["prompt"] = Value::Null;
            pending.response = None;
        }
    }

    fn active(&self, id: &str) -> bool {
        running(&self.pending.lock().unwrap(), id)
    }

    fn wait(&self, id: &str, end: Instant, done: impl Fn() -> bool) -> Result<(), String> {
        let run_loop = NSRunLoop::currentRunLoop();
        while self.active(id) && Instant::now() < end && !done() {
            objc2::rc::autoreleasepool(|_| {
                run_loop.runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.05))
            });
        }
        if !self.active(id) {
            Err("Bluetooth operation cancelled.".into())
        } else if Instant::now() >= end {
            Err("Bluetooth timed out. Try again.".into())
        } else {
            Ok(())
        }
    }

    fn verify_connection(
        &self,
        id: &str,
        desired: bool,
        end: Instant,
        observed: impl Fn() -> bool,
    ) -> Result<(), String> {
        self.wait(id, end, || observed() == desired)?;
        if observed() != desired {
            return Err("Bluetooth connection readback did not match the request.".into());
        }
        Ok(())
    }

    fn set_connection(
        &self,
        id: &str,
        desired: bool,
        end: Instant,
        connected: impl Fn() -> bool,
        open: impl Fn() -> i32,
        close: impl Fn() -> i32,
    ) -> Result<(), String> {
        if !self.active(id) {
            return Err("Bluetooth operation cancelled.".into());
        }
        let was_connected = connected();
        if was_connected == desired {
            return Ok(());
        }
        if !desired {
            let mut retried = false;
            loop {
                if !self.active(id) {
                    return Err("Bluetooth operation cancelled.".into());
                }
                let status = close();
                if status != 0 && connected() {
                    return Err(format!("Bluetooth disconnection failed ({status})."));
                }
                let check_end = if retried {
                    end
                } else {
                    (Instant::now() + DISCONNECT_RETRY_AFTER).min(end)
                };
                match self.verify_connection(id, false, check_end, &connected) {
                    Ok(()) => return Ok(()),
                    Err(_) if !retried && self.active(id) && Instant::now() < end => retried = true,
                    Err(error) => return Err(error),
                }
            }
        }
        let status = open();
        let result = if status != 0 && !connected() {
            Err(format!("Bluetooth connection failed ({status})."))
        } else {
            self.verify_connection(id, true, end, &connected)
        };
        if !was_connected && !self.active(id) && connected() {
            let _ = close();
        }
        result
    }

    fn connect(
        &self,
        id: &str,
        device: &IOBluetoothDevice,
        desired: bool,
        end: Instant,
    ) -> Result<(), String> {
        self.set_connection(
            id,
            desired,
            end,
            || unsafe { device.isConnected() },
            || unsafe { device.openConnection() },
            || unsafe { device.closeConnection() },
        )
    }

    fn perform(&self, action: &Action, id: &str) -> Result<(), String> {
        let _hardware = self.hardware.lock().unwrap();
        if !self.active(id) {
            return Err("Bluetooth operation cancelled.".into());
        }
        let end = Instant::now() + LIMIT;
        let delegate = Delegate::new(self.pending.clone(), id.to_string());
        if action.op == "scan" {
            let inquiry = unsafe { IOBluetoothDeviceInquiry::inquiryWithDelegate(Some(&delegate)) }
                .ok_or("Bluetooth discovery is unavailable.")?;
            unsafe {
                inquiry.setInquiryLength(30);
                inquiry.setUpdateNewDeviceNames(false);
            }
            let status = unsafe { inquiry.start() };
            if status != 0 {
                unsafe { inquiry.setDelegate(None) };
                return Err(format!("Bluetooth search failed ({status})."));
            }
            let result = self.wait(id, end, || self.pending.lock().unwrap().result.is_some());
            if result.is_err() {
                unsafe { inquiry.stop() };
            }
            unsafe { inquiry.setDelegate(None) };
            result?;
            let code = self.pending.lock().unwrap().result.unwrap_or_default();
            return if code == 0 {
                Ok(())
            } else {
                Err(format!("Bluetooth search failed ({code})."))
            };
        }
        let address = action
            .device
            .as_deref()
            .ok_or("Choose a Bluetooth device.")?;
        let device = unsafe {
            IOBluetoothDevice::deviceWithAddressString(Some(&NSString::from_str(address)))
        }
        .ok_or("The Bluetooth device is unavailable.")?;
        match action.op.as_str() {
            "pair" => {
                if unsafe { device.isPaired() } {
                    return Err("This device is already paired. Choose Connect.".into());
                }
                if !self.pending.lock().unwrap().found.contains(address) {
                    return Err("Search for this device first.".into());
                }
                let pair = unsafe { IOBluetoothDevicePair::pairWithDevice(Some(&device)) }
                    .ok_or("Bluetooth pairing is unavailable.")?;
                unsafe {
                    pair.setDelegate(Some(&delegate));
                }
                let status = unsafe { pair.start() };
                if status != 0 {
                    unsafe { pair.setDelegate(None) };
                    return Err(format!("Bluetooth pairing failed ({status})."));
                }
                let result = self.wait(id, end, || {
                    let mut pending = self.pending.lock().unwrap();
                    let reply = pending.response.take().map(|answer| {
                        let kind = pending
                            .operation
                            .as_ref()
                            .and_then(|op| op["prompt"]["kind"].as_str())
                            .unwrap_or_default()
                            .to_string();
                        if let Some(op) = pending.operation.as_mut() {
                            op["prompt"] = Value::Null;
                        }
                        (kind, answer)
                    });
                    let done = pending.result.is_some();
                    drop(pending);
                    if let Some((kind, answer)) = reply {
                        if kind == "pin" {
                            let mut pin = BluetoothPINCode { data: [0; 16] };
                            pin.data[..answer.len()].copy_from_slice(answer.as_bytes());
                            unsafe { pair.replyPINCode_PINCode(answer.len() as u64, &mut pin) };
                        } else if kind == "confirm" {
                            unsafe { pair.replyUserConfirmation(answer == "yes") };
                        }
                    }
                    done
                });
                if result.is_err() {
                    unsafe { pair.stop() };
                }
                unsafe { pair.setDelegate(None) };
                result?;
                let code = self.pending.lock().unwrap().result.unwrap_or_default();
                if code != 0 {
                    return Err(format!("Bluetooth pairing did not complete ({code})."));
                }
                self.wait(id, end, || unsafe { device.isPaired() })?;
                self.connect(id, &device, true, end)
            }
            "connect" | "reconnect" | "disconnect" => {
                if !unsafe { device.isPaired() } {
                    return Err("Pair this device first.".into());
                }
                let desired = action.op != "disconnect";
                self.connect(id, &device, desired, end)
            }
            _ => Err("Unknown Bluetooth action.".into()),
        }
    }

    pub async fn request(&self, action: Action) -> Result<Value, String> {
        if action.owner.is_empty() || action.owner.len() > 128 {
            return Err("Invalid Bluetooth owner.".into());
        }
        if action.op == "power" || action.op == "forget" {
            if self.state().await?["adapter"] == "absent" {
                return Err("No Bluetooth adapter is attached to the playback computer.".into());
            }
            return Err(SETTINGS.into());
        }
        if action.op == "cancel" {
            let mut pending = self.pending.lock().unwrap();
            if pending.owner == action.owner
                && action.token.as_ref().is_none_or(|token| {
                    pending
                        .operation
                        .as_ref()
                        .is_some_and(|op| op["id"] == *token)
                })
            {
                retire(&mut pending, "cancelled", "Bluetooth operation cancelled.");
            }
        } else if action.op == "answer" {
            let mut pending = self.pending.lock().unwrap();
            answer(&mut pending, &action)?;
        } else if action.op != "read" {
            if !["scan", "pair", "connect", "disconnect", "reconnect"].contains(&action.op.as_str())
            {
                return Err("Unknown Bluetooth action.".into());
            }
            let state = self.state().await?;
            if state["adapter"] == "absent" {
                return Err("No Bluetooth adapter is attached to the playback computer.".into());
            }
            if state["adapter"] != "available" {
                return Err("Bluetooth is off on the playback computer.".into());
            }
            let mut pending = self.pending.lock().unwrap();
            if pending
                .operation
                .as_ref()
                .is_some_and(|op| op["status"] == "running")
            {
                return Err("Stop the current Bluetooth operation first.".into());
            }
            let id = match action.token.as_deref() {
                Some(token) => uuid::Uuid::parse_str(token)
                    .map_err(|_| "Invalid Bluetooth operation token.")?
                    .to_string(),
                None => uuid::Uuid::new_v4().to_string(),
            };
            pending.owner = action.owner.clone();
            pending.result = None;
            pending.response = None;
            if action.op == "scan" {
                pending.found.clear();
            }
            let ends_at = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                + LIMIT.as_millis();
            pending.operation = Some(
                json!({"id":id,"device":action.device,"kind":action.op,"status":"running","endsAt":ends_at,"message":null,"prompt":null}),
            );
            let this = self.clone();
            let timeout_id = id.clone();
            let watchdog = tokio::spawn(async move {
                tokio::time::sleep(LIMIT).await;
                let mut pending = this.pending.lock().unwrap();
                if running(&pending, &timeout_id) {
                    retire(&mut pending, "error", "Bluetooth timed out. Try again.");
                }
            });
            let this = self.clone();
            std::thread::spawn(move || {
                let result = objc2::rc::autoreleasepool(|_| this.perform(&action, &id));
                this.finish(&id, result);
                watchdog.abort();
            });
        }
        self.state().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending() -> Arc<Mutex<Pending>> {
        Arc::new(Mutex::new(Pending {
            owner: "administrator".into(),
            operation: Some(json!({"id":"one","status":"running","prompt":null})),
            ..Default::default()
        }))
    }

    #[test]
    fn mac_addresses_match_the_shared_bluetooth_route() {
        assert_eq!(
            canonical_address(&NSString::from_str("aa-bb-cc-dd-ee-ff")),
            "AA:BB:CC:DD:EE:FF"
        );
    }

    fn response(owner: &str, prompt: &str, value: &str) -> Action {
        Action {
            op: "answer".into(),
            owner: owner.into(),
            token: Some("one".into()),
            prompt: Some(prompt.into()),
            answer: Some(value.into()),
            device: None,
        }
    }

    #[test]
    fn challenge_callbacks_accept_only_the_current_owner_and_prompt() {
        let shared = pending();
        let delegate = Delegate::new(shared.clone(), "one".into());
        unsafe {
            IOBluetoothDevicePairDelegate::devicePairingUserConfirmationRequest_numericValue(
                &*delegate, None, 123456,
            )
        };
        let first = shared.lock().unwrap().operation.as_ref().unwrap()["prompt"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            shared.lock().unwrap().operation.as_ref().unwrap()["prompt"]["value"],
            "123456"
        );
        assert!(answer(
            &mut shared.lock().unwrap(),
            &response("other", &first, "yes")
        )
        .is_err());
        unsafe { IOBluetoothDevicePairDelegate::devicePairingPINCodeRequest(&*delegate, None) };
        let second = shared.lock().unwrap().operation.as_ref().unwrap()["prompt"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(answer(
            &mut shared.lock().unwrap(),
            &response("administrator", &first, "yes")
        )
        .is_err());
        assert!(answer(
            &mut shared.lock().unwrap(),
            &response("administrator", &second, "bad pin")
        )
        .is_err());
        answer(
            &mut shared.lock().unwrap(),
            &response("administrator", &second, "1234"),
        )
        .unwrap();
        assert!(answer(
            &mut shared.lock().unwrap(),
            &response("administrator", &second, "1234")
        )
        .is_err());
    }

    #[test]
    fn cancellation_retires_late_pairing_callbacks_and_answers() {
        let shared = pending();
        let delegate = Delegate::new(shared.clone(), "one".into());
        unsafe {
            IOBluetoothDevicePairDelegate::devicePairingUserConfirmationRequest_numericValue(
                &*delegate, None, 123456,
            )
        };
        let token = shared.lock().unwrap().operation.as_ref().unwrap()["prompt"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        retire(&mut shared.lock().unwrap(), "cancelled", "Cancelled.");
        unsafe {
            IOBluetoothDevicePairDelegate::devicePairingPINCodeRequest(&*delegate, None);
            IOBluetoothDevicePairDelegate::devicePairingFinished_error(&*delegate, None, 0)
        };
        let state = shared.lock().unwrap();
        assert!(state.operation.as_ref().unwrap()["prompt"].is_null());
        assert_eq!(state.operation.as_ref().unwrap()["status"], "cancelled");
        assert!(state.result.is_none());
        drop(state);
        assert!(answer(
            &mut shared.lock().unwrap(),
            &response("administrator", &token, "yes")
        )
        .is_err());
    }

    #[test]
    fn discovery_keeps_its_first_completion_and_rejects_aborted_searches() {
        let shared = pending();
        let delegate = Delegate::new(shared.clone(), "one".into());
        unsafe {
            IOBluetoothDeviceInquiryDelegate::deviceInquiryComplete_error_aborted(
                &*delegate, None, 0, false,
            );
            IOBluetoothDeviceInquiryDelegate::deviceInquiryComplete_error_aborted(
                &*delegate, None, 1, true,
            );
        }
        assert_eq!(shared.lock().unwrap().result, Some(0));
        shared.lock().unwrap().result = None;
        unsafe {
            IOBluetoothDeviceInquiryDelegate::deviceInquiryComplete_error_aborted(
                &*delegate, None, 0, true,
            )
        };
        assert_eq!(shared.lock().unwrap().result, Some(-1));
    }

    #[test]
    fn connect_and_disconnect_require_observed_state() {
        let bluetooth = Bluetooth {
            pending: pending(),
            ..Default::default()
        };
        let connected = std::cell::Cell::new(false);
        bluetooth
            .verify_connection(
                "one",
                true,
                Instant::now() + Duration::from_millis(100),
                || {
                    connected.set(true);
                    connected.get()
                },
            )
            .unwrap();
        bluetooth
            .verify_connection(
                "one",
                false,
                Instant::now() + Duration::from_millis(100),
                || {
                    connected.set(false);
                    connected.get()
                },
            )
            .unwrap();
        assert!(bluetooth
            .verify_connection(
                "one",
                true,
                Instant::now() + Duration::from_millis(1),
                || false
            )
            .is_err());
    }

    #[test]
    fn cancelled_pair_connection_closes_the_new_link() {
        let bluetooth = Bluetooth {
            pending: pending(),
            ..Default::default()
        };
        let connected = std::cell::Cell::new(false);
        let closes = std::cell::Cell::new(0);
        let result = bluetooth.set_connection(
            "one",
            true,
            Instant::now() + Duration::from_millis(100),
            || connected.get(),
            || {
                connected.set(true);
                retire(
                    &mut bluetooth.pending.lock().unwrap(),
                    "cancelled",
                    "Cancelled.",
                );
                0
            },
            || {
                closes.set(closes.get() + 1);
                connected.set(false);
                0
            },
        );
        assert_eq!(result.unwrap_err(), "Bluetooth operation cancelled.");
        assert!(!connected.get());
        assert_eq!(closes.get(), 1);
    }

    #[test]
    fn connection_exists_error_succeeds_when_link_is_observed() {
        let bluetooth = Bluetooth {
            pending: pending(),
            ..Default::default()
        };
        let connected = std::cell::Cell::new(false);
        bluetooth
            .set_connection(
                "one",
                true,
                Instant::now() + Duration::from_millis(100),
                || connected.get(),
                || {
                    connected.set(true);
                    -1
                },
                || panic!("successful connection must stay open"),
            )
            .unwrap();
    }

    #[test]
    fn disconnect_retries_once_when_success_does_not_change_readback() {
        let bluetooth = Bluetooth {
            pending: pending(),
            ..Default::default()
        };
        let connected = std::cell::Cell::new(true);
        let closes = std::cell::Cell::new(0);
        bluetooth
            .set_connection(
                "one",
                false,
                Instant::now() + Duration::from_secs(2),
                || connected.get(),
                || panic!("disconnect must not open a link"),
                || {
                    closes.set(closes.get() + 1);
                    if closes.get() == 2 {
                        connected.set(false);
                    }
                    0
                },
            )
            .unwrap();
        assert_eq!(closes.get(), 2);
    }
}
