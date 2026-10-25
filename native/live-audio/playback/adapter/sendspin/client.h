#pragma once
#include <chrono>
#include <cstdint>
// Clock/log adapter for the reused sink. No protocol/player implementation is linked.
namespace sendspin {
enum class LogLevel { DEBUG, INFO, WARN, ERROR };
class SendspinClient { public: static int64_t now_us() {
 return std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}};
}
