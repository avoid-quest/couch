#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <CoreGraphics/CoreGraphics.h>
extern void couch_set_cursor_visible(void *window, bool visible);
static int failures;
static void check(BOOL condition, const char *name) { printf("%s: %s\n", condition ? "PASS" : "FAIL", name); if (!condition) failures++; }
static void pump(double seconds) { NSDate *until = [NSDate dateWithTimeIntervalSinceNow:seconds]; while ([until timeIntervalSinceNow] > 0) { NSEvent *event = [NSApp nextEventMatchingMask:NSEventMaskAny untilDate:[NSDate dateWithTimeIntervalSinceNow:.01] inMode:NSDefaultRunLoopMode dequeue:YES]; if (event) [NSApp sendEvent:event]; } }
int main() { @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [NSApp finishLaunching];
    NSPoint original = NSEvent.mouseLocation;
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(original.x - 150, original.y - 90, 300, 180) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
    window.acceptsMouseMovedEvents = YES;
    WKWebView *web = [[WKWebView alloc] initWithFrame:window.contentView.bounds];
    [window.contentView addSubview:web];
    [web loadHTMLString:@"<body style='margin:0'><section style='height:100vh;background:#333'>Player</section>" baseURL:nil];
    [window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    pump(1);
    check(window.isKeyWindow && CGCursorIsVisible() && NSPointInRect(NSEvent.mouseLocation, [window convertRectToScreen:web.bounds]), "fixture has a visible stationary cursor over WKWebView");
    [web evaluateJavaScript:@"document.querySelector('section').style.cursor='none'" completionHandler:nil];
    pump(.1);
    couch_set_cursor_visible((__bridge void *)window, false);
    pump(.1);
    check(!CGCursorIsVisible(), "idle player hides the stationary native cursor");
    [web evaluateJavaScript:@"document.querySelector('section').style.cursor='auto'" completionHandler:nil];
    pump(.1);
    couch_set_cursor_visible((__bridge void *)window, true);
    pump(.1);
    check(CGCursorIsVisible(), "leaving the player restores the cursor without movement");
    couch_set_cursor_visible((__bridge void *)window, false);
    couch_set_cursor_visible((__bridge void *)window, true);
    pump(.1);
    check(CGCursorIsVisible(), "waking controls restores the native cursor");
    [window setFrameTopLeftPoint:NSMakePoint(NSMinX(window.frame), original.y + 8)];
    pump(.1);
    check(window.isKeyWindow && NSPointInRect(NSEvent.mouseLocation, window.frame) && !NSPointInRect(NSEvent.mouseLocation, [window convertRectToScreen:web.bounds]), "fixture pointer is over the title bar of the key window");
    couch_set_cursor_visible((__bridge void *)window, false);
    check(CGCursorIsVisible(), "player timer cannot hide the cursor over the title bar");
    [window setFrameOrigin:NSMakePoint(original.x + 20, original.y + 20)];
    pump(.1);
    couch_set_cursor_visible((__bridge void *)window, false);
    check(CGCursorIsVisible(), "player timer cannot hide the cursor over the desktop");
    couch_set_cursor_visible((__bridge void *)window, true);
    [window orderOut:nil];
    pump(.1);
    couch_set_cursor_visible((__bridge void *)window, false);
    check(CGCursorIsVisible(), "background player cannot hide another window's cursor");
    couch_set_cursor_visible((__bridge void *)window, true);
    return failures ? 1 : 0;
} }
