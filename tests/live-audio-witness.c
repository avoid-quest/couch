// Independent input-only JACK witness. No source fixture or recorder metadata.
// CLABPCM1: audio-lab/presentation.md. SIGUSR2 arms; SIGTERM freezes and drains.
#include <jack/jack.h>
#include <jack/ringbuffer.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

_Static_assert(sizeof(float) == 4, "float32 PCM required");
_Static_assert(ATOMIC_INT_LOCK_FREE == 2, "Realtime flags require lock-free integers");
enum { OVERFLOW=1, DISCONTINUITY=2, RATE=4, QUANTUM=8, FREEWHEEL=16,
       SHUTDOWN=32, CYCLE_TIME=64, IO=128, BAD_COUNT=256, ABORTED=512 };
static jack_client_t *client;
static jack_port_t *inputs[101];
static jack_ringbuffer_t *records;
static unsigned char *packet;
static unsigned channels, quantum, sequence;
static size_t captured, maximum;
static uint32_t first_frame, end_frame;
static volatile sig_atomic_t arm_requested, stop_requested;
static atomic_int armed, finished, freewheeling;
static atomic_uint flags, xruns, topology;
static void put32(unsigned char *p, uint32_t value) { for (unsigned i=0; i<4; i++) p[i]=(unsigned char)(value>>(8*i)); }
static void put64(unsigned char *p, uint64_t value) { for (unsigned i=0; i<8; i++) p[i]=(unsigned char)(value>>(8*i)); }
static void request(int signal) { if (signal==SIGUSR2) arm_requested=1; else stop_requested=1; }
static void flag(unsigned value) { if (atomic_load(&armed)) atomic_fetch_or(&flags, value); }
static int xrun(void *arg) { (void)arg; if (atomic_load(&armed)) atomic_fetch_add(&xruns, 1); return 0; }
static int graph_order(void *arg) { (void)arg; if (atomic_load(&armed)) atomic_fetch_add(&topology, 1); return 0; }
static void registration(jack_port_id_t id, int registered, void *arg) { (void)id; (void)registered; (void)graph_order(arg); }
static void connection(jack_port_id_t a, jack_port_id_t b, int connected, void *arg) { (void)a; (void)b; (void)connected; (void)graph_order(arg); }
static void rename_port(jack_port_id_t id, const char *old, const char *name, void *arg) { (void)id; (void)old; (void)name; (void)graph_order(arg); }
static int sample_rate(jack_nframes_t rate, void *arg) { (void)arg; if (rate!=48000) flag(RATE); return 0; }
static int buffer_size(jack_nframes_t count, void *arg) { (void)arg; if (count!=quantum) flag(QUANTUM); return 0; }
static void freewheel(int starting, void *arg) { (void)arg; atomic_store(&freewheeling, starting); if (starting) flag(FREEWHEEL); }
static void shutdown_client(void *arg) { (void)arg; atomic_fetch_or(&flags, SHUTDOWN); atomic_store(&finished, 1); }
static void record_header(unsigned char *out, const char *tag, uint32_t frame, unsigned count, jack_time_t current, jack_time_t next) {
  memset(out, 0, 64); memcpy(out, tag, 4);
  put32(out+4, sequence); put32(out+8, frame); put32(out+12, count);
  put32(out+16, atomic_load(&flags)); put32(out+20, atomic_load(&topology)); put32(out+24, atomic_load(&xruns));
  put64(out+40, current); put64(out+48, next); put64(out+56, captured);
}
static int process(jack_nframes_t count, void *arg) {
  (void)arg;
  if (!atomic_load(&armed) || atomic_load(&finished)) return 0;
  uint32_t frame=jack_last_frame_time(client), cycle_frame=0;
  jack_time_t current=0, next=0; float period=0;
  if (sequence && frame!=end_frame) flag(DISCONTINUITY);
  if (count!=quantum) flag(QUANTUM);
  if (jack_get_cycle_times(client, &cycle_frame, &current, &next, &period) || cycle_frame!=frame || !current || next<=current) flag(CYCLE_TIME);
  if (!count || count>4096) { flag(BAD_COUNT); atomic_store(&finished, 1); return 0; }
  if (captured+count>maximum) { atomic_store(&finished, 1); return 0; }
  size_t bytes=64+(size_t)count*channels*4;
  if (jack_ringbuffer_write_space(records)<bytes) { flag(OVERFLOW); atomic_store(&finished, 1); return 0; }
  for (unsigned channel=0; channel<channels; channel++) {
    const float *input=jack_port_get_buffer(inputs[channel], count);
    for (unsigned i=0; i<count; i++) {
      uint32_t bits; memcpy(&bits, &input[i], 4);
      put32(packet+64+((size_t)i*channels+channel)*4, bits);
    }
  }
  if (!sequence) first_frame=frame;
  captured+=count; end_frame=frame+count;
  record_header(packet, "PCM1", frame, count, current, next);
  if (jack_ringbuffer_write(records, (const char *)packet, bytes)!=bytes) flag(OVERFLOW);
  sequence++;
  if (captured+quantum>maximum) atomic_store(&finished, 1);
  return 0;
}
int main(int argc, char **argv) {
  if (argc<4 || argc>103) { fprintf(stderr, "Usage: witness max-frames source-port receiver-port...\n"); return 2; }
  char *end; unsigned long value=strtoul(argv[1], &end, 10);
  if (!*argv[1] || *end || *argv[1]=='-' || !value || value>140*48000) return 2;
  maximum=value; channels=(unsigned)argc-2;
  signal(SIGUSR2, request); signal(SIGTERM, request); signal(SIGINT, request); signal(SIGPIPE, SIG_IGN);
  jack_status_t status;
  client=jack_client_open("couch_lab_witness", JackNoStartServer | JackUseExactName, &status);
  if (!client) { fprintf(stderr, "Cannot connect witness to JACK (%u)\n", status); return 2; }
  quantum=jack_get_buffer_size(client);
  if (jack_get_sample_rate(client)!=48000 || quantum<128 || quantum>4096 || (quantum&(quantum-1)) || maximum<quantum) return 2;
  packet=malloc(64+4096*channels*4); records=jack_ringbuffer_create(16*1024*1024);
  if (!packet || !records) return 2;
  if (jack_set_process_callback(client, process, NULL) || jack_set_xrun_callback(client, xrun, NULL) ||
      jack_set_graph_order_callback(client, graph_order, NULL) || jack_set_port_registration_callback(client, registration, NULL) ||
      jack_set_port_connect_callback(client, connection, NULL) || jack_set_port_rename_callback(client, rename_port, NULL) ||
      jack_set_sample_rate_callback(client, sample_rate, NULL) || jack_set_buffer_size_callback(client, buffer_size, NULL) ||
      jack_set_freewheel_callback(client, freewheel, NULL)) return 2;
  jack_on_shutdown(client, shutdown_client, NULL);
  for (unsigned c=0; c<channels; c++) {
    jack_port_t *source=jack_port_by_name(client, argv[c+2]);
    if (!source || !(jack_port_flags(source)&JackPortIsOutput) || strcmp(jack_port_type(source), JACK_DEFAULT_AUDIO_TYPE)) return 2;
    for (unsigned previous=0; previous<c; previous++) if (!strcmp(argv[c+2], argv[previous+2])) return 2;
    char name[32]; snprintf(name, sizeof name, "input_%u", c);
    inputs[c]=jack_port_register(client, name, JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
    if (!inputs[c]) return 2;
  }
  if (jack_activate(client)) return 2;
  for (unsigned c=0; c<channels; c++) {
    if (jack_connect(client, argv[c+2], jack_port_name(inputs[c])) || jack_port_connected(inputs[c])!=1) return 2;
    fprintf(stderr, "PORT channel=%u source=%s input=%s\n", c, argv[c+2], jack_port_name(inputs[c]));
  }
  unsigned char header[24]={0}; memcpy(header, "CLABPCM1", 8);
  put32(header+8, 48000); put32(header+12, channels); put32(header+16, quantum); put32(header+20, 2);
  if (fwrite(header, 1, sizeof header, stdout)!=sizeof header || fflush(stdout)) return 2;
  fprintf(stderr, "READY channels=%u rate=48000 quantum=%u protocol=CLABPCM1\n", channels, quantum); fflush(stderr);
  int arm_sent=0;
  jack_time_t began=jack_get_time();
  char output[65536];
  while (!stop_requested && !atomic_load(&finished)) {
    if (arm_requested && !arm_sent) {
      atomic_store(&armed, 1); arm_sent=1;
      if (jack_get_sample_rate(client)!=48000) flag(RATE);
      if (jack_get_buffer_size(client)!=quantum) flag(QUANTUM);
      if (atomic_load(&freewheeling)) flag(FREEWHEEL);
    }
    size_t count=jack_ringbuffer_read(records, output, sizeof output);
    if (count && (fwrite(output, 1, count, stdout)!=count || fflush(stdout))) { atomic_fetch_or(&flags, IO); break; }
    if (jack_get_time()-began>180000000) { atomic_fetch_or(&flags, ABORTED); break; }
    if (!count) usleep(1000);
  }
  atomic_store(&armed, 0);
  jack_deactivate(client); // Joins the producer before draining and writing END1.
  for (;;) {
    size_t count=jack_ringbuffer_read(records, output, sizeof output);
    if (!count) break;
    if (fwrite(output, 1, count, stdout)!=count) { atomic_fetch_or(&flags, IO); break; }
  }
  if (!captured) atomic_fetch_or(&flags, ABORTED);
  record_header(packet, "END1", end_frame, 0, 0, 0);
  if (fwrite(packet, 1, 64, stdout)!=64 || fflush(stdout)) atomic_fetch_or(&flags, IO);
  fprintf(stderr, "RESULT frames=%zu overflow=%u xruns=%u flags=%u topologyChanges=%u recordFirstFrame=%u recordEndFrame=%u\n",
    captured, !!(atomic_load(&flags)&OVERFLOW), atomic_load(&xruns), atomic_load(&flags), atomic_load(&topology), first_frame, end_frame);
  fflush(stderr);
  jack_client_close(client); jack_ringbuffer_free(records); free(packet);
  return atomic_load(&flags) || atomic_load(&xruns) || atomic_load(&topology) ? 1 : 0;
}
