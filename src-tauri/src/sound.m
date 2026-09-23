#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#include <unistd.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>

static AudioObjectPropertyAddress address(AudioObjectPropertySelector selector, AudioObjectPropertyScope scope, UInt32 channel) {
    return (AudioObjectPropertyAddress){selector, scope, channel};
}

static BOOL readValue(AudioObjectID object, AudioObjectPropertyAddress property, void *value, UInt32 size) {
    return AudioObjectGetPropertyData(object, &property, 0, NULL, &size, value) == noErr;
}

static NSArray<NSNumber *> *objects(AudioObjectID object, AudioObjectPropertyAddress property) {
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(object, &property, 0, NULL, &size) != noErr || size > 4096) return @[];
    NSMutableData *data = [NSMutableData dataWithLength:size];
    if (AudioObjectGetPropertyData(object, &property, 0, NULL, &size, data.mutableBytes) != noErr) return @[];
    NSMutableArray *result = [NSMutableArray array];
    for (UInt32 i = 0; i < size / sizeof(AudioObjectID); i++) [result addObject:@(((AudioObjectID *)data.bytes)[i])];
    return result;
}

static NSString *stringValue(AudioObjectID device, AudioObjectPropertySelector selector) {
    CFStringRef value = NULL;
    if (!readValue(device, address(selector, kAudioObjectPropertyScopeGlobal, 0), &value, sizeof(value)) || !value) return @"";
    return CFBridgingRelease(value);
}

static NSArray<NSNumber *> *outputDevices(void) {
    NSMutableArray *result = [NSMutableArray array];
    for (NSNumber *number in objects(kAudioObjectSystemObject, address(kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, 0))) {
        if (objects(number.unsignedIntValue, address(kAudioDevicePropertyStreams, kAudioDevicePropertyScopeOutput, 0)).count) [result addObject:number];
    }
    return result;
}

static AudioObjectID deviceForUID(NSString *uid) {
    if (!uid.length || uid.length > 512) return 0;
    for (NSNumber *number in outputDevices()) {
        if ([stringValue(number.unsignedIntValue, kAudioDevicePropertyDeviceUID) isEqualToString:uid]) {
            UInt32 alive = 1;
            if (readValue(number.unsignedIntValue, address(kAudioDevicePropertyDeviceIsAlive, kAudioObjectPropertyScopeGlobal, 0), &alive, sizeof(alive)) && !alive) return 0;
            return number.unsignedIntValue;
        }
    }
    return 0;
}

static BOOL writable(AudioObjectID device, AudioObjectPropertyAddress property) {
    Boolean result = false;
    return AudioObjectHasProperty(device, &property) && AudioObjectIsPropertySettable(device, &property, &result) == noErr && result;
}

static NSArray<NSDictionary *> *controls(AudioObjectID device, AudioObjectPropertySelector selector) {
    NSMutableArray *result = [NSMutableArray array];
    for (UInt32 channel = 0; channel <= 2; channel++) {
        AudioObjectPropertyAddress property = address(selector, kAudioDevicePropertyScopeOutput, channel);
        if (!AudioObjectHasProperty(device, &property)) continue;
        Float32 volume = 0;
        UInt32 mute = 0;
        BOOL valid = selector == kAudioDevicePropertyVolumeScalar
            ? readValue(device, property, &volume, sizeof(volume))
            : readValue(device, property, &mute, sizeof(mute));
        if (valid) [result addObject:@{@"channel": @(channel), @"writable": @(writable(device, property)), @"value": selector == kAudioDevicePropertyVolumeScalar ? @(volume) : @(mute)}];
    }
    return result;
}

static NSString *dataSourceName(AudioObjectID device, UInt32 source) {
    CFStringRef name = NULL;
    AudioValueTranslation translation = {&source, sizeof(source), &name, sizeof(name)};
    if (readValue(device, address(kAudioDevicePropertyDataSourceNameForIDCFString, kAudioDevicePropertyScopeOutput, 0), &translation, sizeof(translation)) && name) return CFBridgingRelease(name);
    return [NSString stringWithFormat:@"Output %u", source];
}

static NSDictionary *inventory(void) {
    AudioObjectID defaultDevice = 0;
    readValue(kAudioObjectSystemObject, address(kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, 0), &defaultDevice, sizeof(defaultDevice));
    NSMutableArray *outputs = [NSMutableArray array];
    NSMutableArray *profiles = [NSMutableArray array];
    for (NSNumber *number in outputDevices()) {
        AudioObjectID device = number.unsignedIntValue;
        NSString *uid = stringValue(device, kAudioDevicePropertyDeviceUID);
        if (!uid.length) continue;
        UInt32 alive = 1;
        readValue(device, address(kAudioDevicePropertyDeviceIsAlive, kAudioObjectPropertyScopeGlobal, 0), &alive, sizeof(alive));
        NSArray *volumes = controls(device, kAudioDevicePropertyVolumeScalar);
        NSArray *mutes = controls(device, kAudioDevicePropertyMute);
        float volume = 0;
        for (NSDictionary *item in volumes) volume += [item[@"value"] floatValue];
        if (volumes.count) volume /= volumes.count;
        BOOL muted = mutes.count > 0;
        for (NSDictionary *item in mutes) muted &= [item[@"value"] boolValue];
        NSDictionary *masterVolume = [volumes filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"channel == 0"]].firstObject;
        NSDictionary *masterMute = [mutes filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"channel == 0"]].firstObject;
        if (masterVolume) volume = [masterVolume[@"value"] floatValue];
        if (masterMute) muted = [masterMute[@"value"] boolValue];
        AudioObjectPropertyAddress source = address(kAudioDevicePropertyDataSource, kAudioDevicePropertyScopeOutput, 0);
        BOOL configurable = writable(device, source) && objects(device, address(kAudioDevicePropertyDataSources, kAudioDevicePropertyScopeOutput, 0)).count > 1;
        [outputs addObject:@{@"id": uid, @"card": uid, @"name": stringValue(device, kAudioObjectPropertyName), @"state": alive ? @"Available" : @"Unavailable",
            @"availability": alive ? @"available" : @"unavailable", @"volume": volumes.count ? @(lroundf(volume * 100)) : [NSNull null],
            @"muted": @(muted), @"volumeWritable": @([volumes filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"writable == YES"]].count > 0),
            @"muteWritable": @([mutes filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"writable == YES"]].count > 0),
            @"configurationAvailable": @(configurable)}];
        if (!configurable) continue;
        UInt32 active = 0;
        if (!readValue(device, source, &active, sizeof(active))) continue;
        for (NSNumber *choice in objects(device, address(kAudioDevicePropertyDataSources, kAudioDevicePropertyScopeOutput, 0))) {
            [profiles addObject:@{@"card": uid, @"id": choice.stringValue, @"name": [NSString stringWithFormat:@"%@ · %@", stringValue(device, kAudioObjectPropertyName), dataSourceName(device, choice.unsignedIntValue)],
                @"active": @(choice.unsignedIntValue == active), @"available": @YES, @"selectable": @YES}];
        }
    }
    return @{@"outputs": outputs, @"profiles": profiles, @"defaultOutput": defaultDevice ? stringValue(defaultDevice, kAudioDevicePropertyDeviceUID) : [NSNull null]};
}

static NSDictionary *request(NSDictionary *input) {
    NSString *op = input[@"op"];
    if (![op isKindOfClass:NSString.class]) return @{@"error": @"Invalid sound control."};
    if ([op isEqualToString:@"inventory"]) return inventory();
    if ([op isEqualToString:@"route"]) {
        NSNumber *requestedPID = input[@"pid"];
        pid_t pid = [requestedPID isKindOfClass:NSNumber.class] && requestedPID.intValue > 0 ? requestedPID.intValue : getpid();
        AudioObjectID process = 0;
        AudioObjectPropertyAddress translate = address(kAudioHardwarePropertyTranslatePIDToProcessObject, kAudioObjectPropertyScopeGlobal, 0);
        UInt32 size = sizeof(process);
        if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &translate, sizeof(pid), &pid, &size, &process) != noErr || !process) return @{@"output": [NSNull null]};
        UInt32 running = 0;
        readValue(process, address(kAudioProcessPropertyIsRunningOutput, kAudioObjectPropertyScopeGlobal, 0), &running, sizeof(running));
        NSArray *devices = objects(process, address(kAudioProcessPropertyDevices, kAudioObjectPropertyScopeOutput, 0));
        if (devices.count > 1) return @{@"error": @"The Mac player reported more than one output route."};
        return @{@"output": running && devices.count == 1 ? stringValue([devices[0] unsignedIntValue], kAudioDevicePropertyDeviceUID) : [NSNull null]};
    }
    NSString *uid = input[@"output"];
    if (![uid isKindOfClass:NSString.class]) return @{@"error": @"Choose an available output."};
    AudioObjectID device = deviceForUID(uid);
    if (!device) return @{@"error": @"That audio output is unavailable."};
    if ([op isEqualToString:@"default"]) {
        AudioObjectPropertyAddress property = address(kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, 0);
        if (!writable(kAudioObjectSystemObject, property)) return @{@"error": @"Check in System Settings on the playback host."};
        return AudioObjectSetPropertyData(kAudioObjectSystemObject, &property, 0, NULL, sizeof(device), &device) == noErr ? @{@"ok": @YES} : @{@"error": @"Could not select the Mac system output."};
    }
    if ([op isEqualToString:@"profile"]) {
        NSString *sourceID = input[@"profile"];
        if (![sourceID isKindOfClass:NSString.class]) return @{@"error": @"Choose an available output configuration."};
        const char *digits = sourceID.UTF8String;
        char *end = NULL;
        unsigned long long parsed = strtoull(digits, &end, 10);
        AudioObjectPropertyAddress property = address(kAudioDevicePropertyDataSource, kAudioDevicePropertyScopeOutput, 0);
        if (!writable(device, property) || end == digits || *end || parsed > UINT32_MAX) return @{@"error": @"Check in System Settings on the playback host."};
        UInt32 source = parsed;
        if (![objects(device, address(kAudioDevicePropertyDataSources, kAudioDevicePropertyScopeOutput, 0)) containsObject:@(source)]) return @{@"error": @"That output configuration is unavailable."};
        return AudioObjectSetPropertyData(device, &property, 0, NULL, sizeof(source), &source) == noErr ? @{@"ok": @YES} : @{@"error": @"Could not select the output configuration."};
    }
    AudioObjectPropertySelector selector = [op isEqualToString:@"volume"] ? kAudioDevicePropertyVolumeScalar : kAudioDevicePropertyMute;
    NSNumber *value = input[@"value"];
    if ((!([op isEqualToString:@"volume"] || [op isEqualToString:@"mute"])) || ![value isKindOfClass:NSNumber.class] || !isfinite(value.doubleValue) || value.doubleValue < 0 || value.doubleValue > 1) return @{@"error": @"Invalid sound control."};
    NSArray *available = controls(device, selector);
    NSMutableArray *targets = [NSMutableArray array];
    for (NSDictionary *item in available) if ([item[@"writable"] boolValue] && [item[@"channel"] unsignedIntValue] == 0) [targets addObject:item];
    if (!targets.count) for (NSDictionary *item in available) if ([item[@"writable"] boolValue]) [targets addObject:item];
    if (!targets.count) return @{@"error": @"Check in System Settings on the playback host."};
    for (NSDictionary *item in targets) {
        AudioObjectPropertyAddress property = address(selector, kAudioDevicePropertyScopeOutput, [item[@"channel"] unsignedIntValue]);
        Float32 scalar = value.floatValue;
        UInt32 muted = value.boolValue;
        if (AudioObjectSetPropertyData(device, &property, 0, NULL, sizeof(UInt32), selector == kAudioDevicePropertyVolumeScalar ? (void *)&scalar : (void *)&muted) != noErr) return @{@"error": @"Could not change the Mac output level."};
    }
    return @{@"ok": @YES};
}

char *couch_sound_request(const char *json) {
    @autoreleasepool {
        NSData *data = [[NSString stringWithUTF8String:json ?: ""] dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *input = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        NSDictionary *result = [input isKindOfClass:NSDictionary.class] ? request(input) : @{@"error": @"Invalid sound request."};
        NSData *encoded = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
        return strdup([[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding].UTF8String);
    }
}
