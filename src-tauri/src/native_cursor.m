#import <AppKit/AppKit.h>
void couch_set_cursor_visible(void *rawWindow, bool visible) {
    NSWindow *window = (__bridge NSWindow *)rawWindow;
    NSPoint pointer = [window.contentView convertPoint:window.mouseLocationOutsideOfEventStream fromView:nil];
    if (visible || (window.isKeyWindow && NSPointInRect(pointer, window.contentView.bounds))) [NSCursor setHiddenUntilMouseMoves:!visible];
}
