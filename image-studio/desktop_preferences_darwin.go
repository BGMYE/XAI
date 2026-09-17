//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit
#import <AppKit/AppKit.h>
static int studioPreference(int item) {
 @autoreleasepool {
  NSWorkspace *workspace = [NSWorkspace sharedWorkspace];
  switch (item) {
   case 0: return [[[NSUserDefaults standardUserDefaults] stringForKey:@"AppleInterfaceStyle"] isEqualToString:@"Dark"];
   case 1: return workspace.accessibilityDisplayShouldReduceTransparency;
   case 2: return workspace.accessibilityDisplayShouldReduceMotion;
   case 3: return workspace.accessibilityDisplayShouldIncreaseContrast;
  }
 }
 return 0;
}
*/
import "C"

func readSystemPreferences() SystemPreferences {
	return SystemPreferences{Dark: boolRef(C.studioPreference(0) != 0), ReduceTransparency: boolRef(C.studioPreference(1) != 0), ReduceMotion: boolRef(C.studioPreference(2) != 0), HighContrast: boolRef(C.studioPreference(3) != 0)}
}
