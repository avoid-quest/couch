#pragma once
#include <cstdint>
#include <cmath>
#include <algorithm>
// Experimental PI clock servo. Positive phase error means audio is late.
// Change consumption rate, never source deadlines or PCM frame accounting.
struct ClockServo {
    uint32_t rate = 48000;
    double filtered_us = 0, integral_ppm = 0;
    int64_t first_us = 0, previous_us = 0, control_us = 0;
    bool observe(int64_t now, double error_us) {
        if (now <= 0 || !std::isfinite(error_us) || std::abs(error_us) > 10000) return false;
        if (!first_us) {
            first_us = previous_us = control_us = now;
            filtered_us = error_us;
            return true;
        }
        const double dt = (now - previous_us) / 1e6;
        if (dt <= 0 || dt > 2) return false;
        previous_us = now;
        // Two-second filter; five seconds of settling before rate control.
        filtered_us += -std::expm1(-dt / 2) * (error_us - filtered_us);
        if (now - first_us < 5000000) return true;
        const double p = filtered_us / 10;
        const double next_i = std::clamp(integral_ppm + filtered_us * dt / 400, -400., 400.);
        if (std::abs(p + next_i) <= 500 || (p + next_i) * filtered_us < 0) integral_ppm = next_i;
        if (now - control_us < 1000000) return true;
        control_us = now;
        const double desired = 48000 * (1 + std::clamp(p + integral_ppm, -500., 500.) / 1e6);
        // Integer-Hz actuator: hysteresis and at most one Hz per second.
        if (desired > rate + .75 && rate < 48024) ++rate;
        else if (desired < rate - .75 && rate > 47976) --rate;
        return true;
    }
};
