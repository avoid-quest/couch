//! A private D-Bus BlueZ double. No adapter or production system bus is used.
use super::{Action, Bluetooth};
use dbus::{channel::MatchingReceiver, nonblock::Proxy, Path};
use dbus_crossroads::Crossroads;
use serde_json::{json, Value};
use std::{sync::{Arc, Mutex}, time::Duration};
const DEVICE: &str = "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF";
const ADDRESS: &str = "AA:BB:CC:DD:EE:FF";
const AUDIO: &str = "0000110b-0000-1000-8000-00805f9b34fb";
#[derive(Default)]
struct State { powered: bool, paired: bool, trusted: bool, connected: bool, scanning: bool, cancelled: usize, stopped: usize, mode: String, agent: Option<(String, Path<'static>)>, connects: Vec<String> }
type Data = Arc<Mutex<State>>;
fn action(op: &str) -> Action { serde_json::from_value(json!({"op":op,"owner":"administrator","device":ADDRESS})).unwrap() }
async fn operation(client: &Bluetooth, predicate: impl Fn(&Value) -> bool) -> Value {
    for _ in 0..200 {
        let state = client.request(action("read")).await.unwrap();
        if predicate(&state["operation"]) { return state["operation"].clone(); }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("Bluetooth operation did not reach expected state");
}

#[tokio::test]
#[ignore = "Run with an isolated DBUS_SYSTEM_BUS_ADDRESS; uses a fake org.bluez service"]
async fn bluez_pair_discovery_cancel_reconnect_and_forget() {
    assert!(std::env::var("DBUS_SYSTEM_BUS_ADDRESS").unwrap().contains("couch-bluetooth"), "Never use the production system bus");
    let (resource, connection) = dbus_tokio::connection::new_system_sync().unwrap();
    let transport = tokio::spawn(async { resource.await });
    connection.request_name("org.bluez", false, true, false).await.unwrap();
    let data: Data = Arc::new(Mutex::new(State { powered: true, mode: "confirm".into(), ..Default::default() }));
    let mut cr = Crossroads::new();
    cr.set_async_support(Some((connection.clone(), Box::new(|future| { tokio::spawn(future); }))));
    cr.set_object_manager_support(Some(connection.clone()));
    let adapter = cr.register("org.bluez.Adapter1", |builder| {
        builder.property::<String, _>("Address").get(|_, _: &mut Data| Ok("11:22:33:44:55:66".into()));
        builder.property::<bool, _>("Powered").get(|_, data: &mut Data| Ok(data.lock().unwrap().powered)).set(|_, data: &mut Data, value| { data.lock().unwrap().powered = value; Ok(Some(value)) });
        builder.method("SetDiscoveryFilter", ("filter",), (), |_, _: &mut Data, (filter,): (dbus::arg::PropMap,)| {
            assert!(filter.get("Discoverable").is_none_or(|value| value.0.as_i64() == Some(0))); Ok(())
        });
        builder.method("StartDiscovery", (), (), |_, data: &mut Data, (): ()| { data.lock().unwrap().scanning = true; Ok(()) });
        builder.method("StopDiscovery", (), (), |_, data: &mut Data, (): ()| { let mut state = data.lock().unwrap(); state.scanning = false; state.stopped += 1; Ok(()) });
        builder.method_with_cr("RemoveDevice", ("device",), (), |_, cr, (path,): (Path<'static>,)| { cr.remove::<Data>(&path); Ok(()) });
    });
    let agent = cr.register("org.bluez.AgentManager1", |builder| {
        builder.method("RegisterAgent", ("path", "capability"), (), |context, data: &mut Data, (path, capability): (Path<'static>, String)| {
            assert_eq!(capability, "KeyboardDisplay"); data.lock().unwrap().agent = Some((context.message().sender().unwrap().to_string(), path)); Ok(())
        });
        builder.method("UnregisterAgent", ("path",), (), |_, data: &mut Data, (_path,): (Path<'static>,)| { data.lock().unwrap().agent = None; Ok(()) });
    });
    let pair_connection = connection.clone();
    let device = cr.register("org.bluez.Device1", move |builder| {
        builder.property::<String, _>("Address").get(|_, _: &mut Data| Ok(ADDRESS.into()));
        builder.property::<String, _>("Alias").get(|_, _: &mut Data| Ok("C39S test double".into()));
        builder.property::<Vec<String>, _>("UUIDs").get(|_, _: &mut Data| Ok(vec![AUDIO.into()]));
        builder.property::<bool, _>("Paired").get(|_, data: &mut Data| Ok(data.lock().unwrap().paired));
        builder.property::<bool, _>("Connected").get(|_, data: &mut Data| Ok(data.lock().unwrap().connected));
        builder.property::<bool, _>("Trusted").get(|_, data: &mut Data| Ok(data.lock().unwrap().trusted)).set(|_, data: &mut Data, value| { data.lock().unwrap().trusted = value; Ok(Some(value)) });
        builder.method_with_cr_async("Pair", (), (), move |mut context, cr, (): ()| {
            let data = cr.data_mut::<Data>(context.path()).unwrap().clone(); let connection = pair_connection.clone();
            async move {
                let (mode, agent) = { let state = data.lock().unwrap(); (state.mode.clone(), state.agent.clone().unwrap()) };
                if mode == "error" { return context.reply(Err(dbus::MethodErr::from(("org.bluez.Error.AuthenticationFailed", "Authentication failed")))); }
                let proxy = Proxy::new(agent.0, agent.1, Duration::from_secs(70), connection);
                let reply: Result<(), dbus::Error> = if mode == "pin" {
                    let result: Result<(String,), _> = proxy.method_call("org.bluez.Agent1", "RequestPinCode", (Path::new(DEVICE).unwrap(),)).await;
                    result.map(|(pin,)| assert_eq!(pin, "0000"))
                } else if mode == "display" {
                    let result = proxy.method_call("org.bluez.Agent1", "DisplayPinCode", (Path::new(DEVICE).unwrap(), "0000".to_string())).await;
                    tokio::time::sleep(Duration::from_millis(100)).await; result
                } else if mode == "passkey" {
                    let result: Result<(u32,), _> = proxy.method_call("org.bluez.Agent1", "RequestPasskey", (Path::new(DEVICE).unwrap(),)).await; result.map(|(key,)| assert_eq!(key, 654321))
                } else { proxy.method_call("org.bluez.Agent1", "RequestConfirmation", (Path::new(DEVICE).unwrap(), 123456_u32)).await };
                match reply { Ok(()) => { data.lock().unwrap().paired = true; context.reply(Ok(())) }, Err(error) => context.reply(Err(dbus::MethodErr::failed(&error))) }
            }
        });
        builder.method("CancelPairing", (), (), |_, data: &mut Data, (): ()| { data.lock().unwrap().cancelled += 1; Ok(()) });
        builder.method("ConnectProfile", ("uuid",), (), |_, data: &mut Data, (uuid,): (String,)| { let mut state = data.lock().unwrap(); state.connects.push(uuid); state.connected = true; Ok(()) });
        builder.method("Disconnect", (), (), |_, data: &mut Data, (): ()| { data.lock().unwrap().connected = false; Ok(()) });
    });
    cr.insert("/", &[cr.object_manager()], ());
    cr.insert("/org/bluez", &[agent], data.clone());
    cr.insert("/org/bluez/hci0", &[adapter], data.clone());
    cr.insert(DEVICE, &[device], data.clone());
    let cr = Arc::new(Mutex::new(cr)); let dispatch = cr.clone();
    connection.start_receive(dbus::message::MatchRule::new_method_call(), Box::new(move |message, connection| { dispatch.lock().unwrap().handle_message(message, connection).unwrap(); true }));
    let client = Bluetooth::default();
    let read = tokio::spawn({ let client = client.clone(); async move { client.request(action("read")).await } }).await.unwrap().unwrap();
    assert_eq!(read["devices"][0]["paired"], false);
    data.lock().unwrap().powered = false;
    assert_eq!(client.request(action("read")).await.unwrap()["adapter"], "off");
    client.request(action("power")).await.unwrap(); operation(&client, |op| op["status"] == "finished").await;
    assert_eq!(client.request(action("read")).await.unwrap()["adapter"], "available");
    client.request(action("scan")).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(data.lock().unwrap().scanning);
    client.request(action("cancel")).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!data.lock().unwrap().scanning);
    assert!(data.lock().unwrap().stopped > 0);
    client.request(action("pair")).await.unwrap();
    let prompt = operation(&client, |op| op["prompt"]["kind"] == "confirm").await;
    let mut answer = action("answer"); answer.token = prompt["id"].as_str().map(str::to_string); answer.prompt = prompt["prompt"]["id"].as_str().map(str::to_string); answer.answer = Some("yes".into());
    let mut foreign = answer.clone(); foreign.owner = "other-administrator".into();
    assert!(client.request(foreign).await.is_err());
    client.request(action("cancel")).await.unwrap();
    assert!(client.request(answer).await.is_err(), "Late confirmation must not pair");
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(data.lock().unwrap().cancelled > 0);
    assert!(!data.lock().unwrap().paired);
    data.lock().unwrap().mode = "error".into();
    client.request(action("pair")).await.unwrap();
    let failure = operation(&client, |op| op["status"] == "error").await;
    assert!(failure["message"].as_str().unwrap().contains("Authentication failed"));
    assert!(!data.lock().unwrap().paired);
    data.lock().unwrap().mode = "confirm".into();
    client.request(action("pair")).await.unwrap();
    let expired_prompt = operation(&client, |op| !op["prompt"].is_null()).await;
    tokio::time::sleep(Duration::from_secs(61)).await;
    let timed_out = operation(&client, |op| op["status"] == "error").await;
    assert!(timed_out["message"].as_str().unwrap().contains("timed out"));
    assert!(timed_out["prompt"].is_null());
    let mut late = action("answer"); late.token = expired_prompt["id"].as_str().map(str::to_string); late.prompt = expired_prompt["prompt"]["id"].as_str().map(str::to_string); late.answer = Some("yes".into());
    assert!(client.request(late).await.is_err());
    assert!(!data.lock().unwrap().paired);
    data.lock().unwrap().mode = "pin".into();
    client.request(action("pair")).await.unwrap();
    let prompt = operation(&client, |op| op["prompt"]["kind"] == "pin").await;
    let mut stale_cancel = action("cancel"); stale_cancel.token = expired_prompt["id"].as_str().map(str::to_string);
    let still_current = client.request(stale_cancel).await.unwrap();
    assert_eq!(still_current["operation"]["id"], prompt["id"]);
    assert_eq!(still_current["operation"]["status"], "running");
    let mut answer = action("answer"); answer.token = prompt["id"].as_str().map(str::to_string); answer.prompt = prompt["prompt"]["id"].as_str().map(str::to_string); answer.answer = Some("0000".into());
    client.request(answer).await.unwrap();
    operation(&client, |op| op["status"] == "finished").await;
    assert!(data.lock().unwrap().trusted && data.lock().unwrap().connected);
    assert_eq!(data.lock().unwrap().connects, vec![AUDIO]);
    client.request(action("disconnect")).await.unwrap(); operation(&client, |op| op["status"] == "finished").await;
    assert!(!data.lock().unwrap().connected);
    // The daemon owns saved bonds across a fresh native client.
    let restarted = Bluetooth::default();
    restarted.request(action("reconnect")).await.unwrap(); operation(&restarted, |op| op["status"] == "finished").await;
    assert!(data.lock().unwrap().connected);
    restarted.request(action("forget")).await.unwrap(); operation(&restarted, |op| op["status"] == "finished").await;
    assert!(restarted.request(action("read")).await.unwrap()["devices"].as_array().unwrap().is_empty());
    // An object disappearing before a command cannot be paired or connected.
    restarted.request(action("connect")).await.unwrap();
    operation(&restarted, |op| op["status"] == "error").await;
    cr.lock().unwrap().insert(DEVICE, &[device], data.clone());
    { let mut state = data.lock().unwrap(); state.paired = false; state.trusted = false; state.connected = false; state.mode = "passkey".into(); }
    restarted.request(action("pair")).await.unwrap();
    let prompt = operation(&restarted, |op| op["prompt"]["kind"] == "passkey").await;
    let mut answer = action("answer"); answer.token = prompt["id"].as_str().map(str::to_string); answer.prompt = prompt["prompt"]["id"].as_str().map(str::to_string); answer.answer = Some("654321".into());
    restarted.request(answer).await.unwrap(); operation(&restarted, |op| op["status"] == "finished").await;
    { let mut state = data.lock().unwrap(); state.paired = false; state.mode = "display".into(); }
    restarted.request(action("pair")).await.unwrap();
    let shown = operation(&restarted, |op| op["prompt"]["kind"] == "display").await;
    assert_eq!(shown["prompt"]["value"], "0000");
    operation(&restarted, |op| op["status"] == "finished").await;
    cr.lock().unwrap().remove::<Data>(&Path::new("/org/bluez/hci0").unwrap());
    assert_eq!(restarted.request(action("read")).await.unwrap()["adapter"], "absent");
    client.close(); restarted.close(); transport.abort();
}
