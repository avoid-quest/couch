#import <AppKit/AppKit.h>
#import <MediaPlayer/MediaPlayer.h>

// The bundled frontend owns the selected Couch session, including remote mode.
// Native commands return its identity so retired sessions cannot control a new one.
static NSDictionary *current;
static MPMediaItemArtwork *artwork;
static MPMediaItemArtwork *fallbackArtwork;
static void (*sendCommand)(const char *, const char *, double);

static void publish(void) {
    MPNowPlayingInfoCenter *center = MPNowPlayingInfoCenter.defaultCenter;
    if (!current) {
        center.playbackState = MPNowPlayingPlaybackStateStopped;
        center.nowPlayingInfo = nil;
        return;
    }
    NSMutableDictionary *info = [@{
        MPMediaItemPropertyTitle: current[@"title"],
        MPMediaItemPropertyArtist: current[@"artist"],
        MPMediaItemPropertyAlbumTitle: current[@"album"],
        MPNowPlayingInfoPropertyExternalContentIdentifier: current[@"id"],
        MPNowPlayingInfoPropertyElapsedPlaybackTime: current[@"position"],
        MPNowPlayingInfoPropertyPlaybackRate: current[@"rate"],
        MPNowPlayingInfoPropertyIsLiveStream: current[@"live"],
    } mutableCopy];
    if ([current[@"duration"] isKindOfClass:NSNumber.class]) info[MPMediaItemPropertyPlaybackDuration] = current[@"duration"];
    if (artwork ?: fallbackArtwork) info[MPMediaItemPropertyArtwork] = artwork ?: fallbackArtwork;
    center.nowPlayingInfo = info;
    center.playbackState = [current[@"playing"] boolValue] ? MPNowPlayingPlaybackStatePlaying : MPNowPlayingPlaybackStatePaused;
}

static void addCommand(MPRemoteCommand *command, NSString *name) {
    command.enabled = NO;
    [command addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
        __block MPRemoteCommandHandlerStatus status = MPRemoteCommandHandlerStatusNoSuchContent;
        void (^perform)(void) = ^{
            if (!current || !command.enabled) return;
            double position = [event isKindOfClass:MPChangePlaybackPositionCommandEvent.class] ? ((MPChangePlaybackPositionCommandEvent *)event).positionTime : 0;
            sendCommand([current[@"id"] UTF8String], name.UTF8String, position);
            status = MPRemoteCommandHandlerStatusSuccess;
        };
        if (NSThread.isMainThread) perform(); else dispatch_sync(dispatch_get_main_queue(), perform);
        return status;
    }];
}

static MPMediaItemArtwork *decodeArtwork(const unsigned char *bytes, size_t length) {
    NSImage *image = [[NSImage alloc] initWithData:[NSData dataWithBytes:bytes length:length]];
    if (!image.isValid || image.size.width <= 0 || image.size.height <= 0) return nil;
    return [[MPMediaItemArtwork alloc] initWithBoundsSize:image.size requestHandler:^NSImage *(CGSize size) { (void)size; return image; }];
}

void couch_now_playing_install(void (*callback)(const char *, const char *, double), const unsigned char *fallback, size_t length) {
    fallbackArtwork = decodeArtwork(fallback, length);
    sendCommand = callback;
    MPRemoteCommandCenter *center = MPRemoteCommandCenter.sharedCommandCenter;
    addCommand(center.playCommand, @"play");
    addCommand(center.pauseCommand, @"pause");
    addCommand(center.togglePlayPauseCommand, @"toggle");
    addCommand(center.stopCommand, @"stop");
    addCommand(center.nextTrackCommand, @"next");
    addCommand(center.changePlaybackPositionCommand, @"seek");
    center.previousTrackCommand.enabled = NO;
    publish();
}

void couch_now_playing_update(const char *json) {
    NSData *data = [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
    id value = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil];
    NSDictionary *next = [value isKindOfClass:NSDictionary.class] ? value : nil;
    if (![next[@"id"] isEqual:current[@"id"]] || ![next[@"artwork"] isEqual:current[@"artwork"]]) artwork = nil;
    current = next;
    MPRemoteCommandCenter *center = MPRemoteCommandCenter.sharedCommandCenter;
    BOOL pausable = [current[@"canPause"] boolValue];
    center.playCommand.enabled = pausable && ![current[@"playing"] boolValue];
    center.pauseCommand.enabled = pausable && [current[@"playing"] boolValue];
    center.togglePlayPauseCommand.enabled = pausable;
    center.stopCommand.enabled = current != nil;
    center.nextTrackCommand.enabled = [current[@"canNext"] boolValue];
    center.changePlaybackPositionCommand.enabled = [current[@"canSeek"] boolValue];
    publish();
}

void couch_now_playing_artwork(const char *id, const char *url, const unsigned char *bytes, size_t length) {
    if (![current[@"id"] isEqualToString:[NSString stringWithUTF8String:id]] ||
        ![current[@"artwork"] isKindOfClass:NSDictionary.class] ||
        ![((NSDictionary *)current[@"artwork"])[@"url"] isEqualToString:[NSString stringWithUTF8String:url]]) return;
    MPMediaItemArtwork *next = decodeArtwork(bytes, length);
    if (!next) return;
    artwork = next;
    publish();
}
