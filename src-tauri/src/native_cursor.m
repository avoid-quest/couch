#import <AppKit/AppKit.h>
void couch_set_cursor_visible(void *rawWindow, bool visible) {
    NSWindow *window = (__bridge NSWindow *)rawWindow;
    if (visible || window.isKeyWindow) [NSCursor setHiddenUntilMouseMoves:!visible];
}
