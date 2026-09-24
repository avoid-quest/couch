use super::Action;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::task::JoinHandle;
use windows::{
    core::{Interface, HSTRING},
    Devices::{
        Bluetooth::{BluetoothAdapter, BluetoothConnectionStatus, BluetoothDevice},
        Enumeration::{
            DeviceInformation, DevicePairingResultStatus, DeviceUnpairingResultStatus,
            DeviceWatcher,
        },
        Radios::{RadioAccessStatus, RadioState},
    },
    Foundation::TypedEventHandler,
};

const LIMIT: Duration = Duration::from_secs(60);

#[derive(Default)]
struct Pending {
    owner: String,
    operation: Option<Value>,
    task: Option<JoinHandle<()>>,
    found: BTreeSet<String>,
    ids: BTreeMap<String, String>,
}

#[derive(Default, Clone)]
pub struct Bluetooth {
    pending: Arc<Mutex<Pending>>,
}

fn millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
fn running(pending: &Pending) -> bool {
    pending
        .operation
        .as_ref()
        .is_some_and(|op| op["status"] == "running")
}
fn address(number: u64) -> String {
    let octets = number.to_be_bytes();
    octets[2..]
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}
fn error(error: windows::core::Error) -> String {
    error.to_string()
}

impl Bluetooth {
    fn retire(pending: &mut Pending) {
        if let Some(task) = pending.task.take() {
            task.abort();
        }
        if let Some(op) = pending
            .operation
            .as_mut()
            .filter(|op| op["status"] == "running")
        {
            op["status"] = json!("cancelled");
            op["message"] = json!("Bluetooth operation cancelled.");
        }
    }
    pub fn close(&self) {
        Self::retire(&mut self.pending.lock().unwrap());
    }

    async fn devices(&self) -> Result<Vec<Value>, String> {
        let selector = BluetoothDevice::GetDeviceSelector().map_err(error)?;
        let collection = DeviceInformation::FindAllAsyncAqsFilter(&selector)
            .map_err(error)?
            .get()
            .map_err(error)?;
        let mut ids = self.pending.lock().unwrap().found.clone();
        for index in 0..collection.Size().map_err(error)?.min(128) {
            ids.insert(
                collection
                    .GetAt(index)
                    .map_err(error)?
                    .Id()
                    .map_err(error)?
                    .to_string(),
            );
        }
        let mut devices = BTreeMap::new();
        let mut known = BTreeMap::new();
        for id in ids.into_iter().take(128) {
            let device_id = HSTRING::from(&id);
            let Ok(operation) = DeviceInformation::CreateFromIdAsync(&device_id) else {
                continue;
            };
            let Ok(info) = operation.get() else { continue };
            let Ok(operation) = BluetoothDevice::FromIdAsync(&device_id) else {
                continue;
            };
            let Ok(device) = operation.get() else {
                continue;
            };
            let Ok(number) = device.BluetoothAddress() else {
                continue;
            };
            let mac = address(number);
            let paired = info
                .Pairing()
                .and_then(|pairing| pairing.IsPaired())
                .unwrap_or(false);
            let connected = device
                .ConnectionStatus()
                .is_ok_and(|status| status == BluetoothConnectionStatus::Connected);
            let name = info
                .Name()
                .map(|name| name.to_string())
                .unwrap_or_else(|_| mac.clone());
            known.insert(mac.clone(), id);
            devices.insert(mac.clone(), json!({"address":mac,"name":name.chars().take(160).collect::<String>(),"paired":paired,"connected":connected}));
        }
        self.pending.lock().unwrap().ids = known;
        Ok(devices.into_values().collect())
    }

    async fn inventory(&self) -> Result<Value, String> {
        let operation = self.pending.lock().unwrap().operation.clone();
        let adapter = BluetoothAdapter::GetDefaultAsync()
            .map_err(error)?
            .get()
            .map_err(error)?;
        if adapter.as_raw().is_null() {
            return Ok(json!({"adapter":"absent","devices":[],"operation":operation}));
        }
        let radio = adapter
            .GetRadioAsync()
            .map_err(error)?
            .get()
            .map_err(error)?;
        let state = if radio.State().map_err(error)? == RadioState::On {
            "available"
        } else {
            "off"
        };
        Ok(json!({"adapter":state,"devices":self.devices().await?,"operation":operation}))
    }

    async fn perform(&self, action: &Action) -> Result<(), String> {
        match action.op.as_str() {
            "power" => {
                let adapter = BluetoothAdapter::GetDefaultAsync().map_err(error)?.get().map_err(error)?;
                if adapter.as_raw().is_null() { return Err("No Bluetooth adapter is available.".into()); }
                let radio = adapter.GetRadioAsync().map_err(error)?.get().map_err(error)?;
                let status = radio.SetStateAsync(RadioState::On).map_err(error)?.get().map_err(error)?;
                if status == RadioAccessStatus::Allowed { Ok(()) } else { Err("Windows denied Bluetooth power control. Check Bluetooth in System Settings on the playback host.".into()) }
            }
            "scan" => {
                // The unpaired selector requests an active Bluetooth scan on Windows.
                let selector = BluetoothDevice::GetDeviceSelectorFromPairingState(false).map_err(error)?;
                let watcher = DeviceInformation::CreateWatcherAqsFilter(&selector).map_err(error)?;
                let pending = self.pending.clone();
                let token = watcher.Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(move |_, info| {
                    if let Some(info) = info.as_ref() { if let Ok(id) = info.Id() { pending.lock().unwrap().found.insert(id.to_string()); } }
                    Ok(())
                })).map_err(error)?;
                watcher.Start().map_err(error)?;
                tokio::time::sleep(Duration::from_secs(20)).await;
                watcher.Stop().map_err(error)?;
                watcher.RemoveAdded(token).map_err(error)
            }
            "pair" | "forget" => {
                let address = action.device.as_deref().ok_or("Choose a device.")?;
                let id = self.pending.lock().unwrap().ids.get(address).cloned().ok_or("The device is no longer available. Scan again.")?;
                let info = DeviceInformation::CreateFromIdAsync(&HSTRING::from(id)).map_err(error)?.get().map_err(error)?;
                let pairing = info.Pairing().map_err(error)?;
                if action.op == "pair" {
                    if pairing.IsPaired().map_err(error)? { return Err("This device is already paired.".into()); }
                    // Windows owns the local pairing dialog; its confirmation must be made on the playback desktop.
                    let status = pairing.PairAsync().map_err(error)?.get().map_err(error)?.Status().map_err(error)?;
                    if status == DevicePairingResultStatus::Paired || status == DevicePairingResultStatus::AlreadyPaired { Ok(()) }
                    else { Err(format!("Windows pairing ended with status {}. Check the prompt on the playback desktop.", status.0)) }
                } else {
                    let status = pairing.UnpairAsync().map_err(error)?.get().map_err(error)?.Status().map_err(error)?;
                    if status == DeviceUnpairingResultStatus::Unpaired || status == DeviceUnpairingResultStatus::AlreadyUnpaired { Ok(()) }
                    else { Err(format!("Windows could not forget the device (status {}).", status.0)) }
                }
            }
            "connect" | "reconnect" | "disconnect" => Err("Change this Bluetooth device's connection in Windows System Settings on the playback host, then return to Couch to select its audio output.".into()),
            _ => Err("Unknown Bluetooth action.".into()),
        }
    }

    pub async fn request(&self, action: Action) -> Result<Value, String> {
        if action.owner.is_empty() || action.owner.len() > 128 {
            return Err("Invalid Bluetooth owner.".into());
        }
        match action.op.as_str() {
            "read" => {}
            "cancel" => {
                let mut pending = self.pending.lock().unwrap();
                if pending.owner == action.owner
                    && action.token.as_ref().is_none_or(|token| {
                        pending
                            .operation
                            .as_ref()
                            .is_some_and(|op| op["id"] == *token)
                    })
                {
                    Self::retire(&mut pending);
                }
            }
            "answer" => return Err("Confirm pairing on the Windows desktop.".into()),
            _ => {
                let mut pending = self.pending.lock().unwrap();
                if running(&pending) {
                    return Err("Stop the current Bluetooth operation first.".into());
                }
                let id = match action.token.as_deref() {
                    Some(token) => uuid::Uuid::parse_str(token)
                        .map_err(|_| "Invalid Bluetooth operation token.")?
                        .to_string(),
                    None => uuid::Uuid::new_v4().to_string(),
                };
                pending.owner = action.owner.clone();
                pending.operation = Some(
                    json!({"id":id,"device":action.device,"kind":action.op,"status":"running","endsAt":millis()+LIMIT.as_millis(),"message":if action.op == "pair" { Some("Confirm the pairing prompt on the Windows playback desktop.") } else { None },"prompt":null}),
                );
                let this = self.clone();
                pending.task = Some(tokio::spawn(async move {
                    let result = tokio::time::timeout(LIMIT, this.perform(&action))
                        .await
                        .unwrap_or_else(|_| Err("Bluetooth timed out. Try again.".into()));
                    let mut pending = this.pending.lock().unwrap();
                    if let Some(op) = pending
                        .operation
                        .as_mut()
                        .filter(|op| op["id"] == id && op["status"] == "running")
                    {
                        op["status"] = json!(if result.is_ok() { "finished" } else { "error" });
                        op["message"] = json!(result.err());
                    }
                }));
            }
        }
        tokio::time::timeout(Duration::from_secs(4), self.inventory())
            .await
            .map_err(|_| "Bluetooth inventory timed out.")?
    }
}
