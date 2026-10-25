// Native Live playback. Reuses the Apache-2.0 Pulse sink; Node owns protocol and deadlines.
#include "pulse_sink.h"
#include "clock-servo.h"
#include "log.h"
#include <cstdarg>
#include <cstring>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
#include <inttypes.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <vector>
#include <cstdlib>
static std::atomic<bool> sink_failed{false}, active{false};
namespace sendspin_cli {
void log_line(sendspin::LogLevel level,const char* tag,const char* fmt,...) {
 char message[2048];va_list a;va_start(a,fmt);vsnprintf(message,sizeof(message),fmt,a);va_end(a);
 fprintf(stderr,"%" PRId64 " %d %s %s\n",sendspin::SendspinClient::now_us(),int(level),tag,message);
 if(level>=sendspin::LogLevel::WARN || (active && strstr(message,"ran dry")))sink_failed=true;
}
}
int main(int argc,char**argv){
 if(argc!=4)return 2;
 char *tail=nullptr;errno=0;unsigned long buffer_ms=strtoul(argv[2],&tail,10);
 if(errno||!argv[2][0]||*tail||buffer_ms<5||buffer_ms>250)return 2;
 errno=0;unsigned long duration=strtoul(argv[3],&tail,10);
 if(errno||!argv[3][0]||*tail||duration>3600)return 2;
 // A zero duration follows the exact parent's pipe lifetime, like native capture.
 const auto now=sendspin::SendspinClient::now_us;const int64_t began=now();
 int64_t finish=0,max_lead=0;unsigned reports=0;bool ready=false,started=false;uint32_t sequence=0;uint64_t total=0;
 setvbuf(stdout,nullptr,_IOLBF,0);fcntl(0,F_SETFL,fcntl(0,F_GETFL)|O_NONBLOCK);
 sendspin_cli::PulseAudioSink sink(argv[1],uint32_t(buffer_ms));
 sink.on_frames_played=[&](uint32_t,int64_t at){finish=at;reports++;max_lead=std::max(max_lead,at-now());};
 if(!sink.configure(48000,2,16))return 3;
 std::vector<uint8_t> pending,silence(256*4,0);pending.reserve(256*1024);
 auto write=[&](const uint8_t*data,size_t frames){return sink.write(data,frames*4,ready?100:3000)==frames*4 && !sink_failed;};
 int result=0; ClockServo servo; uint32_t current_rate=48000;
 while(!duration || now()-began<int64_t(duration)*1000000){
  uint8_t input[16384];ssize_t n;
  while((n=read(0,input,sizeof(input)))>0){pending.insert(pending.end(),input,input+n);if(pending.size()>256*1024){result=4;break;}}
  if(result)break;
  if(n==0){fprintf(stderr,"Input closed\n");break;}
  if(n<0 && errno!=EAGAIN && errno!=EINTR){result=5;break;}
  if(!ready){
   if(!write(silence.data(),256)){result=6;break;}
   if(now()-began>=1000000 && reports>100){if(!sink.diagnostic_rate(48000,false)){result=12;break;}ready=true;printf("{\"event\":\"ready\",\"nativeUs\":%" PRId64 ",\"maxQueueUs\":%" PRId64 ",\"requestedMs\":%lu,\"sampleRate\":48000,\"channels\":2,\"bitDepth\":16}\n",now(),max_lead,buffer_ms);}
   continue;
  }
  if(pending.size()<16){
   if(!started){if(!write(silence.data(),256)){result=6;break;}}
   else {pollfd p{0,POLLIN,0};poll(&p,1,1);}
   if(sink_failed){result=7;break;}
   continue;
  }
  int64_t target;uint32_t frames,seq;memcpy(&target,pending.data(),8);memcpy(&frames,pending.data()+8,4);memcpy(&seq,pending.data()+12,4);
  if(frames==0){
   pending.erase(pending.begin(),pending.begin()+16);
   if(seq==0){printf("{\"event\":\"end\",\"frames\":%" PRIu64 "}\n",total);break;}
   if(seq==1 && target>=0 && target<=100)sink.set_volume(uint8_t(target));
   else if(seq==2 && (target==0||target==1))sink.set_muted(target==1);
   else {result=8;break;}
   continue;
  }
  if(frames>2048||seq!=sequence||target<=0){result=8;break;}
  if(pending.size()<16+frames*4){pollfd p{0,POLLIN,0};poll(&p,1,1);continue;}
  if(!started){
   const int64_t gap=target-finish;
   if(gap<0 || gap>100000){fprintf(stderr,"Initial deadline unavailable: gap=%" PRId64 "us\n",gap);result=9;break;}
   size_t pad=llround(gap*48000./1000000.);printf("{\"event\":\"start\",\"paddingFrames\":%zu,\"targetUs\":%" PRId64 ",\"previousFinishUs\":%" PRId64 "}\n",pad,target,finish);
   while(pad){size_t chunk=std::min(pad,size_t(256));if(!write(silence.data(),chunk)){result=6;break;}pad-=chunk;}
   if(result)break;
   started=true;active=true;
  }
  const auto before=now();unsigned old_reports=reports;
  if(!write(pending.data()+16,frames)){result=10;break;}
  if(reports==old_reports){result=11;break;}
  printf("{\"event\":\"write\",\"sequence\":%u,\"frames\":%u,\"targetUs\":%" PRId64 ",\"beginUs\":%" PRId64 ",\"nowUs\":%" PRId64 ",\"finishUs\":%" PRId64 ",\"errorUs\":%.3f}\n",seq,frames,target,before,now(),finish,finish-frames*1000000./current_rate-target);
  total+=frames;sequence++;
  if(seq%128==0){
   double error=0;
   if(!sink.diagnostic_timing(seq,target,frames,error) || !servo.observe(now(),error)){result=13;break;}
   printf("{\"event\":\"servo\",\"sequence\":%u,\"nowUs\":%" PRId64 ",\"errorUs\":%.3f,\"filteredUs\":%.3f,\"integralPpm\":%.3f,\"rate\":%u}\n",seq,now(),error,servo.filtered_us,servo.integral_ppm,servo.rate);
   if(servo.rate!=current_rate){
    if(!sink.diagnostic_rate(servo.rate,true)){result=12;break;}
    current_rate=servo.rate;
   }
  }
  pending.erase(pending.begin(),pending.begin()+16+frames*4);
 }
 active=false;sink.stop();printf("{\"event\":\"stopped\",\"exit\":%d,\"frames\":%" PRIu64 ",\"clockCorrection\":\"bounded-PI-variable-rate\"}\n",result,total);return result;
}
