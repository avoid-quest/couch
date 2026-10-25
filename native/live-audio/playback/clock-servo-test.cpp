#include "clock-servo.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <algorithm>
void require(bool ok, const char* reason) { if(!ok){fprintf(stderr,"FAIL: %s\n",reason);exit(1);} }
void simulate(double drift, double initial, bool changing) {
    ClockServo servo;
    double phase=initial, max_late=0;
    uint32_t previous=48000;
    int64_t last_change=0;
    for(int i=0;i<2400;i++) {
        const double t=i*.25;
        if(changing && i==1200)drift=-drift;
        const double observed=phase+80*std::sin(t*2.1)+25*std::cos(t*.7);
        const int64_t now=1000000+int64_t(t*1e6);
        require(servo.observe(now,observed),"valid clock observation rejected");
        require(servo.rate>=47976 && servo.rate<=48024,"rate outside500ppm bound");
        if(servo.rate!=previous){
            require(std::abs(int(servo.rate)-int(previous))==1,"rate jump exceeds1Hz");
            require(now-last_change>=1000000,"rate changes faster than1Hz/second");
            last_change=now;previous=servo.rate;
        }
        phase+=(drift-(double(servo.rate)-48000)/48000*1e6)*.25;
        if(t>150 && (!changing || t<300 || t>450))max_late=std::max(max_late,std::abs(phase));
    }
    printf("drift=%g initial=%g changing=%d finalPhaseUs=%.2f maxSettledPhaseUs=%.2f rate=%u\n",drift,initial,changing,phase,max_late,servo.rate);
    require(max_late<300,"controller did not lock independent clocks within300us");
}
int main(){
    for(double ppm:{-250.,-66.,0.,66.,250.})for(double phase:{-1000.,0.,1000.})simulate(ppm,phase,false);
    simulate(150,0,true);
    ClockServo bad;require(!bad.observe(1,std::numeric_limits<double>::quiet_NaN()),"NaN accepted");
    ClockServo stale;require(stale.observe(1000000,0),"initial observation rejected");
    require(!stale.observe(4000001,0),"stale observation accepted");
    ClockServo backwards;require(backwards.observe(1000000,0),"initial observation rejected");
    require(!backwards.observe(999999,0),"backward time accepted");
    ClockServo discontinuity;require(!discontinuity.observe(1000000,10001),"10ms discontinuity accepted");
    puts("PASS independent clocks, direction change, slew/bounds, invalid/stale observations");
}
