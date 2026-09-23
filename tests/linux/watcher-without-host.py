"""A StatusNotifier watcher with no tray host for the native Close regression."""

import dbus
import dbus.service
import dbus.mainloop.glib
from gi.repository import GLib

dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
name = dbus.service.BusName("org.kde.StatusNotifierWatcher", bus)


class Watcher(dbus.service.Object):
    @dbus.service.method("org.kde.StatusNotifierWatcher", in_signature="s")
    def RegisterStatusNotifierItem(self, service):
        pass

    @dbus.service.method("org.freedesktop.DBus.Properties", in_signature="ss", out_signature="v")
    def Get(self, interface, prop):
        if interface != "org.kde.StatusNotifierWatcher":
            raise dbus.exceptions.DBusException("Unknown interface")
        if prop == "IsStatusNotifierHostRegistered":
            return dbus.Boolean(False, variant_level=1)
        if prop == "RegisteredStatusNotifierItems":
            return dbus.Array([], signature="s", variant_level=1)
        raise dbus.exceptions.DBusException("Unknown property")


watcher = Watcher(bus, "/StatusNotifierWatcher")
GLib.MainLoop().run()
