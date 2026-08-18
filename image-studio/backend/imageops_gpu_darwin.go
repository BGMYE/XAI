//go:build darwin

package backend

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=10.13
#cgo LDFLAGS: -framework Foundation -framework CoreImage -framework CoreGraphics -framework ImageIO -framework Metal -mmacosx-version-min=10.13

#import <Foundation/Foundation.h>
#import <CoreImage/CoreImage.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#import <Metal/Metal.h>
#import <stdlib.h>
#import <string.h>

enum {
	ImageStudioTransformRotate = 1,
	ImageStudioTransformFlip = 2,
	ImageStudioTransformCrop = 3,
};

static char *image_studio_make_error(const char *message) {
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

static CIImage *image_studio_apply_transform(CIImage *input, int op, int arg0, int arg1, int arg2, int arg3, char **errOut) {
	switch (op) {
		case ImageStudioTransformRotate:
			switch ((arg0 % 360 + 360) % 360) {
				case 0:
					return input;
				case 90:
					return [input imageByApplyingOrientation:kCGImagePropertyOrientationRight];
				case 180:
					return [input imageByApplyingOrientation:kCGImagePropertyOrientationDown];
				case 270:
					return [input imageByApplyingOrientation:kCGImagePropertyOrientationLeft];
				default:
					*errOut = image_studio_make_error("unsupported rotation");
					return nil;
			}
		case ImageStudioTransformFlip:
			if (arg0) {
				return [input imageByApplyingOrientation:kCGImagePropertyOrientationUpMirrored];
			}
			return [input imageByApplyingOrientation:kCGImagePropertyOrientationDownMirrored];
		case ImageStudioTransformCrop: {
			CGRect extent = input.extent;
			CGFloat cropX = CGRectGetMinX(extent) + (CGFloat)arg0;
			CGFloat cropY = CGRectGetMaxY(extent) - (CGFloat)arg1 - (CGFloat)arg3;
			CGRect cropRect = CGRectIntersection(CGRectMake(cropX, cropY, (CGFloat)arg2, (CGFloat)arg3), extent);
			if (CGRectIsEmpty(cropRect) || cropRect.size.width <= 0 || cropRect.size.height <= 0) {
				*errOut = image_studio_make_error("crop rect lies outside the image");
				return nil;
			}
			return [input imageByCroppingToRect:cropRect];
		}
		default:
			*errOut = image_studio_make_error("unsupported transform kind");
			return nil;
	}
}

static int image_studio_transform_gpu(const char *srcPath, const char *dstPath, int formatCode, int op, int arg0, int arg1, int arg2, int arg3, char **errOut) {
	@autoreleasepool {
		id<MTLDevice> device = MTLCreateSystemDefaultDevice();
		if (device == nil) {
			*errOut = image_studio_make_error("metal device unavailable");
			return 1;
		}

		NSString *src = [NSString stringWithUTF8String:srcPath];
		NSString *dst = [NSString stringWithUTF8String:dstPath];
		if (src == nil || dst == nil) {
			*errOut = image_studio_make_error("invalid path");
			return 1;
		}

		CIContext *context = [CIContext contextWithMTLDevice:device options:@{ kCIContextUseSoftwareRenderer: @NO }];
		if (context == nil) {
			*errOut = image_studio_make_error("failed to create metal ci context");
			return 1;
		}

		CIImage *input = [CIImage imageWithContentsOfURL:[NSURL fileURLWithPath:src]];
		if (input == nil) {
			*errOut = image_studio_make_error("failed to load image");
			return 1;
		}

		CIImage *output = image_studio_apply_transform(input, op, arg0, arg1, arg2, arg3, errOut);
		if (output == nil) {
			return 1;
		}

		CGRect extent = CGRectIntegral(output.extent);
		CGImageRef rendered = [context createCGImage:output fromRect:extent];
		if (rendered == nil) {
			*errOut = image_studio_make_error("failed to render transformed image");
			return 1;
		}

		CFStringRef outputType = (__bridge CFStringRef)(formatCode == 2 ? @"public.jpeg" : @"public.png");
		CGImageDestinationRef destination = CGImageDestinationCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:dst], outputType, 1, NULL);
		if (destination == nil) {
			CGImageRelease(rendered);
			*errOut = image_studio_make_error("failed to create image destination");
			return 1;
		}

		CGImageDestinationAddImage(destination, rendered, nil);
		bool ok = CGImageDestinationFinalize(destination);
		CFRelease(destination);
		CGImageRelease(rendered);
		if (!ok) {
			*errOut = image_studio_make_error("failed to finalize transformed image");
			return 1;
		}
		return 0;
	}
}

static void image_studio_free_error(char *value) {
	if (value != NULL) {
		free(value);
	}
}
*/
import "C"

import (
	"errors"
	"fmt"
	"unsafe"
)

type gpuTransformKind int

const (
	gpuTransformRotate gpuTransformKind = iota + 1
	gpuTransformFlip
	gpuTransformCrop
)

type gpuTransformRequest struct {
	Kind       gpuTransformKind
	Degrees    int
	Horizontal bool
	CropX      int
	CropY      int
	CropW      int
	CropH      int
}

func transformWithGPU(srcPath string, out transformOutput, req gpuTransformRequest) (ImageTransformResult, error) {
	var errPtr *C.char
	cSrcPath := C.CString(srcPath)
	cDstPath := C.CString(out.Path)
	defer C.free(unsafe.Pointer(cSrcPath))
	defer C.free(unsafe.Pointer(cDstPath))
	formatCode := 1
	if out.Format == "jpeg" {
		formatCode = 2
	}
	arg0 := 0
	arg1 := 0
	arg2 := 0
	arg3 := 0
	switch req.Kind {
	case gpuTransformRotate:
		arg0 = req.Degrees
	case gpuTransformFlip:
		if req.Horizontal {
			arg0 = 1
		}
	case gpuTransformCrop:
		arg0 = req.CropX
		arg1 = req.CropY
		arg2 = req.CropW
		arg3 = req.CropH
	}
	code := C.image_studio_transform_gpu(
		cSrcPath,
		cDstPath,
		C.int(formatCode),
		C.int(req.Kind),
		C.int(arg0),
		C.int(arg1),
		C.int(arg2),
		C.int(arg3),
		&errPtr,
	)
	defer func() {
		if errPtr != nil {
			C.image_studio_free_error(errPtr)
		}
	}()
	if code != 0 {
		if errPtr != nil {
			return ImageTransformResult{}, errors.New(C.GoString(errPtr))
		}
		return ImageTransformResult{}, fmt.Errorf("gpu transform failed")
	}
	return ImageTransformResult{Path: out.Path, Acceleration: "gpu-metal"}, nil
}
