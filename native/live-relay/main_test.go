package main

import (
	"encoding/json"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pion/logging"
	"github.com/pion/turn/v5"
)

// Driven by the real hub integration test. Credentials travel only over stdin.
func TestRevocationClientProcess(t *testing.T) {
	if os.Getenv("COUCH_TEST_REVOCATION_CLIENT") != "1" {
		return
	}
	input, output := json.NewDecoder(os.Stdin), json.NewEncoder(os.Stdout)
	var config struct{ URLs, Username, Credential string }
	if input.Decode(&config) != nil {
		t.Fatal("missing client configuration")
	}
	address := strings.Split(strings.TrimPrefix(config.URLs, "turn:"), "?")[0]
	conn, err := net.DialTimeout("tcp4", address, time.Second)
	if err != nil {
		_ = output.Encode(map[string]bool{"allocated": false})
		return
	}
	defer conn.Close()
	logger := logging.NewDefaultLoggerFactory()
	logger.DefaultLogLevel = logging.LogLevelDisabled
	client, err := turn.NewClient(&turn.ClientConfig{TURNServerAddr: address, STUNServerAddr: address, Conn: turn.NewSTUNConn(conn), Username: config.Username, Password: config.Credential, Realm: "couch-lan", RTO: 20 * time.Millisecond, LoggerFactory: logger})
	if err != nil || client.Listen() != nil {
		t.Fatal("client could not listen")
	}
	defer client.Close()
	allocation, err := client.Allocate()
	if err != nil {
		_ = output.Encode(map[string]bool{"allocated": false})
		return
	}
	defer allocation.Close()
	// Prove this is a usable allocation before Core revokes it.
	peer, err := net.ListenPacket("udp4", net.JoinHostPort(addressIP(allocation.LocalAddr()).String(), "0"))
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	_ = peer.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err = allocation.WriteTo([]byte("before-revocation"), peer.LocalAddr()); err != nil {
		t.Fatal("allocation could not send")
	}
	buffer := make([]byte, 64)
	n, _, err := peer.ReadFrom(buffer)
	if err != nil || string(buffer[:n]) != "before-revocation" {
		t.Fatal("relay did not carry the datagram")
	}
	_ = output.Encode(map[string]bool{"allocated": true})
	var command string
	if input.Decode(&command) != nil || command != "released" {
		return
	}
	// Keep the client allocation open: only Core's revocation may release the server socket.
	replacement, err := net.ListenPacket("udp4", allocation.LocalAddr().String())
	if err != nil {
		t.Fatal("allocation socket survived device removal")
	}
	replacement.Close()
	_ = output.Encode(map[string]bool{"released": true})
}

func lanConfiguration(t *testing.T) configuration {
	t.Helper()
	interfaces, err := net.Interfaces()
	if err != nil {
		t.Fatal(err)
	}
	for _, iface := range interfaces {
		addresses, _ := iface.Addrs()
		for _, address := range addresses {
			ip, network, err := net.ParseCIDR(address.String())
			if err == nil && ip.To4() != nil && ip.IsPrivate() {
				return configuration{ip.String(), net.IP(network.Mask).String(), strings.Repeat("u", 24), strings.Repeat("p", 48)}
			}
		}
	}
	t.Skip("relay integration requires a private IPv4 interface")
	return configuration{}
}

func relayClient(t *testing.T, address, username, password string) *turn.Client {
	t.Helper()
	conn, err := net.DialTimeout("tcp4", address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	logger := logging.NewDefaultLoggerFactory()
	logger.DefaultLogLevel = logging.LogLevelDisabled
	client, err := turn.NewClient(&turn.ClientConfig{TURNServerAddr: address, STUNServerAddr: address, Conn: turn.NewSTUNConn(conn), Username: username, Password: password, Realm: "couch-lan", RTO: 20 * time.Millisecond, LoggerFactory: logger})
	if err != nil {
		t.Fatal(err)
	}
	if err = client.Listen(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	return client
}

func TestAuthenticatedLANRelay(t *testing.T) {
	config := lanConfiguration(t)
	server, listener, err := start(config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	wrong := relayClient(t, listener.Addr().String(), config.Username, "incorrect")
	if connection, err := wrong.Allocate(); err == nil {
		_ = connection.Close()
		t.Fatal("invalid credentials obtained an allocation")
	}
	client := relayClient(t, listener.Addr().String(), config.Username, config.Credential)
	relay, err := client.Allocate()
	if err != nil {
		t.Fatal(err)
	}
	defer relay.Close()
	if !addressIP(relay.LocalAddr()).Equal(net.ParseIP(config.Address)) {
		t.Fatal("allocation escaped selected LAN address")
	}
	peer, err := net.ListenPacket("udp4", net.JoinHostPort(config.Address, "0"))
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	_ = peer.SetDeadline(time.Now().Add(2 * time.Second))
	_ = relay.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err = relay.WriteTo([]byte("relay-test"), peer.LocalAddr()); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, 64)
	n, source, err := peer.ReadFrom(buffer)
	if err != nil || string(buffer[:n]) != "relay-test" {
		t.Fatalf("relay did not carry datagram: %v", err)
	}
	if _, err = peer.WriteTo([]byte("reply"), source); err != nil {
		t.Fatal(err)
	}
	n, _, err = relay.ReadFrom(buffer)
	if err != nil || string(buffer[:n]) != "reply" {
		t.Fatalf("relay did not return datagram: %v", err)
	}
	for _, address := range []string{"127.0.0.1", "8.8.8.8", "224.0.0.1"} {
		if err := client.CreatePermission(&net.UDPAddr{IP: net.ParseIP(address), Port: 9}); err == nil {
			t.Fatalf("permission escaped LAN to %s", address)
		}
	}
}

func TestConfigurationBoundary(t *testing.T) {
	config := configuration{"192.168.1.20", "255.255.255.0", strings.Repeat("u", 24), strings.Repeat("p", 48)}
	network, _ := config.network()
	for _, address := range []string{"192.168.1.0", "192.168.1.255", "192.168.2.20", "127.0.0.1", "8.8.8.8", "224.0.0.1"} {
		if allowedPeer(network, net.ParseIP(address)) {
			t.Fatalf("peer boundary admitted %s", address)
		}
	}
	if !allowedPeer(network, net.ParseIP("192.168.1.21")) {
		t.Fatal("LAN receiver was rejected")
	}
	for _, address := range []string{"0.0.0.0", "127.0.0.1", "8.8.8.8", "::1"} {
		changed := config
		changed.Address = address
		if _, err := changed.network(); err == nil {
			t.Fatalf("accepted address %s", address)
		}
	}
	for _, mask := range []string{"0.0.0.0", "255.0.255.0"} {
		changed := config
		changed.Netmask = mask
		if _, err := changed.network(); err == nil {
			t.Fatalf("accepted netmask %s", mask)
		}
	}
}

func TestHelperProcess(t *testing.T) {
	if os.Getenv("COUCH_TEST_RELAY_HELPER") != "1" {
		return
	}
	if run() != nil {
		os.Exit(1)
	}
	os.Exit(0)
}

func TestCorePipeClosureStopsEverySocket(t *testing.T) {
	config := lanConfiguration(t)
	child := exec.Command(os.Args[0], "-test.run=^TestHelperProcess$")
	child.Env = append(os.Environ(), "COUCH_TEST_RELAY_HELPER=1")
	input, _ := child.StdinPipe()
	output, _ := child.StdoutPipe()
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = child.Process.Kill() })
	if err := json.NewEncoder(input).Encode(config); err != nil {
		t.Fatal(err)
	}
	var ready struct {
		Port int `json:"port"`
	}
	if err := json.NewDecoder(output).Decode(&ready); err != nil {
		t.Fatal(err)
	}
	address := net.JoinHostPort(config.Address, strconv.Itoa(ready.Port))
	client := relayClient(t, address, config.Username, config.Credential)
	allocation, err := client.Allocate()
	if err != nil {
		t.Fatal(err)
	}
	relayAddress := allocation.LocalAddr().String()
	// Core's pipe closes even when Core is killed rather than shut down cleanly.
	_ = input.Close()
	done := make(chan error, 1)
	go func() { done <- child.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("helper survived parent pipe closure")
	}
	if conn, err := net.DialTimeout("tcp4", address, 100*time.Millisecond); err == nil {
		conn.Close()
		t.Fatal("TURN listener survived Core")
	}
	replacement, err := net.ListenPacket("udp4", relayAddress)
	if err != nil {
		t.Fatal("allocation socket survived Core")
	}
	replacement.Close()
}
