#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <CoreGraphics/CoreGraphics.h>
extern void couch_set_cursor_visible(void *window, bool visible);
static int failures;
static void check(BOOL condition, const char *name) { printf("%s: %s\n", condition ? "PASS" : "FAIL", name); if (!condition) failures++; }
static void pump(double seconds) { NSDate *until = [NSDate dateWithTimeIntervalSinceNow:seconds]; while ([until timeIntervalSinceNow] > 0) { NSEvent *event = [NSApp nextEventMatchingMask:NSEventMaskAny untilDate:[NSDate dateWithTimeIntervalSinceNow:.01] inMode:NSDefaultRunLoopMode dequeue:YES]; if (event) [NSApp sendEvent:event]; } }
static void moveCursor(CGPoint point) { CGEventRef event = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, point, kCGMouseButtonLeft); CGEventPost(kCGHIDEventTap, event); CFRelease(event); pump(.1); }
int main() { @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [NSApp finishLaunching];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(300,300,700,450) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
    window.acceptsMouseMovedEvents = YES;
    WKWebView *web = [[WKWebView alloc] initWithFrame:window.contentView.bounds];
    [window.contentView addSubview:web];
    [web loadHTMLString:@"<body style='margin:0'><section style='height:100vh;background:#333'>Player</section>" baseURL:nil];
    [window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    pump(1);
    NSPoint original = NSEvent.mouseLocation;
    NSPoint center = [window convertPointToScreen:NSMakePoint(350,225)];
    CGFloat screenHeight = NSScreen.screens.firstObject.frame.size.height;
    CGPoint target = CGPointMake(center.x, screenHeight - center.y);
    moveCursor(target);
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
    couch_set_cursor_visible((__bridge void *)window, true);
    [window orderOut:nil];
    pump(.1);
    couch_set_cursor_visible((__bridge void *)window, false);
    check(CGCursorIsVisible(), "background player cannot hide another window's cursor");
    couch_set_cursor_visible((__bridge void *)window, true);
    CGWarpMouseCursorPosition(CGPointMake(original.x, screenHeight - original.y));
    return failures ? 1 : 0;
} }
