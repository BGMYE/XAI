//go:build darwin

package backend

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=10.13
#cgo LDFLAGS: -framework Cocoa -framework Foundation -mmacosx-version-min=10.13

#import <Cocoa/Cocoa.h>
#import <Foundation/Foundation.h>
#import <stdlib.h>
#import <string.h>

@interface ImageStudioDraggingSource : NSObject <NSDraggingSource>
@end

@implementation ImageStudioDraggingSource
- (NSDragOperation)draggingSession:(NSDraggingSession *)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
	return NSDragOperationCopy;
}
- (BOOL)ignoreModifierKeysForDraggingSession:(NSDraggingSession *)session {
	return YES;
}
@end

static char *image_studio_make_drag_error(const char *message) {
	if (message == NULL) {
		return NULL;
	}
	size_t len = strlen(message);
	char *buf = (char *)malloc(len + 1);
	if (buf == NULL) {
		return NULL;
	}
	memcpy(buf, message, len + 1);
	return buf;
}

static int image_studio_begin_file_drag(const char *path, char **errOut) {
	@autoreleasepool {
		if (path == NULL || path[0] == '\0') {
			*errOut = image_studio_make_drag_error("empty drag path");
			return 1;
		}
		NSString *filePath = [NSString stringWithUTF8String:path];
		if (filePath == nil) {
			*errOut = image_studio_make_drag_error("invalid drag path");
			return 1;
		}
		BOOL isDir = NO;
		if (![[NSFileManager defaultManager] fileExistsAtPath:filePath isDirectory:&isDir] || isDir) {
			*errOut = image_studio_make_drag_error("drag file does not exist");
			return 1;
		}

		NSWindow *window = [NSApp keyWindow];
		if (window == nil) {
			window = [NSApp mainWindow];
		}
		if (window == nil) {
			*errOut = image_studio_make_drag_error("no active window for drag");
			return 1;
		}
		NSView *contentView = [window contentView];
		if (contentView == nil) {
			*errOut = image_studio_make_drag_error("no content view for drag");
			return 1;
		}

		NSImage *icon = [[NSWorkspace sharedWorkspace] iconForFile:filePath];
		if (icon == nil) {
			icon = [NSImage imageNamed:NSImageNameMultipleDocuments];
		}
		if (icon == nil) {
			*errOut = image_studio_make_drag_error("failed to build drag icon");
			return 1;
		}
		[icon setSize:NSMakeSize(96, 96)];

		__block BOOL ok = NO;
		__block char *blockErr = NULL;
		dispatch_sync(dispatch_get_main_queue(), ^{
			NSDraggingItem *dragItem = [[NSDraggingItem alloc] initWithPasteboardWriter:[NSURL fileURLWithPath:filePath]];
			NSPoint mouse = [contentView convertPoint:[window mouseLocationOutsideOfEventStream] fromView:nil];
			NSRect rect = NSMakeRect(mouse.x - 48, mouse.y - 48, 96, 96);
			[dragItem setDraggingFrame:rect contents:icon];
			NSEvent *event = [NSApp currentEvent];
			if (event == nil) {
				event = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDragged
					location:[window mouseLocationOutsideOfEventStream]
					modifierFlags:0
					timestamp:[NSDate timeIntervalSinceReferenceDate]
					windowNumber:[window windowNumber]
					context:nil
					eventNumber:0
					clickCount:1
					pressure:1.0];
			}
			if (event == nil) {
				blockErr = image_studio_make_drag_error("failed to construct drag event");
				return;
			}
			ImageStudioDraggingSource *source = [ImageStudioDraggingSource new];
			[contentView beginDraggingSessionWithItems:@[dragItem] event:event source:source];
			ok = YES;
		});
		if (!ok) {
			*errOut = blockErr != NULL ? blockErr : image_studio_make_drag_error("failed to start drag session");
			return 1;
		}
		return 0;
	}
}

static void image_studio_free_drag_error(char *value) {
	if (value != NULL) {
		free(value);
	}
}
*/
import "C"

import (
	"errors"
	"unsafe"
)

func beginNativeFileDrag(path string) error {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))

	var errPtr *C.char
	code := C.image_studio_begin_file_drag(cPath, &errPtr)
	defer func() {
		if errPtr != nil {
			C.image_studio_free_drag_error(errPtr)
		}
	}()
	if code != 0 {
		if errPtr != nil {
			return errors.New(C.GoString(errPtr))
		}
		return errors.New("native drag failed")
	}
	return nil
}
