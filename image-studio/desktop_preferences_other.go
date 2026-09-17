//go:build !windows && !linux && (!darwin || !cgo)

package main

func readSystemPreferences() SystemPreferences { return SystemPreferences{} }
