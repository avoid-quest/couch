#import <AppKit/AppKit.h>
#import <QuartzCore/CADisplayLink.h>
#import <OpenGL/gl3.h>
#include <mpv/render_gl.h>
#include <dlfcn.h>
#include <stdatomic.h>

@interface CouchVideoView : NSOpenGLView {
@public
    atomic_bool frameReady;
}
@property mpv_render_context *renderer;
@property CADisplayLink *displayLink;
@property (weak) NSView *web;
@property uint64_t frames;
@end

static void frame_ready(void *context) {
    CouchVideoView *view = (__bridge CouchVideoView *)context;
    atomic_store(&view->frameReady, true);
}

@implementation CouchVideoView
- (BOOL)isOpaque { return YES; }
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (void)viewDidMoveToWindow {
    [super viewDidMoveToWindow];
    [self.displayLink invalidate];
    self.displayLink = nil;
    if (self.window) {
        self.displayLink = [self displayLinkWithTarget:self selector:@selector(displayTick:)];
        [self.displayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    }
}
- (void)displayTick:(CADisplayLink *)link {
    if (!self.renderer || !atomic_exchange(&frameReady, false)) return;
    if (mpv_render_context_update(self.renderer) & MPV_RENDER_UPDATE_FRAME) self.needsDisplay = YES;
}
- (void)reshape {
    [super reshape];
    [self.openGLContext update];
    self.needsDisplay = YES;
}
- (void)drawRect:(NSRect)dirty {
    if (!self.renderer) return;
    [self.openGLContext makeCurrentContext];
    NSRect pixels = [self convertRectToBacking:self.bounds];
    mpv_opengl_fbo fbo = {0, MAX(1, pixels.size.width), MAX(1, pixels.size.height), 0};
    int flip = 1;
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_OPENGL_FBO, &fbo},
        {MPV_RENDER_PARAM_FLIP_Y, &flip},
        {MPV_RENDER_PARAM_INVALID, NULL}
    };
    int result = mpv_render_context_render(self.renderer, params);
    if (result < 0) NSLog(@"Couch video render failed: %d", result);
    [self.openGLContext flushBuffer];
    mpv_render_context_report_swap(self.renderer);
    self.frames++;
}
@end

static void *get_proc(void *context, const char *name) { (void)context; return dlsym(RTLD_DEFAULT, name); }

void *couch_video_create(void *webview, mpv_handle *mpv) {
    NSView *web = (__bridge NSView *)webview;
    NSOpenGLPixelFormatAttribute attrs[] = {
        NSOpenGLPFAOpenGLProfile, NSOpenGLProfileVersion3_2Core,
        NSOpenGLPFAAccelerated, NSOpenGLPFADoubleBuffer, 0
    };
    NSOpenGLPixelFormat *format = [[NSOpenGLPixelFormat alloc] initWithAttributes:attrs];
    if (!format || !web.superview) return NULL;
    CouchVideoView *view = [[CouchVideoView alloc] initWithFrame:NSMakeRect(0, 0, 1, 1) pixelFormat:format];
    if (!view) return NULL;
    view.web = web;
    view.wantsBestResolutionOpenGLSurface = YES;
    [web.superview addSubview:view positioned:NSWindowBelow relativeTo:web];
    [view.openGLContext makeCurrentContext];
    mpv_opengl_init_params gl = {get_proc, NULL};
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_API_TYPE, MPV_RENDER_API_TYPE_OPENGL},
        {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl},
        {MPV_RENDER_PARAM_INVALID, NULL}
    };
    mpv_render_context *renderer = NULL;
    int result = mpv_render_context_create(&renderer, mpv, params);
    if (result < 0) {
        NSLog(@"Couch video renderer init failed: %d", result);
        [view removeFromSuperview];
        return NULL;
    }
    view.renderer = renderer;
    mpv_render_context_set_update_callback(view.renderer, frame_ready, (__bridge void *)view);
    atomic_store(&view->frameReady, true);
    return (__bridge_retained void *)view;
}

void couch_video_layout(void *pointer, double x, double y, double width, double height) {
    CouchVideoView *view = (__bridge CouchVideoView *)pointer;
    NSView *web = view.web;
    NSRect viewport = web.safeAreaRect;
    NSRect rect = NSMakeRect(viewport.origin.x + x,
        web.isFlipped ? viewport.origin.y + y : NSMaxY(viewport) - y - height,
        MAX(1, width), MAX(1, height));
    view.frame = [web convertRect:rect toView:view.superview];
    view.needsDisplay = YES;
}

uint64_t couch_video_frames(void *pointer) { return ((__bridge CouchVideoView *)pointer).frames; }

void couch_video_destroy(void *pointer) {
    CouchVideoView *view = (__bridge_transfer CouchVideoView *)pointer;
    [view.displayLink invalidate];
    view.displayLink = nil;
    mpv_render_context_set_update_callback(view.renderer, NULL, NULL);
    [view.openGLContext makeCurrentContext];
    mpv_render_context_free(view.renderer);
    view.renderer = NULL;
    [view removeFromSuperview];
}
