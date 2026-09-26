// Run with scripts/test-native-artwork-macos.sh; an optional path exports the published bitmap.
#import <AppKit/AppKit.h>
#import <MediaPlayer/MediaPlayer.h>
#include <stdio.h>
extern void couch_now_playing_install(void (*callback)(const char *, const char *, double), const unsigned char *fallback, size_t length);
extern void couch_now_playing_update(const char *json);
extern void couch_now_playing_artwork(const char *id, const char *url, const unsigned char *bytes, size_t length);
static void command(const char *id, const char *name, double position) { (void)id; (void)name; (void)position; }
static int failures;
static void check(BOOL condition, const char *name) { printf("%s: %s\n", condition ? "PASS" : "FAIL", name); if (!condition) failures++; }
static MPMediaItemArtwork *currentArtwork(void) { return MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo[MPMediaItemPropertyArtwork]; }
static void update(NSString *itemId, id url) {
    NSDictionary *media = @{ @"id": itemId, @"title": @"Movie", @"artist": @"", @"album": @"", @"playing": @NO, @"live": @NO, @"position": @0, @"duration": @60, @"rate": @0, @"canPause": @YES, @"canSeek": @YES, @"canNext": @NO, @"artwork": url == NSNull.null ? NSNull.null : @{@"url": url} };
    NSData *json = [NSJSONSerialization dataWithJSONObject:media options:0 error:nil];
    couch_now_playing_update([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        NSData *brand = [NSData dataWithContentsOfFile:@"src-tauri/icons/128x128@2x.png"];
        couch_now_playing_install(command, brand.bytes, brand.length);
        update(@"test:movie", NSNull.null);
        MPMediaItemArtwork *fallback = currentArtwork();
        check(fallback != nil, "missing cover publishes native artwork");
        NSImage *image = [fallback imageWithSize:CGSizeMake(256, 256)];
        NSImage *expected = [[NSImage alloc] initWithData:brand];
        check(NSEqualSizes(image.size, NSMakeSize(256, 256)) && [image.TIFFRepresentation isEqualToData:expected.TIFFRepresentation], "fallback is the bundled 256px Couch bitmap");
        if (argc > 1 && image) {
            NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithData:image.TIFFRepresentation];
            [[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[NSString stringWithUTF8String:argv[1]] atomically:YES];
        }
        update(@"test:movie", @"https://example.invalid/cover");
        check(currentArtwork() == fallback, "pending or failed cover keeps Couch artwork");
        couch_now_playing_artwork("test:movie", "https://example.invalid/cover", (const unsigned char *)"bad image", 9);
        check(currentArtwork() == fallback, "invalid image bytes keep Couch artwork");
        couch_now_playing_artwork("test:movie", "https://example.invalid/cover", brand.bytes, brand.length);
        MPMediaItemArtwork *real = currentArtwork();
        check(real && real != fallback, "valid cover replaces fallback");
        update(@"test:movie", @"https://example.invalid/cover");
        check(currentArtwork() == real, "progress updates retain valid cover");
        update(@"test:other", NSNull.null);
        check(currentArtwork() == fallback, "new item drops previous cover for Couch artwork");
        couch_now_playing_artwork("test:movie", "https://example.invalid/cover", brand.bytes, brand.length);
        check(currentArtwork() == fallback, "old cover cannot overwrite the new item");
        couch_now_playing_update("null");
        check(MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo == nil, "stop clears artwork with metadata");
        return failures ? 1 : 0;
    }
}
