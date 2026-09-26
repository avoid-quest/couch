#import <AppKit/AppKit.h>

static NSToolbarItemIdentifier const CouchTitleIdentifier = @"quest.avoid.couch.title";

@interface CouchTitleToolbar : NSToolbar <NSToolbarDelegate>
@property(nonatomic, strong) NSTextField *titleField;
@end

@implementation CouchTitleToolbar
- (instancetype)init {
    self = [super initWithIdentifier:@"quest.avoid.couch.titlebar"];
    if (self) {
        self.delegate = self;
        self.displayMode = NSToolbarDisplayModeIconOnly;
        self.allowsUserCustomization = NO;
        self.centeredItemIdentifiers = [NSSet setWithObject:CouchTitleIdentifier];
        self.titleField = [NSTextField labelWithString:@"Couch"];
        self.titleField.font = [NSFont systemFontOfSize:NSFont.systemFontSize weight:NSFontWeightMedium];
        self.titleField.alignment = NSTextAlignmentCenter;
        self.titleField.lineBreakMode = NSLineBreakByTruncatingTail;
        self.titleField.selectable = NO;
        [self.titleField setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
        [self.titleField.widthAnchor constraintGreaterThanOrEqualToConstant:120].active = YES;
    }
    return self;
}
- (NSArray<NSToolbarItemIdentifier> *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar {
    return @[CouchTitleIdentifier];
}
- (NSArray<NSToolbarItemIdentifier> *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar {
    return @[CouchTitleIdentifier];
}
- (NSToolbarItem *)toolbar:(NSToolbar *)toolbar itemForItemIdentifier:(NSToolbarItemIdentifier)identifier willBeInsertedIntoToolbar:(BOOL)flag {
    NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:CouchTitleIdentifier];
    item.view = self.titleField;
    item.visibilityPriority = NSToolbarItemVisibilityPriorityUser;
    return item;
}
@end

void couch_update_window_title(void *rawWindow, const char *rawTitle) {
    NSWindow *window = (__bridge NSWindow *)rawWindow;
    NSString *title = [NSString stringWithUTF8String:rawTitle];
    CouchTitleToolbar *toolbar;
    if ([window.toolbar isKindOfClass:CouchTitleToolbar.class]) {
        toolbar = (CouchTitleToolbar *)window.toolbar;
    } else {
        toolbar = [[CouchTitleToolbar alloc] init];
        window.titleVisibility = NSWindowTitleHidden;
        window.toolbarStyle = NSWindowToolbarStyleUnifiedCompact;
        window.titlebarSeparatorStyle = NSTitlebarSeparatorStyleNone;
        window.toolbar = toolbar;
    }
    toolbar.titleField.stringValue = title;
    toolbar.titleField.toolTip = title;
}
