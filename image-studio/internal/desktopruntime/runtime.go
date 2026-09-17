// Package desktopruntime keeps the image service independent of the GUI toolkit.
// The desktop host supplies native dialogs and window events once at startup.
package desktopruntime

import (
	"context"
	"errors"
)

type FileFilter struct{ DisplayName, Pattern string }
type OpenDialogOptions struct {
	Title            string
	DefaultDirectory string
	Filters          []FileFilter
}
type SaveDialogOptions struct {
	Title, DefaultFilename, DefaultDirectory string
	Filters                                  []FileFilter
}
type Driver interface {
	Emit(string, ...any)
	Open(OpenDialogOptions, bool, bool) ([]string, error)
	Save(SaveDialogOptions) (string, error)
	ShowMain()
	Quit()
}
type driverKey struct{}

func WithDriver(ctx context.Context, driver Driver) context.Context {
	return context.WithValue(ctx, driverKey{}, driver)
}
func driver(ctx context.Context) Driver {
	if ctx == nil {
		return nil
	}
	d, _ := ctx.Value(driverKey{}).(Driver)
	return d
}
func EventsEmit(ctx context.Context, name string, data ...any) {
	if d := driver(ctx); d != nil {
		d.Emit(name, data...)
	}
}
func OpenMultipleFilesDialog(ctx context.Context, options OpenDialogOptions) ([]string, error) {
	if d := driver(ctx); d != nil {
		return d.Open(options, true, false)
	}
	return nil, errors.New("桌面文件选择器尚未就绪")
}
func openSingle(ctx context.Context, options OpenDialogOptions, directory bool) (string, error) {
	d := driver(ctx)
	if d == nil {
		return "", errors.New("桌面文件选择器尚未就绪")
	}
	paths, err := d.Open(options, false, directory)
	if err != nil || len(paths) == 0 {
		return "", err
	}
	return paths[0], nil
}
func OpenFileDialog(ctx context.Context, options OpenDialogOptions) (string, error) {
	return openSingle(ctx, options, false)
}
func OpenDirectoryDialog(ctx context.Context, options OpenDialogOptions) (string, error) {
	return openSingle(ctx, options, true)
}
func SaveFileDialog(ctx context.Context, options SaveDialogOptions) (string, error) {
	if d := driver(ctx); d != nil {
		return d.Save(options)
	}
	return "", errors.New("桌面文件选择器尚未就绪")
}
func Show(ctx context.Context) {
	if d := driver(ctx); d != nil {
		d.ShowMain()
	}
}
func WindowShow(ctx context.Context)       { Show(ctx) }
func WindowUnminimise(ctx context.Context) { Show(ctx) }
func Quit(ctx context.Context) {
	if d := driver(ctx); d != nil {
		d.Quit()
	}
}
