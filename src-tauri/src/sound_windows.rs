use serde_json::{json, Value};
use windows::{
    core::{Interface, PCWSTR},
    Win32::{
        Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
        Media::Audio::{
            eConsole, eRender, Endpoints::IAudioEndpointVolume, IAudioSessionControl2,
            IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
            DEVICE_STATE_ACTIVE,
        },
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
                StructuredStorage::{PropVariantClear, PropVariantToStringAlloc},
                CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
            },
            Threading::GetCurrentProcessId,
        },
    },
};

struct Com;
impl Com {
    fn enter() -> Result<Self, String> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|e| e.to_string())?;
        Ok(Self)
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn endpoint_id(device: &IMMDevice) -> Result<String, String> {
    let id = unsafe { device.GetId() }.map_err(|e| e.to_string())?;
    let value = unsafe { id.to_string() }.map_err(|e| e.to_string());
    unsafe { CoTaskMemFree(Some(id.0.cast())) };
    value
}

fn endpoint_name(device: &IMMDevice) -> Result<String, String> {
    let store = unsafe { device.OpenPropertyStore(STGM_READ) }.map_err(|e| e.to_string())?;
    let mut value =
        unsafe { store.GetValue(&PKEY_Device_FriendlyName) }.map_err(|e| e.to_string())?;
    let name = unsafe { PropVariantToStringAlloc(&value) }.map_err(|e| e.to_string())?;
    let text = unsafe { name.to_string() }.map_err(|e| e.to_string());
    unsafe { CoTaskMemFree(Some(name.0.cast())) };
    unsafe { PropVariantClear(&mut value) }.map_err(|e| e.to_string())?;
    text
}

fn volume(device: &IMMDevice) -> Result<IAudioEndpointVolume, String> {
    unsafe { device.Activate(CLSCTX_ALL, None) }.map_err(|e| e.to_string())
}

fn enumerator() -> Result<IMMDeviceEnumerator, String> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.map_err(|e| e.to_string())
}

fn output(enumerator: &IMMDeviceEnumerator, id: &str) -> Result<IMMDevice, String> {
    if id.is_empty() || id.len() > 512 || id.contains('\0') {
        return Err("Choose an available output.".into());
    }
    let wide: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
    let device = unsafe { enumerator.GetDevice(PCWSTR(wide.as_ptr())) }
        .map_err(|_| "That audio output is unavailable.")?;
    if unsafe { device.GetState() }.map_err(|e| e.to_string())? != DEVICE_STATE_ACTIVE {
        return Err("That audio output is unavailable.".into());
    }
    Ok(device)
}

fn route(enumerator: &IMMDeviceEnumerator, pid: u32) -> Result<Option<String>, String> {
    let collection = unsafe { enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) }
        .map_err(|e| e.to_string())?;
    let mut found = None;
    for index in 0..unsafe { collection.GetCount() }
        .map_err(|e| e.to_string())?
        .min(64)
    {
        let device = unsafe { collection.Item(index) }.map_err(|e| e.to_string())?;
        let manager: IAudioSessionManager2 =
            unsafe { device.Activate(CLSCTX_ALL, None) }.map_err(|e| e.to_string())?;
        let sessions = unsafe { manager.GetSessionEnumerator() }.map_err(|e| e.to_string())?;
        for session in 0..unsafe { sessions.GetCount() }
            .map_err(|e| e.to_string())?
            .min(128)
        {
            let control: IAudioSessionControl2 = unsafe { sessions.GetSession(session) }
                .map_err(|e| e.to_string())?
                .cast()
                .map_err(|e| e.to_string())?;
            if unsafe { control.GetProcessId() }.map_err(|e| e.to_string())? != pid {
                continue;
            }
            let id = endpoint_id(&device)?;
            if found.as_ref().is_some_and(|previous| previous != &id) {
                return Err("The Windows player reported more than one output route.".into());
            }
            found = Some(id);
        }
    }
    Ok(found)
}

pub fn request(value: Value) -> Result<Value, String> {
    let _com = Com::enter()?;
    let devices = enumerator()?;
    match value["op"].as_str().unwrap_or_default() {
        "inventory" => {
            let default = unsafe { devices.GetDefaultAudioEndpoint(eRender, eConsole) }.ok().and_then(|device| endpoint_id(&device).ok());
            let collection = unsafe { devices.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) }.map_err(|e| e.to_string())?;
            let mut outputs = Vec::new();
            for index in 0..unsafe { collection.GetCount() }.map_err(|e| e.to_string())?.min(64) {
                let device = unsafe { collection.Item(index) }.map_err(|e| e.to_string())?;
                let id = endpoint_id(&device)?;
                let control = volume(&device)?;
                outputs.push(json!({"id":id,"name":endpoint_name(&device).unwrap_or(id),"state":"Available","availability":"available","volume":(unsafe { control.GetMasterVolumeLevelScalar() }.map_err(|e| e.to_string())? * 100.0).round(),"muted":unsafe { control.GetMute() }.map_err(|e| e.to_string())?.as_bool(),"volumeWritable":true,"muteWritable":true,"configurationAvailable":false}));
            }
            Ok(json!({"outputs":outputs,"defaultOutput":default,"profiles":[]}))
        }
        "route" => Ok(json!({"output":route(&devices, value["pid"].as_u64().map(|pid| pid as u32).unwrap_or_else(|| unsafe { GetCurrentProcessId() }))?})),
        "default" => Err("Windows does not expose a supported system default output setter. Couch selects its own playback output; use System Settings on the computer running Couch for the system default.".into()),
        "profile" => Err("Check in System Settings on the computer running Couch for this output configuration.".into()),
        "volume" | "mute" => {
            let device = output(&devices, value["output"].as_str().ok_or("Choose an available output.")?)?;
            let control = volume(&device)?;
            let level = value["value"].as_f64().filter(|level| (0.0..=1.0).contains(level)).ok_or("Invalid sound control.")?;
            if value["op"] == "volume" { unsafe { control.SetMasterVolumeLevelScalar(level as f32, std::ptr::null()) } }
            else { unsafe { control.SetMute(level != 0.0, std::ptr::null()) } }.map_err(|e| e.to_string())?;
            Ok(json!({"ok":true}))
        }
        _ => Err("Invalid sound control.".into()),
    }
}
