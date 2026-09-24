use super::Action;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::task::JoinHandle;
use windows::{
    core::{Interface, HSTRING},
    Devices::{
        Bluetooth::{BluetoothAdapter, BluetoothDevice},
        Enumeration::{
            DeviceInformation, DeviceInformationKind, DevicePairingResultStatus,
            DeviceUnpairingResultStatus,
        },
        Radios::{RadioAccessStatus, RadioState},
    },
    Foundation::IPropertyValue,
    Win32::Devices::Bluetooth::{
        BluetoothAuthenticateDeviceEx, BluetoothFindDeviceClose, BluetoothFindFirstDevice,
        BluetoothFindNextDevice, BluetoothRemoveDevice, MITMProtectionNotRequiredBonding,
        BLUETOOTH_DEVICE_INFO, BLUETOOTH_DEVICE_SEARCH_PARAMS,
    },
};
use windows_collections::IIterable;

const LIMIT: Duration = Duration::from_secs(60);
const ADDRESS: &str = "System.Devices.Aep.DeviceAddress";
const CONNECTED: &str = "System.Devices.Aep.IsConnected";

#[derive(Default)]
struct Pending {
    owner: String,
    operation: Option<Value>,
    task: Option<JoinHandle<()>>,
    devices: BTreeMap<String, DeviceInformation>,
    classic: BTreeMap<String, BLUETOOTH_DEVICE_INFO>,
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
fn error(error: windows::core::Error) -> String {
    error.to_string()
}
fn properties() -> IIterable<HSTRING> {
    vec![HSTRING::from(ADDRESS), HSTRING::from(CONNECTED)].into()
}
fn device_details(info: &DeviceInformation) -> Option<(String, Value)> {
    let props = info.Properties().ok()?;
    let raw = props
        .Lookup(&HSTRING::from(ADDRESS))
        .ok()?
        .cast::<IPropertyValue>()
        .ok()?
        .GetString()
        .ok()?
        .to_string();
    let hex: String = raw.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 12 {
        return None;
    }
    let mac = hex
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| std::str::from_utf8(pair).unwrap().to_ascii_uppercase())
        .collect::<Vec<_>>()
        .join(":");
    let paired = info
        .Pairing()
        .and_then(|pairing| pairing.IsPaired())
        .unwrap_or(false);
    let connected = props
        .Lookup(&HSTRING::from(CONNECTED))
        .ok()
        .and_then(|value| value.cast::<IPropertyValue>().ok())
        .and_then(|value| value.GetBoolean().ok())
        .unwrap_or(false);
    let name = info
        .Name()
        .map(|name| name.to_string())
        .unwrap_or_else(|_| mac.clone());
    Some((
        mac.clone(),
        json!({"address":mac,"name":name.chars().take(160).collect::<String>(),"paired":paired,"connected":connected}),
    ))
}

fn classic_address(info: &BLUETOOTH_DEVICE_INFO) -> String {
    let address = unsafe { info.Address.Anonymous.ullLong };
    let hex = format!("{address:012X}");
    hex.as_bytes()
        .chunks_exact(2)
        .map(|pair| std::str::from_utf8(pair).unwrap())
        .collect::<Vec<_>>()
        .join(":")
}

fn classic_devices(inquiry: bool) -> Result<BTreeMap<String, BLUETOOTH_DEVICE_INFO>, String> {
    let search = BLUETOOTH_DEVICE_SEARCH_PARAMS {
        dwSize: std::mem::size_of::<BLUETOOTH_DEVICE_SEARCH_PARAMS>() as u32,
        fReturnAuthenticated: true.into(),
        fReturnRemembered: true.into(),
        fReturnUnknown: true.into(),
        fReturnConnected: true.into(),
        fIssueInquiry: inquiry.into(),
        cTimeoutMultiplier: if inquiry { 10 } else { 0 },
        ..Default::default()
    };
    let mut info = BLUETOOTH_DEVICE_INFO {
        dwSize: std::mem::size_of::<BLUETOOTH_DEVICE_INFO>() as u32,
        ..Default::default()
    };
    let handle = unsafe { BluetoothFindFirstDevice(&search, &mut info) }.map_err(error)?;
    let mut devices = BTreeMap::new();
    loop {
        devices.insert(classic_address(&info), info);
        info = BLUETOOTH_DEVICE_INFO {
            dwSize: std::mem::size_of::<BLUETOOTH_DEVICE_INFO>() as u32,
            ..Default::default()
        };
        if unsafe { BluetoothFindNextDevice(handle, &mut info) }.is_err() {
            break;
        }
    }
    unsafe { BluetoothFindDeviceClose(handle) }.map_err(error)?;
    Ok(devices)
}

fn classic_details(info: &BLUETOOTH_DEVICE_INFO) -> Value {
    let address = classic_address(info);
    let len = info
        .szName
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(info.szName.len());
    let name = String::from_utf16_lossy(&info.szName[..len]);
    json!({"address":address,"name":if name.is_empty() { address.clone() } else { name },"paired":info.fAuthenticated.as_bool(),"connected":info.fConnected.as_bool()})
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
        let selector = BluetoothDevice::GetDeviceSelectorFromPairingState(true).map_err(error)?;
        let collection = DeviceInformation::FindAllAsyncWithKindAqsFilterAndAdditionalProperties(
            &selector,
            &properties(),
            DeviceInformationKind::AssociationEndpoint,
        )
        .map_err(error)?
        .get()
        .map_err(error)?;
        let mut ids = BTreeMap::new();
        for index in 0..collection.Size().map_err(error)?.min(128) {
            let info = collection.GetAt(index).map_err(error)?;
            ids.insert(info.Id().map_err(error)?.to_string(), info);
        }
        let mut devices = BTreeMap::new();
        let mut known = BTreeMap::new();
        for (_, info) in ids.into_iter().take(128) {
            if let Some((mac, value)) = device_details(&info) {
                known.insert(mac.clone(), info);
                devices.insert(mac, value);
            }
        }
        let mut pending = self.pending.lock().unwrap();
        pending.devices = known;
        for (address, info) in &pending.classic {
            devices.insert(address.clone(), classic_details(info));
        }
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
                // Headsets use classic Bluetooth; Win32 inquiry finds them even when the WinRT AEP watcher does not.
                let devices = tokio::task::spawn_blocking(|| classic_devices(true)).await.map_err(|e| e.to_string())??;
                self.pending.lock().unwrap().classic = devices;
                Ok(())
            }
            "pair" | "forget" => {
                let address = action.device.as_deref().ok_or("Choose a device.")?;
                let classic = { self.pending.lock().unwrap().classic.get(address).copied() };
                if let Some(mut info) = classic {
                    let result = if action.op == "pair" {
                        tokio::task::spawn_blocking(move || unsafe { BluetoothAuthenticateDeviceEx(None, None, &mut info, None, MITMProtectionNotRequiredBonding) }).await.map_err(|e| e.to_string())?
                    } else {
                        tokio::task::spawn_blocking(move || unsafe { BluetoothRemoveDevice(&info.Address) }).await.map_err(|e| e.to_string())?
                    };
                    if result != 0 { return Err(format!("Windows Bluetooth {} ended with code {result}.", action.op)); }
                    if let Ok(devices) = tokio::task::spawn_blocking(|| classic_devices(false)).await.map_err(|e| e.to_string())? {
                        self.pending.lock().unwrap().classic = devices;
                    }
                    return Ok(());
                }
                let info = self.pending.lock().unwrap().devices.get(address).cloned().ok_or("The device is no longer available. Scan again.")?;
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
