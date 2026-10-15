// Couch's private LAN TURN helper. Pion handles TURN; this process owns only
// configuration, the LAN boundary, and its lifetime under Core's stdin pipe.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/pion/logging"
	"github.com/pion/turn/v5"
)

type configuration struct {
	Address    string `json:"address"`
	Netmask    string `json:"netmask"`
	Username   string `json:"username"`
	Credential string `json:"credential"`
}

func (c configuration) network() (*net.IPNet, error) {
	ip, mask := net.ParseIP(c.Address).To4(), net.ParseIP(c.Netmask).To4()
	if ip == nil || !ip.IsPrivate() || mask == nil || len(c.Username) < 16 || len(c.Credential) < 32 {
		return nil, errors.New("invalid private LAN configuration")
	}
	bits, size := net.IPMask(mask).Size()
	if bits == 0 || size != 32 {
		return nil, errors.New("invalid LAN netmask")
	}
	return &net.IPNet{IP: ip.Mask(net.IPMask(mask)), Mask: net.IPMask(mask)}, nil
}

func allowedPeer(network *net.IPNet, peer net.IP) bool {
	ip := peer.To4()
	if ip == nil || !ip.IsPrivate() || !network.Contains(ip) || ip.Equal(network.IP) {
		return false
	}
	broadcast := make(net.IP, 4)
	for i := range broadcast {
		broadcast[i] = network.IP[i] | ^network.Mask[i]
	}
	return !ip.Equal(broadcast)
}

func addressIP(address net.Addr) net.IP {
	host, _, err := net.SplitHostPort(address.String())
	if err != nil {
		return nil
	}
	return net.ParseIP(host)
}

// WebRTC requires UDP allocations even when the client reaches TURN over TCP.
// Do not expose TURN's unrelated TCP proxy extension.
type udpRelay struct {
	turn.RelayAddressGeneratorStatic
}

func (*udpRelay) AllocateListener(turn.AllocateListenerConfig) (net.Listener, net.Addr, error) {
	return nil, nil, errors.New("only UDP allocations are supported")
}
func (*udpRelay) AllocateConn(turn.AllocateConnConfig) (net.Conn, error) {
	return nil, errors.New("only UDP allocations are supported")
}

func start(c configuration) (*turn.Server, net.Listener, error) {
	network, err := c.network()
	if err != nil {
		return nil, nil, err
	}
	listener, err := net.Listen("tcp4", net.JoinHostPort(c.Address, "0"))
	if err != nil {
		return nil, nil, errors.New("could not bind the selected LAN address")
	}
	const realm = "couch-lan"
	key := turn.GenerateAuthKey(c.Username, realm, c.Credential)
	logger := logging.NewDefaultLoggerFactory()
	logger.DefaultLogLevel = logging.LogLevelDisabled
	server, err := turn.NewServer(turn.ServerConfig{
		Realm: realm, LoggerFactory: logger,
		AuthHandler: func(request *turn.RequestAttributes) (string, []byte, bool) {
			if request.Username != c.Username || request.Realm != realm || !allowedPeer(network, addressIP(request.SrcAddr)) {
				return "", nil, false
			}
			return c.Username, key, true
		},
		ListenerConfigs: []turn.ListenerConfig{{
			Listener:              listener,
			RelayAddressGenerator: &udpRelay{turn.RelayAddressGeneratorStatic{RelayAddress: net.ParseIP(c.Address), Address: c.Address}},
			PermissionHandler: func(client net.Addr, peer net.IP) bool {
				return allowedPeer(network, addressIP(client)) && allowedPeer(network, peer)
			},
		}},
	})
	if err != nil {
		_ = listener.Close()
		return nil, nil, errors.New("could not start TURN")
	}
	return server, listener, nil
}

func run() error {
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 4096), 8192)
	if !input.Scan() {
		return errors.New("missing configuration")
	}
	var config configuration
	if json.Unmarshal(input.Bytes(), &config) != nil {
		return errors.New("invalid configuration")
	}
	server, listener, err := start(config)
	if err != nil {
		return err
	}
	defer server.Close()
	if err := json.NewEncoder(os.Stdout).Encode(struct {
		Port int `json:"port"`
	}{listener.Addr().(*net.TCPAddr).Port}); err != nil {
		return errors.New("Core is unavailable")
	}
	// EOF also covers Core being killed: the helper never becomes a daemon.
	ended := make(chan struct{})
	go func() {
		for input.Scan() {
		}
		close(ended)
	}()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	select {
	case <-ended:
	case <-signals:
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
