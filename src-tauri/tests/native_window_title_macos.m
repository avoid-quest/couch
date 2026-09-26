// Run with scripts/test-native-window-title-macos.sh in a macOS desktop session.
#import <AppKit/AppKit.h>
#include <stdio.h>
extern void couch_update_window_title(void *rawWindow, const char *rawTitle);

static int failures;
static void check(BOOL condition, const char *name) { printf("%s: %s\n", condition ? "PASS" : "FAIL", name); if (!condition) failures++; }
static NSWindow *newWindow(void) {
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
    window.collectionBehavior = NSWindowCollectionBehaviorFullScreenPrimary;
    return window;
}
static void toggle(NSWindow *window) {
    // Let AppKit complete the previous transition before starting another.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 2), dispatch_get_main_queue(), ^{
        [window makeKeyAndOrderFront:nil];
        [NSApp activateIgnoringOtherApps:YES];
        [window toggleFullScreen:nil];
    });
}
int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        NSApp.activationPolicy = NSApplicationActivationPolicyRegular;
        NSWindow *window = newWindow();
        NSWindow *other = newWindow();
        couch_update_window_title((__bridge void *)window, "Couch · Movie");
        NSToolbar *toolbar = window.toolbar;
        check(toolbar.visible, "windowed title toolbar is visible");
        __block int entries = 0;
        [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidEnterFullScreenNotification object:nil queue:nil usingBlock:^(NSNotification *notification) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (notification.object == window) {
                    entries++;
                    check(!toolbar.visible, "entering fullscreen hides the title toolbar");
                    couch_update_window_title((__bridge void *)window, "Couch · Next movie");
                    check(window.toolbar == toolbar && !toolbar.visible, "title updates keep the fullscreen toolbar hidden");
                    NSTextField *title = (NSTextField *)toolbar.items.firstObject.view;
                    check([title.stringValue isEqualToString:@"Couch · Next movie"], "hidden toolbar receives the latest title");
                    toggle(window);
                } else if (notification.object == other) {
                    check(toolbar.visible, "another window's fullscreen does not hide this toolbar");
                    couch_update_window_title((__bridge void *)other, "Couch · Already fullscreen");
                    check(!other.toolbar.visible, "toolbar installed during fullscreen starts hidden");
                    toggle(other);
                }
            });
        }];
        [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidExitFullScreenNotification object:nil queue:nil usingBlock:^(NSNotification *notification) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (notification.object == window) {
                    check(toolbar.visible, "leaving fullscreen restores the title toolbar");
                    toggle(entries < 2 ? window : other);
                } else if (notification.object == other) {
                    check(other.toolbar.visible, "toolbar installed during fullscreen restores on exit");
                    exit(failures ? 1 : 0);
                }
            });
        }];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            fprintf(stderr, "FAIL: macOS fullscreen transition timed out\n");
            exit(1);
        });
        toggle(window);
        [NSApp run];
    }
}
