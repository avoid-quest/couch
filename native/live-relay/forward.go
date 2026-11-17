// Couch's forwarding relay: the sharer sends one WebRTC stream here, and each
// viewer gets its packets unchanged, so the sharer encodes once however many
// watch. Pion handles WebRTC; Core does all signaling over stdin and stdout.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/logging"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

type forwardSignal struct {
	Description *webrtc.SessionDescription `json:"description,omitempty"`
	Candidate   *webrtc.ICECandidateInit   `json:"candidate,omitempty"`
}

// uplink: the sharer's connection for a source. downlink: one viewer's, of that source's picture and/or sound.
type forwardCommand struct {
	Op      string             `json:"op"`
	Peer    string             `json:"peer"`
	Source  string             `json:"source,omitempty"`
	Picture bool               `json:"picture,omitempty"`
	Sound   bool               `json:"sound,omitempty"`
	ICE     []webrtc.ICEServer `json:"ice,omitempty"`
	Signal  *forwardSignal     `json:"signal,omitempty"`
}

type forwardEvent struct {
	Op     string         `json:"op"`
	Peer   string         `json:"peer"`
	Signal *forwardSignal `json:"signal,omitempty"`
	Error  string         `json:"error,omitempty"`
}

type forwardSource struct {
	picture, sound *webrtc.TrackLocalStaticRTP
	uplink         *webrtc.PeerConnection
	mu             sync.Mutex
	pictureSSRC    webrtc.SSRC
}

// keyframe asks the sharer for a new picture a joining or recovering viewer can start from.
func (s *forwardSource) keyframe() {
	s.mu.Lock()
	ssrc := s.pictureSSRC
	s.mu.Unlock()
	if ssrc != 0 {
		_ = s.uplink.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(ssrc)}})
	}
}

type forwardPeer struct {
	connection *webrtc.PeerConnection
	source     *forwardSource
	uplink     bool
	candidates []webrtc.ICECandidateInit
	received   int
}

// A browser sends one candidate per address and kind (host, server-reflexive, relay) on UDP and TCP:
// a dozen or two even with several networks. Pion pairs each with every local candidate, so more is ignored.
const forwardCandidates = 64

type forwarder struct {
	api     *webrtc.API
	mu      sync.Mutex
	sources map[string]*forwardSource
	peers   map[string]*forwardPeer
	output  sync.Mutex
	encoder *json.Encoder
}

// One codec every viewer can decode: H.264 Constrained Baseline is what every WebRTC browser offers. Sound is Opus.
var (
	forwardPicture = webrtc.RTPCodecCapability{
		MimeType: webrtc.MimeTypeH264, ClockRate: 90000,
		SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
		RTCPFeedback: []webrtc.RTCPFeedback{
			{Type: "goog-remb"}, {Type: "ccm", Parameter: "fir"}, {Type: "nack"}, {Type: "nack", Parameter: "pli"},
		},
	}
	forwardSound = webrtc.RTPCodecCapability{
		MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2, SDPFmtpLine: "minptime=10;useinbandfec=1",
	}
)

func newForwarder(output io.Writer) (*forwarder, error) {
	media := &webrtc.MediaEngine{}
	if err := media.RegisterCodec(webrtc.RTPCodecParameters{RTPCodecCapability: forwardPicture, PayloadType: 102}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, err
	}
	if err := media.RegisterCodec(webrtc.RTPCodecParameters{RTPCodecCapability: forwardSound, PayloadType: 111}, webrtc.RTPCodecTypeAudio); err != nil {
		return nil, err
	}
	// NACK both ways, receiver reports, and transport-wide feedback so the sharer's encoder follows its own link.
	registry := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(media, registry); err != nil {
		return nil, err
	}
	settings := webrtc.SettingEngine{}
	logger := logging.NewDefaultLoggerFactory()
	logger.DefaultLogLevel = logging.LogLevelDisabled
	settings.LoggerFactory = logger
	return &forwarder{
		api:     webrtc.NewAPI(webrtc.WithMediaEngine(media), webrtc.WithInterceptorRegistry(registry), webrtc.WithSettingEngine(settings)),
		sources: map[string]*forwardSource{},
		peers:   map[string]*forwardPeer{},
		encoder: json.NewEncoder(output),
	}, nil
}

func (f *forwarder) emit(event forwardEvent) {
	f.output.Lock()
	defer f.output.Unlock()
	_ = f.encoder.Encode(event)
}

func (f *forwarder) fail(id string, peer *forwardPeer, reason string) {
	f.mu.Lock()
	current := f.peers[id] == peer
	f.mu.Unlock()
	if current {
		f.emit(forwardEvent{Op: "failed", Peer: id, Error: reason})
	}
}

func (f *forwarder) connect(id string, command forwardCommand) (*forwardPeer, error) {
	connection, err := f.api.NewPeerConnection(webrtc.Configuration{ICEServers: command.ICE})
	if err != nil {
		return nil, err
	}
	peer := &forwardPeer{connection: connection}
	connection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		init := candidate.ToJSON()
		f.emit(forwardEvent{Op: "signal", Peer: id, Signal: &forwardSignal{Candidate: &init}})
	})
	connection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		switch state {
		case webrtc.PeerConnectionStateConnected:
			// A viewer starts on the next keyframe; without one it shows nothing until the sharer's next.
			if !peer.uplink && peer.source != nil {
				peer.source.keyframe()
			}
		case webrtc.PeerConnectionStateFailed:
			f.fail(id, peer, "The connection through Couch failed.")
		}
	})
	return peer, nil
}

func (f *forwarder) uplink(command forwardCommand) error {
	source := &forwardSource{}
	var err error
	if command.Picture {
		if source.picture, err = webrtc.NewTrackLocalStaticRTP(forwardPicture, "picture", command.Source); err != nil {
			return err
		}
	}
	if command.Sound {
		if source.sound, err = webrtc.NewTrackLocalStaticRTP(forwardSound, "sound", command.Source); err != nil {
			return err
		}
	}
	peer, err := f.connect(command.Peer, command)
	if err != nil {
		return err
	}
	peer.uplink, peer.source, source.uplink = true, source, peer.connection
	// Like a viewer's, a sharer's connection on the LAN is up within a second or two; one that isn't, isn't awaited.
	time.AfterFunc(10*time.Second, func() {
		if peer.connection.ConnectionState() != webrtc.PeerConnectionStateConnected {
			f.fail(command.Peer, peer, "The connection to Couch didn't connect within 10 seconds.")
		}
	})
	peer.connection.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		local := source.sound
		if remote.Kind() == webrtc.RTPCodecTypeVideo {
			local = source.picture
			source.mu.Lock()
			source.pictureSSRC = remote.SSRC()
			source.mu.Unlock()
		}
		if local == nil || !strings.EqualFold(remote.Codec().MimeType, local.Codec().MimeType) {
			return
		}
		for {
			packet, _, err := remote.ReadRTP()
			if err != nil {
				return
			}
			// The sharer's header extension IDs mean nothing on a viewer's connection.
			packet.Header.Extension, packet.Header.Extensions = false, nil
			if err := local.WriteRTP(packet); err != nil && errors.Is(err, io.ErrClosedPipe) {
				return
			}
		}
	})
	f.mu.Lock()
	f.sources[command.Source] = source
	f.peers[command.Peer] = peer
	f.mu.Unlock()
	return nil
}

func (f *forwarder) downlink(command forwardCommand) error {
	f.mu.Lock()
	source := f.sources[command.Source]
	f.mu.Unlock()
	if source == nil {
		return errors.New("That share isn't reaching Couch.")
	}
	peer, err := f.connect(command.Peer, command)
	if err != nil {
		return err
	}
	peer.source = source
	f.mu.Lock()
	f.peers[command.Peer] = peer
	f.mu.Unlock()
	for _, track := range []*webrtc.TrackLocalStaticRTP{source.picture, source.sound} {
		if track == nil || (track == source.picture && !command.Picture) || (track == source.sound && !command.Sound) {
			continue
		}
		sender, err := peer.connection.AddTrack(track)
		if err != nil {
			return err
		}
		// Reading RTCP runs the NACK responder; a viewer's picture loss becomes one request to the sharer.
		go func() {
			for {
				packets, _, err := sender.ReadRTCP()
				if err != nil {
					return
				}
				for _, packet := range packets {
					switch packet.(type) {
					case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
						source.keyframe()
					}
				}
			}
		}()
	}
	offer, err := peer.connection.CreateOffer(nil)
	if err != nil {
		return err
	}
	if err := peer.connection.SetLocalDescription(offer); err != nil {
		return err
	}
	f.emit(forwardEvent{Op: "signal", Peer: command.Peer, Signal: &forwardSignal{Description: peer.connection.LocalDescription()}})
	return nil
}

// sendsPicture: the answer accepted the sharer's picture in H.264, the one codec every viewer gets.
func sendsPicture(answer *webrtc.SessionDescription) bool {
	parsed, err := answer.Unmarshal()
	if err != nil {
		return false
	}
	for _, media := range parsed.MediaDescriptions {
		if media.MediaName.Media != "video" || media.MediaName.Port.Value == 0 {
			continue
		}
		for _, attribute := range media.Attributes {
			if attribute.Key == "rtpmap" && strings.Contains(strings.ToUpper(attribute.Value), "H264/") {
				return true
			}
		}
	}
	return false
}

func (f *forwarder) signal(command forwardCommand) error {
	f.mu.Lock()
	peer := f.peers[command.Peer]
	f.mu.Unlock()
	if peer == nil || command.Signal == nil {
		return nil // ICE may arrive after a peer was closed.
	}
	if description := command.Signal.Description; description != nil {
		if err := peer.connection.SetRemoteDescription(*description); err != nil {
			return err
		}
		for _, candidate := range peer.candidates {
			if err := peer.connection.AddICECandidate(candidate); err != nil {
				return err
			}
		}
		peer.candidates = nil
		if description.Type != webrtc.SDPTypeOffer {
			return nil
		}
		answer, err := peer.connection.CreateAnswer(nil)
		if err != nil {
			return err
		}
		if peer.uplink && peer.source.picture != nil && !sendsPicture(&answer) {
			return errors.New("This browser can't send H.264 to Couch.")
		}
		if err := peer.connection.SetLocalDescription(answer); err != nil {
			return err
		}
		f.emit(forwardEvent{Op: "signal", Peer: command.Peer, Signal: &forwardSignal{Description: peer.connection.LocalDescription()}})
		return nil
	}
	if candidate := command.Signal.Candidate; candidate != nil && candidate.Candidate != "" {
		if peer.received >= forwardCandidates {
			return nil
		}
		peer.received++
		if peer.connection.RemoteDescription() == nil {
			peer.candidates = append(peer.candidates, *candidate)
			return nil
		}
		return peer.connection.AddICECandidate(*candidate)
	}
	return nil
}

func (f *forwarder) close(id string) {
	f.mu.Lock()
	peer := f.peers[id]
	delete(f.peers, id)
	if peer != nil && peer.uplink {
		for key, source := range f.sources {
			if source == peer.source {
				delete(f.sources, key)
			}
		}
	}
	f.mu.Unlock()
	if peer != nil {
		go peer.connection.Close()
	}
}

func (f *forwarder) handle(command forwardCommand) {
	if command.Peer == "" {
		return
	}
	var err error
	switch command.Op {
	case "uplink":
		err = f.uplink(command)
	case "downlink":
		err = f.downlink(command)
	case "signal":
		err = f.signal(command)
	case "close":
		f.close(command.Peer)
	}
	if err != nil {
		f.emit(forwardEvent{Op: "failed", Peer: command.Peer, Error: err.Error()})
	}
}

func runForward() error {
	forward, err := newForwarder(os.Stdout)
	if err != nil {
		return err
	}
	input := bufio.NewScanner(os.Stdin)
	// A session description with every codec and candidate fits well within this.
	input.Buffer(make([]byte, 64*1024), 1024*1024)
	ended := make(chan struct{})
	go func() {
		defer close(ended)
		for input.Scan() {
			var command forwardCommand
			if json.Unmarshal(input.Bytes(), &command) == nil {
				forward.handle(command)
			}
		}
	}()
	// EOF also covers Core being killed: the helper never becomes a daemon.
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	select {
	case <-ended:
	case <-signals:
	}
	forward.mu.Lock()
	for _, peer := range forward.peers {
		_ = peer.connection.Close()
	}
	forward.mu.Unlock()
	return nil
}
