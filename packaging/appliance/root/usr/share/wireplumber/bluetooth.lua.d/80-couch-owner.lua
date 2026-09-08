-- WirePlumber 0.4 also treats an SSH login as active. Keep its Bluetooth
-- monitor from taking the appliance's audio devices into another user's graph.
if os.getenv("USER") ~= "couch-tv" then
  bluez_monitor.enabled = false
end
